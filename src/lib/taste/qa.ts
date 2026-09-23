// Profiling/extraction QA metrics and the founder-approved thresholds (Session 3 §2.1).
// Pure functions only: no I/O, no model calls, no imports from server modules. The
// thresholds are REPORTED as PASS/FAIL, never enforced — a FAIL is a finding for the
// founder, not something to tune away (DECISIONS #73).

import type { Category, ItemProfile } from "@/lib/types";
import { PROFILE_CAPS } from "@/lib/ai/profile-contract";

export const QA_THRESHOLDS = {
  firstPassStrict: 0.9,      // share of canon items whose FIRST attempt validated strictly
  committedStrict: 1.0,      // share of committed profiles that validate strictly (by construction)
  agreementStory: 0.5,       // mean pairwise weighted Jaccard across repeat runs
  agreementFeeling: 0.5,
  scalarMae: 0.15,           // mean absolute scalar difference across repeat runs
  prevalenceFlag: 0.5,       // a key present in > 50% of profiles is flagged for review
} as const;

export type QAThresholdName = keyof typeof QA_THRESHOLDS;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Σmin / Σmax over the union of keys. Null when BOTH are empty (that pair is excluded
 * from means), 0 when exactly one is empty.
 */
export function weightedJaccard(u: Record<string, number>, v: Record<string, number>): number | null {
  const uKeys = Object.keys(u);
  const vKeys = Object.keys(v);
  if (uKeys.length === 0 && vKeys.length === 0) return null;
  let min = 0;
  let max = 0;
  for (const k of new Set([...uKeys, ...vKeys])) {
    const a = u[k] ?? 0;
    const b = v[k] ?? 0;
    min += Math.min(a, b);
    max += Math.max(a, b);
  }
  return max === 0 ? 0 : min / max;
}

/** |topK(u) ∩ topK(v)| / k, ties broken by key ascending. Null when both are empty. */
export function topKOverlap(u: Record<string, number>, v: Record<string, number>, k = 5): number | null {
  const top = (x: Record<string, number>) =>
    Object.entries(x)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, k)
      .map(([key]) => key);
  if (Object.keys(u).length === 0 && Object.keys(v).length === 0) return null;
  const tu = new Set(top(u));
  const tv = top(v);
  const shared = tv.filter((key) => tu.has(key)).length;
  return shared / k;
}

/** Mean |a−b| over keys defined on BOTH sides; null when none are. */
export function scalarMae(
  a: Record<string, number>,
  b: Record<string, number>,
  keys: readonly string[],
): number | null {
  const shared = keys.filter((k) => a[k] !== undefined && b[k] !== undefined);
  if (shared.length === 0) return null;
  return shared.reduce((sum, k) => sum + Math.abs(a[k] - b[k]), 0) / shared.length;
}

/** |∩| / |∪| on sets; null when both are empty. */
export function setJaccard(a: string[], b: string[]): number | null {
  if (a.length === 0 && b.length === 0) return null;
  const sa = new Set(a);
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : a.filter((x) => sa.has(x) && b.includes(x)).length / union.size;
}

/** All unordered pairs, stable order. */
export function pairwise<T>(runs: T[]): Array<[T, T]> {
  const out: Array<[T, T]> = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) out.push([runs[i], runs[j]]);
  }
  return out;
}

export type PrevalenceRow = {
  key: string;
  family: "story" | "feeling";
  global: number;
  byCategory: Partial<Record<Category, number>>;
};

/**
 * Share of profiles whose vector[F] contains the key, per category present in the input
 * (0 when absent there); sorted by global desc, then key.
 */
export function prevalence(profiles: Array<{ category: Category; profile: ItemProfile }>): PrevalenceRow[] {
  const rows = new Map<string, { family: "story" | "feeling"; count: number; byCategory: Map<Category, number> }>();
  const totals = new Map<Category, number>();
  for (const { category, profile } of profiles) {
    totals.set(category, (totals.get(category) ?? 0) + 1);
    for (const family of ["story", "feeling"] as const) {
      for (const key of Object.keys(profile.vector[family])) {
        const row = rows.get(key) ?? { family, count: 0, byCategory: new Map() };
        row.count++;
        row.byCategory.set(category, (row.byCategory.get(category) ?? 0) + 1);
        rows.set(key, row);
      }
    }
  }
  return [...rows.entries()]
    .map(([key, row]) => {
      const byCategory: Partial<Record<Category, number>> = {};
      for (const [category, total] of totals) {
        if (total > 0) byCategory[category] = (row.byCategory.get(category) ?? 0) / total;
      }
      return { key, family: row.family, global: row.count / profiles.length, byCategory };
    })
    .sort((a, b) => b.global - a.global || a.key.localeCompare(b.key));
}

