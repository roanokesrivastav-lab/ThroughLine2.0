import type { AttributeVector, Category, EntryWithContext, Phase } from "@/lib/types";
import { CATEGORY_PLURAL } from "@/lib/types";
import { affinity, entryDate, hasOwnWords, isDated } from "./affinity";
import { categoryMix, relativeTags, tasteCentroid } from "./portrait";
import { adjective, describeKey } from "./vocabulary";

export type PeriodKey = string; // "2024" or "2024-H1"

export type PeriodSummary = {
  key: PeriodKey;
  label: string;
  start: string;
  end: string;
  entryCount: number;
  categoryMix: Array<{ category: Category; share: number; count: number }>;
  centroid: AttributeVector | null;
  topTags: Array<{ key: string; weight: number; label: string }>;
  rising: Array<{ key: string; delta: number; label: string }>;
  falling: Array<{ key: string; delta: number; label: string }>;
  representative: string[];       // entry ids
  phases: Phase[];
  narrative: string[];
};

export type Evolution = {
  granularity: "year" | "half";
  periods: PeriodSummary[];
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function periodOf(d: Date, granularity: "year" | "half"): PeriodKey {
  const y = d.getUTCFullYear();
  return granularity === "year" ? `${y}` : `${y}-H${d.getUTCMonth() < 6 ? 1 : 2}`;
}
export function periodBounds(key: PeriodKey): { start: string; end: string; label: string } {
  const [y, h] = key.split("-");
  if (!h) return { start: `${y}-01-01`, end: `${y}-12-31`, label: y };
  return h === "H1"
    ? { start: `${y}-01-01`, end: `${y}-06-30`, label: `Early ${y}` }
    : { start: `${y}-07-01`, end: `${y}-12-31`, label: `Late ${y}` };
}

/** Period-over-period portrait of how taste shifted. Editorial, not a dashboard. */
export function buildEvolution(entries: EntryWithContext[], phases: Phase[]): Evolution {
  // Undated entries have no period to belong to.
  const logged = entries.filter((e) => e.entry.status !== "want" && isDated(e));
  if (logged.length === 0) return { granularity: "year", periods: [] };
  const dates = logged.map(entryDate).sort((a, b) => a.getTime() - b.getTime());
  const spanYears = (dates[dates.length - 1].getTime() - dates[0].getTime()) / (365 * 86_400_000);
  const granularity: "year" | "half" = spanYears < 1.6 ? "half" : "year";

  const groups = new Map<PeriodKey, EntryWithContext[]>();
  for (const e of logged) {
    const k = periodOf(entryDate(e), granularity);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const keys = [...groups.keys()].sort();
  const periods: PeriodSummary[] = [];
  let prev: PeriodSummary | null = null;

  for (const key of keys) {
    const items = groups.get(key)!;
    const bounds = periodBounds(key);
    const c = tasteCentroid(items);
    const mix = categoryMix(items);
    const tags = c ? relativeTags(c, 5) : [];

    const rising: PeriodSummary["rising"] = [];
    const falling: PeriodSummary["falling"] = [];
    if (prev?.centroid && c) {
      const allKeys = new Set([...Object.keys(prev.centroid), ...Object.keys(c)].filter((k) => k.includes(".")));
      for (const k of allKeys) {
        const delta = (c[k] ?? 0) - (prev.centroid[k] ?? 0);
        if (delta >= 0.12) rising.push({ key: k, delta, label: describeKey(k) });
        if (delta <= -0.12) falling.push({ key: k, delta, label: describeKey(k) });
      }
      rising.sort((a, b) => b.delta - a.delta);
      falling.sort((a, b) => a.delta - b.delta);
    }

    const representative = [...items]
      .sort((a, b) => (affinity(b) + (hasOwnWords(b) ? 0.2 : 0)) - (affinity(a) + (hasOwnWords(a) ? 0.2 : 0)))
      .slice(0, 4)
      .map((e) => e.entry.id);

    const periodPhases = phases.filter((p) => !p.dismissed && p.start_at <= bounds.end && p.end_at >= bounds.start);

    const narrative: string[] = [];
    const tonal = tags.filter((t) => !t.key.startsWith("theme.")).slice(0, 2);
    const themes = tags.filter((t) => t.key.startsWith("theme.")).slice(0, 2);
    if (tonal.length) narrative.push(`${bounds.label} leaned ${tonal.map((t) => adjective(t.key)).join(" and ")}${themes.length ? `, circling ${themes.map((t) => describeKey(t.key)).join(" and ")}` : ""}.`);
    else narrative.push(`${items.length} ${items.length === 1 ? "thing" : "things"} in ${bounds.label}.`);
    if (prev) {
      const prevTop = prev.categoryMix[0], top = mix[0];
      if (top && prevTop && top.category !== prevTop.category) narrative.push(`${cap(CATEGORY_PLURAL[top.category])} took over from ${CATEGORY_PLURAL[prevTop.category].toLowerCase()}.`);
      else if (top && prevTop && top.share - prevTop.share > 0.2) narrative.push(`${cap(CATEGORY_PLURAL[top.category])} took up more room than before.`);
      if (rising[0]) narrative.push(`More ${rising[0].label} than the period before${falling[0] ? `, less ${falling[0].label}` : ""}.`);
      else if (falling[0]) narrative.push(`Less ${falling[0].label} than the period before.`);
    }
    if (periodPhases[0]) narrative.push(`${periodPhases[0].user_label ?? periodPhases[0].label} ran through it.`);

    const summary: PeriodSummary = {
      key, label: bounds.label, start: bounds.start, end: bounds.end, entryCount: items.length,
      categoryMix: mix, centroid: c, topTags: tags, rising: rising.slice(0, 3), falling: falling.slice(0, 3),
      representative, phases: periodPhases, narrative: narrative.slice(0, 3),
    };
    periods.push(summary);
    prev = summary;
  }
  return { granularity, periods: periods.reverse() };
}
