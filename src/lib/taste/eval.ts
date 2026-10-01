// The offline evaluation harness (SPEC-STAGE3 §D; AUDIT-STAGE3 §5.1, §5.3). Pure:
// no database, no network, no model, no clock — `now` is always a parameter, and every
// function takes its inputs explicitly (library, phases, prefs, canon items, pool).
// It re-uses the Stage 3 functions and never re-implements scoring.
import type { Category, EntryWithContext, MediaItem, Phase, Route, WeightedTag } from "@/lib/types";
import { entryDate, isDated, affinity } from "./affinity";
import { generateCandidates } from "./candidates";
import { filterCandidates, type PipelineFilters, type RecentImpression } from "./filters";
import { buildUserProfile, usableProfile, type UserProfile } from "./profile";
import { rankPipeline } from "./pipeline";
import {
  scoreCandidates,
  orderScored,
  sharedForFamily,
  type ScoredCandidate,
  type StageCandidate,
} from "./score";
import { routeOf } from "./explain";
import { bandOf, closeness, type Band } from "./rerank";
import type { TastePrefs } from "./tags";
import { candidateKey } from "./tags";
import { W0, LOVED, BAND, type Component } from "./weights";
import { CALIBRATION } from "./calibration";
import { simFamily, type Family } from "./vector";

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
/** Population standard deviation (the spread of the whole set, not a sample estimate). */
const sd = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
};

// ---------------------------------------------------------------------------
// explainScore (AUDIT §5.3): why did this candidate get its score.
// Built on scoreCandidate and the Session 5 helpers; adds the raw halves, the shared
// keys with both sides' weights, the winning anchor and the calibration table in use.
// ---------------------------------------------------------------------------

export type ExplainScoreRow = {
  component: Component;
  /** null when the component carries no raw family similarity (form, creator, phase, anti).
   *  For story/feeling both halves are numbers: the scorer defaults a missing anchor to 0. */
  raw: { centroid: number; anchor: number } | null;
  calibrated: number;
  weight: number;
  contribution: number;
  has_evidence: boolean;
};

export type ExplainScoreReport = {
  key: string;
  title: string;
  category: Category;
  provenance: StageCandidate["sources"];
  score: number;
  /** Winning anchor per family: raw = the raw anchor similarity, calibrated = cal(raw). */
  anchors: {
    story: { entryId: string; category: Category; raw: number; calibrated: number } | null;
    feeling: { entryId: string; category: Category; raw: number; calibrated: number } | null;
  };
  /** Shared keys from sharedForFamily (ending dropped), carrying BOTH sides' weights;
   *  `weight` is the scored group weight u[k]·v[k]·G that similarity itself used. */
  shared: { story: SharedKey[]; feeling: SharedKey[] };
  rows: ExplainScoreRow[];
  calibration: { story: { lo: number; hi: number }; feeling: { lo: number; hi: number } };
};

export type SharedKey = { key: string; a: number; b: number; weight: number };