/**
 * A category artifact: a key at ≥ 0.60 in one category and ≤ 0.10 in every other category
 * that has ≥ 5 profiles. Report-only.
 *
 * Deviation from the plan's sketch (recorded in STATE): the ≥ 5-profile rule cannot be
 * evaluated from shares alone — a share of 1.0 looks identical at n = 1 and n = 100 — so
 * the caller passes the per-category profile totals alongside the rows. prevalence() now
 * also emits a 0 share for categories where the key is absent, so "every other category"
 * is visible in the rows.
 */
export function categoryArtifacts(
  rows: PrevalenceRow[],
  categoryTotals: Partial<Record<Category, number>>,
): PrevalenceRow[] {
  const bigEnough = (Object.entries(categoryTotals) as Array<[Category, number]>)
    .filter(([, total]) => total >= 5)
    .map(([category]) => category);
  if (bigEnough.length === 0) return [];
  const flagged: PrevalenceRow[] = [];
  for (const row of rows) {
    const entries = bigEnough.map((category) => [category, row.byCategory[category] ?? 0] as [Category, number]);
    const high = entries.filter(([, share]) => share >= 0.6);
    if (high.length !== 1) continue;
    const [highCategory] = high[0];
    const others = entries.filter(([category]) => category !== highCategory);
    if (others.every(([, share]) => share <= 0.1)) flagged.push(row);
  }
  return flagged;
}

export type GroupFillRow = { group: string; meanCount: number; cap: number; shareAtCap: number };

/** Mean group fill across profiles, with the §1.2 cap and the share of profiles at the cap. Counts attribute keys: bare scalars count toward their bare-key group. */
export function groupFill(profiles: Array<{ category: Category; profile: ItemProfile }>): GroupFillRow[] {
  const caps: Record<string, number> = { ...PROFILE_CAPS };
  const counts = new Map<string, number[]>();
  for (const { profile } of profiles) {
    const perGroup = new Map<string, number>();
    for (const a of [...profile.story, ...profile.feeling]) {
      const group = a.key.includes(".") ? a.key.slice(0, a.key.indexOf(".")) : a.key;
      perGroup.set(group, (perGroup.get(group) ?? 0) + 1);
    }
    for (const group of Object.keys(caps)) {
      counts.set(group, [...(counts.get(group) ?? []), perGroup.get(group) ?? 0]);
    }
  }
  return [...counts.entries()]
    .map(([group, list]) => {
      const cap = caps[group];
      const meanCount = list.reduce((sum, n) => sum + n, 0) / list.length;
      return { group, meanCount: round4(meanCount), cap, shareAtCap: round4(list.filter((n) => n >= cap).length / list.length) };
    });
}

export type EvaluateRow = {
  name: QAThresholdName;
  value: number | null;
  threshold: number;
  pass: boolean | null;
};

/** PASS/FAIL against QA_THRESHOLDS. A null value gives pass: null ("not measurable"), never a silent pass. */
export function evaluate(metrics: {
  firstPassStrict: number;
  committedStrict: number;
  agreementStory: number | null;
  agreementFeeling: number | null;
  scalarMae: number | null;
  maxPrevalence: number;
}): EvaluateRow[] {
  const row = (name: QAThresholdName, value: number | null, kind: "min" | "max"): EvaluateRow => {
    const threshold = QA_THRESHOLDS[name];
    const pass = value === null ? null : kind === "min" ? value >= threshold : value <= threshold;
    return { name, value, threshold, pass };
  };
  return [
    row("firstPassStrict", metrics.firstPassStrict, "min"),
    row("committedStrict", metrics.committedStrict, "min"),
    row("agreementStory", metrics.agreementStory, "min"),
    row("agreementFeeling", metrics.agreementFeeling, "min"),
    row("scalarMae", metrics.scalarMae, "max"),
    row("prevalenceFlag", metrics.maxPrevalence, "max"),
  ];
}