export function explainScore(P: UserProfile, scored: ScoredCandidate): ExplainScoreReport {
  const item = scored.candidate.item;
  const vec = usableProfile(item)?.vector ?? { story: {}, feeling: {} };
  const sharedSide = (family: Family): SharedKey[] => {
    const pick = scored.anchors[family];
    if (!pick) return [];
    // The scorer's own shared-key extraction (ending dropped, group weights inside).
    const shared: WeightedTag[] = sharedForFamily(family, vec[family] ?? {}, pick.anchor.vector);
    return shared.map((t) => ({
      key: t.key,
      a: (vec[family] ?? {})[t.key] ?? 0,
      b: pick.anchor.vector[t.key] ?? 0,
      weight: t.weight,
    }));
  };
  const rawRow = (family: "story" | "feeling") => {
    const raw = scored.raw[family];
    if (!raw) return null;
    // The scorer defaults the anchor half to 0 when no anchor exists; report both halves as numbers.
    return { centroid: raw.centroid ?? 0, anchor: raw.anchor ?? 0 };
  };
  const anchorSide = (family: "story" | "feeling") => {
    const pick = scored.anchors[family];
    return pick
      ? { entryId: pick.anchor.entryId, category: pick.anchor.category, raw: rawRow(family)?.anchor ?? 0, calibrated: pick.sim }
      : null;
  };
  const rows: ExplainScoreRow[] = (Object.keys(W0) as Component[]).map((k) => ({
    component: k,
    raw: k === "story" || k === "feeling" ? rawRow(k) : null,
    calibrated: scored.features[k],
    weight: scored.weights[k],
    contribution: scored.contributions[k],
    has_evidence: scored.has_evidence[k],
  }));
  return {
    key: scored.candidate.key,
    title: item.title,
    category: item.category,
    provenance: [...scored.candidate.sources],
    score: scored.score,
    anchors: { story: anchorSide("story"), feeling: anchorSide("feeling") },
    shared: { story: sharedSide("story"), feeling: sharedSide("feeling") },
    rows,
    calibration: { story: CALIBRATION.story, feeling: CALIBRATION.feeling },
  };
}

// ---------------------------------------------------------------------------
// The D.1 core shared by leaveOneLovedOut and temporalHoldout: remove the holdouts,
// rebuild the profile, generate over lib', inject what generation missed, filter
// (recency off — §D's "skip step 9"), score, order. NO re-rank (§D.1).
// ---------------------------------------------------------------------------

const DEFAULT_FILTERS: PipelineFilters = {
  category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 5,
};

/** An injected holdout's key → reason it never got a rank (§D.1 step 6). */
type ExcludedReason = "unprofiled" | "filtered" | "not_generated";

export type HoldoutRow = {
  key: string;
  entryId: string;
  title: string;
  /** 1-based position in the scored order; null when excluded. */
  rank: number | null;
  score: number | null;
  features: Record<Component, number> | null;
  band: Band | null;
  route: Route | null;
  excluded: ExcludedReason | null;
};

export type LeaveOneOutReport = {
  /** Ranked holdouts; `n + excluded.length` = the loved-with-profile population (§D.1). */
  n: number;
  excluded: Array<{ key: string; reason: ExcludedReason }>;
  hit5: number;
  hit20: number;
  mrr: number;
  median_rank: number;
  rows: HoldoutRow[];
};

/** Every loved entry (aff ≥ LOVED) whose item has a usable profile — the D.1 population. */
export function lovedWithProfile(library: EntryWithContext[]): EntryWithContext[] {
  return library.filter((e) => e.entry.status !== "want" && affinity(e) >= LOVED && usableProfile(e.item) !== null);
}

/**
 * Eval-only candidate construction (§D.1 steps 2–4): generate over lib', then inject
 * the holdout items generation didn't produce, with empty provenance. Injection is
 * never persisted; provenance never affects the score (§1.7).
 */
function candidatesForEval(args: {
  library: EntryWithContext[];
  P: UserProfile;
  holdouts: EntryWithContext[];
  canon: MediaItem[];
  pool: MediaItem[];
}): { candidates: StageCandidate[]; injected: StageCandidate[] } {
  const { library, P, holdouts, canon, pool } = args;
  const { candidates } = generateCandidates({ library, P, filters: DEFAULT_FILTERS, canon, creatorResults: new Map(), pool });
  const byKey = new Set(candidates.map((c) => c.key));
  const injected: StageCandidate[] = [];
  for (const h of holdouts) {
    const key = candidateKey(h.item);
    if (byKey.has(key)) continue;
    const creator = h.item.creators[0];
    injected.push({
      key,
      item: h.item,
      entryId: null, // injected as a pure candidate; its entry stays out of lib'
      sources: [],
      creatorKey: creator ? `${h.item.category}:${creator.name.toLowerCase()}` : null,
    });
  }
  return { candidates: [...candidates, ...injected], injected };
}

/** D.1's per-holdout row fields for a ranked candidate (band and route reported, not ranked on). */
function rankedRow(h: EntryWithContext, key: string, rank: number, s: ScoredCandidate): HoldoutRow {
  return {
    key, entryId: h.entry.id, title: h.item.title,
    rank: rank + 1,
    score: s.score,
    features: { ...s.features },
    band: bandOf(closeness(s)),
    route: routeOf(s, { listOnly: false, surprise: false }),
    excluded: null,
  };
}

const emptyRow = (h: EntryWithContext, key: string, reason: ExcludedReason): HoldoutRow =>
  ({ key, entryId: h.entry.id, title: h.item.title, rank: null, score: null, features: null, band: null, route: null, excluded: reason });

/**
 * The scored-and-ordered eval run over one library, with each holdout's outcome.
 * Recency is off entirely (recent: [] — §D.1 "skip step 9"): eval has no history.
 * Ordering is the engine's own orderScored (surprise off), not a re-implementation.
 */
function evalRun(args: {
  library: EntryWithContext[];
  phases: Phase[];
  prefs: TastePrefs;
  holdouts: EntryWithContext[];
  canon: MediaItem[];
  pool: MediaItem[];
  now: Date;
}): { rows: HoldoutRow[]; excluded: Array<{ key: string; reason: ExcludedReason }> } {
  const { library, phases, prefs, holdouts, canon, pool, now } = args;
  const P = buildUserProfile(library, phases, prefs, now);
  const { candidates } = candidatesForEval({ library, P, holdouts, canon, pool });
  const { kept, deferred } = filterCandidates({
    candidates, library, prefs, filters: DEFAULT_FILTERS, recent: [] as RecentImpression[], now,
  });
  const { scored } = scoreCandidates(P, kept);
  const ordered = orderScored(scored, { surprise: false, userId: "eval" });

  const deferredKeys = new Set(deferred.map((c) => c.key));
  const excluded: Array<{ key: string; reason: ExcludedReason }> = [];
  const rows: HoldoutRow[] = holdouts.map((h) => {
    const key = candidateKey(h.item);
    if (deferredKeys.has(key)) {
      excluded.push({ key, reason: "unprofiled" });
      return emptyRow(h, key, "unprofiled");
    }
    const keptHit = kept.find((c) => c.key === key);
    if (!keptHit) {
      // Removed by a hard filter (hidden, muted, logged, time…). Which step is the
      // filter's business; for eval it is one bucket: removed, with the reason.
      excluded.push({ key, reason: "filtered" });
      return emptyRow(h, key, "filtered");
    }
    const rank = ordered.findIndex((s) => s.candidate.key === key);
    if (rank === -1 || !keptHit) {
      // Impossible after the kept check; defensive only.
      excluded.push({ key, reason: "not_generated" });
      return emptyRow(h, key, "not_generated");
    }
    return rankedRow(h, key, rank, ordered[rank]);
  });
  return { rows, excluded };
}

/**
 * D.1 leave-one-loved-out. One holdout at a time, each with its own rebuilt profile.
 * Band and route are REPORTED per row; nothing here re-ranks.
 */
export function leaveOneLovedOut(args: {
  library: EntryWithContext[];
  phases: Phase[];
  prefs: TastePrefs;
  canon: MediaItem[];
  pool: MediaItem[];
  now: Date;
}): LeaveOneOutReport {
  const { library, phases, prefs, canon, pool, now } = args;
  const loved = lovedWithProfile(library);
  const rows: HoldoutRow[] = [];
  const excluded: Array<{ key: string; reason: ExcludedReason }> = [];
  for (const h of loved) {
    const lib2 = library.filter((e) => e.entry.id !== h.entry.id);
    const run = evalRun({ library: lib2, phases, prefs, holdouts: [h], canon, pool, now });
    rows.push(...run.rows);
    excluded.push(...run.excluded);
  }
  const ranked = rows.filter((r): r is HoldoutRow & { rank: number } => r.rank !== null);
  return {
    n: ranked.length,
    excluded,
    hit5: ranked.length ? ranked.filter((r) => r.rank <= 5).length / ranked.length : 0,
    hit20: ranked.length ? ranked.filter((r) => r.rank <= 20).length / ranked.length : 0,
    mrr: ranked.length ? ranked.reduce((a, r) => a + 1 / r.rank, 0) / ranked.length : 0,
    median_rank: median(ranked.map((r) => r.rank)),
    rows,
  };
}

/**
 * D.2 temporal holdout: dated loved entries split 70/30 by entryDate; training keeps
 * everything before T plus all undated entries; every holdout is injected at once.
 * Fewer than 5 holdouts after the split → skipped (§D.2).
 */
export type TemporalReport = {
  skipped: "fewer than 5 holdouts";
} | {
  skipped: null;
  t: string;
  n_train: number;
  n_holdout: number;
  unprofiled_share: number;
  hit5: number;
  hit20: number;
  mrr: number;
};

export function temporalHoldout(args: {
  library: EntryWithContext[];
  phases: Phase[];
  prefs: TastePrefs;
  canon: MediaItem[];
  pool: MediaItem[];
  now: Date;
}): TemporalReport {
  const { library, phases, prefs, canon, pool, now } = args;
  // The split is over ALL dated loved entries — profile or not (review P2-1). Selecting
  // only profiled entries first would drop unprofiled holdouts before their share could
  // be measured: with the newest six unprofiled, the report showed five different
  // holdouts and unprofiled_share 0. Unprofiled holdouts are injected and then deferred
  // by the filter run, which is exactly the "unprofiled" bucket below.
  const datedLoved = library
    .filter((e) => e.entry.status !== "want" && affinity(e) >= LOVED && isDated(e))
    .sort((a, b) => entryDate(a).getTime() - entryDate(b).getTime());
  if (datedLoved.length === 0) return { skipped: "fewer than 5 holdouts" };
  const idx = Math.floor(datedLoved.length * 0.7);
  const t = entryDate(datedLoved[Math.min(idx, datedLoved.length - 1)]).getTime();
  const holdouts = datedLoved.filter((e) => entryDate(e).getTime() >= t);
  if (holdouts.length < 5) return { skipped: "fewer than 5 holdouts" };

  const holdoutIds = new Set(holdouts.map((h) => h.entry.id));
  const train = library.filter((e) => !holdoutIds.has(e.entry.id) && (!isDated(e) || entryDate(e).getTime() < t));
  const P = buildUserProfile(train, phases, prefs, now);
  const { candidates } = candidatesForEval({ library: train, P, holdouts, canon, pool });
  const { kept, deferred } = filterCandidates({ candidates, library: train, prefs, filters: DEFAULT_FILTERS, recent: [], now });
  const { scored } = scoreCandidates(P, kept);
  const ordered = orderScored(scored, { surprise: false, userId: "eval" });

  const deferredKeys = new Set(deferred.map((c) => c.key));
  const keptKeys = new Set(kept.map((c) => c.key));
  const ranks: number[] = [];
  let unprofiled = 0;
  for (const h of holdouts) {
    if (usableProfile(h.item) === null || deferredKeys.has(candidateKey(h.item))) { unprofiled++; continue; }
    if (!keptKeys.has(candidateKey(h.item))) continue; // filtered: no rank, not unprofiled
    const rank = ordered.findIndex((s) => s.candidate.key === candidateKey(h.item));
    if (rank >= 0) ranks.push(rank + 1);
  }
  return {
    skipped: null,
    t: new Date(t).toISOString(),
    n_train: train.length,
    n_holdout: holdouts.length,
    unprofiled_share: holdouts.length ? unprofiled / holdouts.length : 0,
    hit5: ranks.length ? ranks.filter((r) => r <= 5).length / ranks.length : 0,
    hit20: ranks.length ? ranks.filter((r) => r <= 20).length / ranks.length : 0,
    mrr: ranks.length ? ranks.reduce((a, r) => a + 1 / r, 0) / ranks.length : 0,
  };
}

// ---------------------------------------------------------------------------
// D.3 component spread: where to look, never a failure (§D.3).
// ---------------------------------------------------------------------------

export type ComponentSpreadRow = {
  component: Component;
  mean: number;
  sd: number;
  min: number;
  max: number;
  zero_share: number;
  dead: boolean;
  dominant: boolean;
};

export function componentSpread(scored: ScoredCandidate[], P: UserProfile): ComponentSpreadRow[] {
  const components = Object.keys(W0) as Component[];
  const rows: ComponentSpreadRow[] = components.map((k) => {
    const vals = scored.map((s) => s.features[k]);
    const s = sd(vals);
    return {
      component: k,
      mean: mean(vals),
      sd: s,
      min: vals.length ? Math.min(...vals) : 0,
      max: vals.length ? Math.max(...vals) : 0,
      zero_share: vals.length ? vals.filter((v) => v === 0).length / vals.length : 0,
      dead: s < 0.02 && hasEvidence(P, k),
      dominant: false,
    };
  });
  // dominant: W0[k]·sd_k more than twice the next largest weighted spread (§D.3).
  const weighted = rows.map((r) => ({ k: r.component, w: W0[r.component] * r.sd }));
  weighted.sort((a, b) => b.w - a.w);
  const strongest = weighted[0];
  const next = weighted[1]?.w ?? 0;
  if (strongest && strongest.w > 0 && strongest.w > 2 * next) {
    rows.find((r) => r.component === strongest.k)!.dominant = true;
  }
  return rows;
}

/** "The component has evidence for the user" (§D.3): the profile side exists for k. */
function hasEvidence(P: UserProfile, k: Component): boolean {
  switch (k) {
    case "story": return P.story !== null;
    case "feeling": return P.feeling !== null;
    case "form": return Object.keys(P.form).length > 0;
    case "creator": return [...P.creators.values()].some((c) => c.weight >= 0.4);
    case "phase": return P.activePhase !== null;
    case "anti": return P.anti.story !== null || P.anti.feeling !== null;
  }
}

// ---------------------------------------------------------------------------
// D.4 cold start: the 10-canon-taps construction from pipeline.test.ts (§D.4).
// ---------------------------------------------------------------------------

export type ColdStartCategoryReport = {
  category: Category;
  results: number;
  categories_covered: Category[];
  routes: Route[];
  own_words_zero_share: number;
  quotas_met: boolean;
  mean_closeness: number;
};

export type ColdStartReport = {
  /** All five runs combined (the unfiltered request plus one per category, §D.4). */
  results: number;
  categories_covered: Category[];
  routes: Route[];
  own_words_zero_share: number;
  quotas_met: boolean;
  mean_closeness: number;
  per_category: ColdStartCategoryReport[];
  pass: { five_results: boolean; all_explained: boolean; story_evidence_all: boolean; no_feeling_route_with_own_words_anchor: boolean };
};

/** The ten loved canon taps, no notes — the pipeline.test.ts cold-start construction. */
export function coldStartLibrary(library: EntryWithContext[]): EntryWithContext[] {
  return library
    .slice(0, 10)
    .map((e) => ({
      ...e,
      entry: { ...e.entry, private_score: null, origin: "canon" as const },
      reactions: e.reactions.map((r) => ({ ...r, raw_note: null, dimensions: { loved: true } })),
      extractions: [],
    }));
}

export function coldStart(args: {
  library: EntryWithContext[];
  phases: Phase[];
  prefs: TastePrefs;
  canon: MediaItem[];
  pool: MediaItem[];
  now: Date;
}): ColdStartReport {
  const { library, phases, prefs, canon, pool, now } = args;
  const P = buildUserProfile(library, phases, prefs, now);
  const { candidates, sourceCounts, merged } = generateCandidates({
    library, P, filters: { ...DEFAULT_FILTERS, limit: 5 }, canon, creatorResults: new Map(), pool,
  });
  const run = rankPipeline({
    P, library, prefs, candidates, filters: { ...DEFAULT_FILTERS, limit: 5 }, recent: [], userId: "eval-cold-start", now, sourceCounts, merged,
  });
  // §D.4: the unfiltered request, then once for each of the four categories (review P2-4
  // — the category runs were missing entirely). Same candidates, category filter set.
  const categoryRuns = (["movie", "tv", "anime", "book"] as Category[]).map((category) => {
    const cat = rankPipeline({
      P, library, prefs, candidates, filters: { ...DEFAULT_FILTERS, limit: 5, category }, recent: [], userId: "eval-cold-start", now, sourceCounts, merged,
    });
    return { category, snapshots: cat.snapshots, quota_unfilled: cat.context.policy.quota_unfilled as string[] };
  });
  const snaps = run.snapshots;
  const combined = [...snaps, ...categoryRuns.flatMap((r) => r.snapshots)];
  const routes = combined.map((s) => s.route);
  // The engine's own bookkeeping (§7.2): the top-level flag describes the UNFILTERED
  // cold-start request — the one a new user actually gets, and the one §D.4's pass
  // conditions scope to. Each category run reports its own quotas_met in per_category
  // (on the fixture taps the movie/tv/book runs leave an adjacent/stretch seat unfilled:
  // their candidates cluster in familiar; anime fills).
  const quotaUnfilled = run.context.policy.quota_unfilled as string[];
  const quotasMet = quotaUnfilled.length === 0;
  const noFeelingOwnWords = !combined.some((s) => s.route === "feeling" && s.anchor?.ownWords);
  const perCategory = categoryRuns.map((r) => ({
    category: r.category,
    results: r.snapshots.length,
    categories_covered: [...new Set(r.snapshots.map((s) => s.item.category))],
    routes: r.snapshots.map((s) => s.route),
    own_words_zero_share: r.snapshots.length ? r.snapshots.filter((s) => s.indicators.own_words === 0).length / r.snapshots.length : 0,
    quotas_met: r.quota_unfilled.length === 0,
    mean_closeness: mean(r.snapshots.map((s) => s.rerank.closeness)),
  }));
  return {
    results: combined.length,
    categories_covered: [...new Set(combined.map((s) => s.item.category))],
    routes,
    own_words_zero_share: combined.length ? combined.filter((s) => s.indicators.own_words === 0).length / combined.length : 0,
    quotas_met: quotasMet,
    mean_closeness: mean(combined.map((s) => s.rerank.closeness)),
    per_category: perCategory,
    pass: {
      five_results: snaps.length === 5,
      all_explained: combined.every((s) => s.explanation.length > 0),
      story_evidence_all: combined.every((s) => s.has_evidence.story),
      no_feeling_route_with_own_words_anchor: noFeelingOwnWords,
    },
  };
}

// ---------------------------------------------------------------------------
// D.5 redundancy and diversity: seven simulated days, logged not thresholded.
// ---------------------------------------------------------------------------

export type DiversityReport = {
  days: Array<{ day: number; keys: string[] }>;
  mean_consecutive_jaccard: number;
  bridge_share: number;
  mean_intra_list_diversity: { story: number; feeling: number };
  max_theme_share: number;
};

const jaccard = (a: string[], b: string[]): number => {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter((k) => B.has(k)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
};

export function diversityRun(args: {
  library: EntryWithContext[];
  phases: Phase[];
  prefs: TastePrefs;
  canon: MediaItem[];
  pool: MediaItem[];
  now: Date;
  days?: number;
}): DiversityReport {
  const { library, phases, prefs, canon, pool, now } = args;
  const DAYS = args.days ?? 7;
  const P = buildUserProfile(library, phases, prefs, now);
  const { candidates, sourceCounts, merged } = generateCandidates({
    library, P, filters: { ...DEFAULT_FILTERS, limit: 5 }, canon, creatorResults: new Map(), pool,
  });
  const shown: string[][] = [];
  const bridges: boolean[] = [];
  for (let d = 0; d < DAYS; d++) {
    const day = new Date(now.getTime() + d * 86_400_000);
    const recent: RecentImpression[] = shown.flatMap((keys, i) =>
      keys.map((key) => ({ key, shownAt: new Date(now.getTime() + i * 86_400_000).toISOString() })),
    );
    const run = rankPipeline({
      P, library, prefs, candidates, filters: { ...DEFAULT_FILTERS, limit: 5 }, recent, userId: "eval-diversity", now: day, sourceCounts, merged,
    });
    shown.push(run.snapshots.map((s) => s.key));
    bridges.push(run.snapshots.some((s) => s.indicators.is_cross_media === 1));
  }
  const jacs: number[] = [];
  for (let d = 1; d < shown.length; d++) jacs.push(jaccard(shown[d - 1], shown[d]));
  // Intra-list diversity per family: 1 − the engine's own simFamily between every pair on
  // a day's list (review P2-2 — key-name Jaccard ignored the weights and overstated it).
  const intra = { story: [] as number[], feeling: [] as number[] };
  // Theme share per DAY — the largest weighted theme.'s share of that day's own slots —
  // and the report takes the weekly max (review P2-2; a week-wide average hid the peaks).
  let maxThemeShare = 0;
  for (const keys of shown) {
    const snaps = keys
      .map((k) => candidates.find((c) => c.key === k))
      .filter((c): c is StageCandidate => !!c);
    for (const family of ["story", "feeling"] as Family[]) {
      for (let i = 0; i < snaps.length; i++) {
        for (let j = i + 1; j < snaps.length; j++) {
          const a = snaps[i].item.profile?.vector[family] ?? {};
          const b = snaps[j].item.profile?.vector[family] ?? {};
          intra[family].push(1 - simFamily(family, a, b));
        }
      }
    }
    const themeCount = new Map<string, number>();
    for (const c of snaps) {
      for (const [k, w] of Object.entries(c.item.profile?.vector.story ?? {})) {
        if (k.startsWith("theme.") && w >= 0.5) themeCount.set(k, (themeCount.get(k) ?? 0) + 1);
      }
    }
    const dayMax = snaps.length ? Math.max(0, ...[...themeCount.values()].map((n) => n / snaps.length)) : 0;
    maxThemeShare = Math.max(maxThemeShare, dayMax);
  }
  return {
    days: shown.map((keys, day) => ({ day, keys })),
    mean_consecutive_jaccard: mean(jacs),
    bridge_share: bridges.length ? bridges.filter(Boolean).length / bridges.length : 0,
    mean_intra_list_diversity: { story: mean(intra.story), feeling: mean(intra.feeling) },
    max_theme_share: maxThemeShare,
  };
}

// ---------------------------------------------------------------------------
// Closeness distribution (§E Q2 input): P10/P50/P90 and the band shares at the
// CURRENT thresholds — reported, never changed here.
// ---------------------------------------------------------------------------

export type ClosenessReport = {
  p10: number;
  p50: number;
  p90: number;
  bands: { familiar: number; adjacent: number; stretch: number };
};

export function closenessDistribution(scored: ScoredCandidate[], closenessOf: (s: ScoredCandidate) => number): ClosenessReport {
  const vals = scored.map(closenessOf).sort((a, b) => a - b);
  const at = (p: number) => {
    if (vals.length === 0) return 0;
    const idx = Math.min(vals.length - 1, Math.max(0, Math.ceil((p / 100) * vals.length) - 1));
    return vals[idx];
  };
  const share = (lo: number, hi: number) =>
    vals.length ? vals.filter((v) => v >= lo && v < hi).length / vals.length : 0;
  return {
    p10: at(10),
    p50: at(50),
    p90: at(90),
    bands: {
      familiar: share(BAND.familiar, Number.POSITIVE_INFINITY),
      adjacent: share(BAND.adjacent, BAND.familiar),
      stretch: share(Number.NEGATIVE_INFINITY, BAND.adjacent),
    },
  };
}
