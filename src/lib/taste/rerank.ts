// The re-ranker (SPEC-STAGE3 §7): band quotas, diversity caps and bridge repair,
// as selection passes over an already-ordered scored list. Pure and deterministic:
// the input `ordered` arrives in orderScored order, every pass stops at the limit,
// a short list stays short, and nothing here mutates a score — stored numbers always
// equal what was computed (§7.4, §12.8).
import type { Filters, RerankInfo } from "./snapshot";
import type { PipelineFilters } from "./filters";
import type { ScoredCandidate } from "./score";
import { anchorOf, routeOf } from "./explain";
import { BAND, CREATOR_CAP, QUOTAS } from "./weights";

export type Band = "familiar" | "adjacent" | "stretch";

/** The per-length quota table (§7.2): fixed for L 1–5, computed for L ≥ 6. */
export function quotasFor(L: number): { familiar: number; adjacent: number; stretch: number } {
  const fixed = QUOTAS[L];
  if (fixed) return { ...fixed };
  const adjacent = Math.round(0.2 * L);
  const stretch = Math.max(1, Math.round(0.1 * L));
  return { familiar: L - adjacent - stretch, adjacent, stretch };
}

/**
 * Closeness (§7.1): the mean of the two calibrated anchor maxima Session 5 already
 * computed. Recomputing any similarity here would risk disagreeing with the stored
 * numbers, so this only reads them.
 */
export function closeness(s: ScoredCandidate): number {
  return 0.5 * (s.anchors.story?.sim ?? 0) + 0.5 * (s.anchors.feeling?.sim ?? 0);
}

export function bandOf(c: number): Band {
  if (c >= BAND.familiar) return "familiar";
  if (c >= BAND.adjacent) return "adjacent";
  return "stretch";
}

/** A bridge reaches across media: its route anchor sits in a different category (§7.4). */
export function isBridge(s: ScoredCandidate, filters: Filters): boolean {
  const anchor = anchorOf(s, routeOf(s, filters));
  return anchor !== null && anchor.anchor.category !== s.candidate.item.category;
}

/** Story themes the item carries strongly (§7.3). */
function themes(s: ScoredCandidate): string[] {
  const story = s.candidate.item.profile?.vector.story ?? {};
  return Object.keys(story).filter((k) => k.startsWith("theme.") && (story[k] ?? 0) >= 0.5);
}

export function rerank(
  ordered: ScoredCandidate[],
  filters: PipelineFilters,
): {
  out: Array<{ scored: ScoredCandidate; rerank: RerankInfo }>;
  policy: { quotas: ReturnType<typeof quotasFor>; quota_unfilled: Band[]; caps_relaxed: Array<"theme" | "category"> };
} {
  const L = filters.limit;
  const quotas = quotasFor(L);
  const quota = { ...quotas };
  const categoryCap = Math.ceil(L / 2);
  const themeCap = Math.ceil(L / 2);
  const asFilters: Filters = { listOnly: filters.listOnly, surprise: filters.surprise };

  const perCreator = new Map<string, number>();
  const perCategory = new Map<string, number>();
  const perTheme = new Map<string, number>();
  const chosen = new Set<string>();
  const out: Array<{ scored: ScoredCandidate; rerank: RerankInfo }> = [];
  const caps_relaxed = new Set<"theme" | "category">();

  const creatorOk = (s: ScoredCandidate) => {
    const k = s.candidate.creatorKey;
    return k === null || (perCreator.get(k) ?? 0) < CREATOR_CAP; // never relaxed (§7.3)
  };
  const categoryOk = (s: ScoredCandidate, relax: boolean) => {
    if (filters.category !== null) return true; // the user asked for this category
    const n = perCategory.get(s.candidate.item.category) ?? 0;
    return relax || n < categoryCap;
  };
  const themeOk = (s: ScoredCandidate, relax: boolean) => {
    if (relax) return true;
    return themes(s).every((t) => (perTheme.get(t) ?? 0) < themeCap);
  };
  const admissible = (s: ScoredCandidate, relaxTheme: boolean, relaxCategory: boolean) =>
    creatorOk(s) && themeOk(s, relaxTheme) && categoryOk(s, relaxCategory);

  const add = (s: ScoredCandidate, pass: 1 | 2 | 3, bridge_repair = false) => {
    const band = bandOf(closeness(s));
    const k = s.candidate.creatorKey;
    if (k !== null) perCreator.set(k, (perCreator.get(k) ?? 0) + 1);
    perCategory.set(s.candidate.item.category, (perCategory.get(s.candidate.item.category) ?? 0) + 1);
    for (const t of themes(s)) perTheme.set(t, (perTheme.get(t) ?? 0) + 1);
    chosen.add(s.candidate.key);
    out.push({ scored: s, rerank: { band, closeness: closeness(s), pass, bridge_repair } });
  };

  // Pass 1: quota-respecting (§7.2). quota_unfilled = bands still short afterwards.
  for (const s of ordered) {
    if (out.length >= L) break;
    const band = bandOf(closeness(s));
    if (quota[band] > 0 && admissible(s, false, false)) {
      add(s, 1);
      quota[band]--;
    }
  }
  const quota_unfilled: Band[] = [];
  for (const band of ["familiar", "adjacent", "stretch"] as const) {
    if (quota[band] > 0) quota_unfilled.push(band);
  }

  // Pass 2: fill remaining seats from any band.
  for (const s of ordered) {
    if (out.length >= L) break;
    if (chosen.has(s.candidate.key)) continue;
    if (admissible(s, false, false)) add(s, 2);
  }

  // Pass 3: relax the theme cap, then the category cap too. A cap is listed only if
  // relaxing it actually admitted someone (§C30 "as applicable").
  const beforeTheme = out.length;
  for (const s of ordered) {
    if (out.length >= L) break;
    if (chosen.has(s.candidate.key)) continue;
    if (admissible(s, true, false)) add(s, 3);
  }
  if (out.length > beforeTheme) caps_relaxed.add("theme");

  const beforeCategory = out.length;
  for (const s of ordered) {
    if (out.length >= L) break;
    if (chosen.has(s.candidate.key)) continue;
    if (admissible(s, true, true)) add(s, 3);
  }
  if (out.length > beforeCategory) caps_relaxed.add("category");

  // Bridge repair (§7.4): only when no result is a bridge and some scored candidate is.
  // The repaired row keeps its computed score and records how it got here.
  if (out.length > 0 && !out.some((x) => isBridge(x.scored, asFilters))) {
    const b = ordered.find(
      (s) => !chosen.has(s.candidate.key) && isBridge(s, asFilters) && creatorOk(s),
    );
    if (b) {
      const band = bandOf(closeness(b));
      const victimIndex = (() => {
        for (let i = out.length - 1; i >= 0; i--) if (out[i]!.rerank.band === band) return i;
        return out.length - 1;
      })();
      const victim = out[victimIndex]!;
      const vk = victim.scored.candidate.creatorKey;
      if (vk !== null) perCreator.set(vk, Math.max(0, (perCreator.get(vk) ?? 1) - 1));
      const vcat = victim.scored.candidate.item.category;
      perCategory.set(vcat, Math.max(0, (perCategory.get(vcat) ?? 1) - 1));
      for (const t of themes(victim.scored)) perTheme.set(t, Math.max(0, (perTheme.get(t) ?? 1) - 1));
      chosen.delete(victim.scored.candidate.key);
      out[victimIndex] = { scored: b, rerank: { band: bandOf(closeness(b)), closeness: closeness(b), pass: 3, bridge_repair: true } };
      chosen.add(b.candidate.key);
      const bk = b.candidate.creatorKey;
      if (bk !== null) perCreator.set(bk, (perCreator.get(bk) ?? 0) + 1);
    }
  }

  // §7.4: the displayed order is score descending, key ascending — including in
  // surprise mode, where only the candidate order fed in differs.
  out.sort(
    (a, b) =>
      b.scored.score - a.scored.score ||
      a.scored.candidate.key.localeCompare(b.scored.candidate.key),
  );
  return { out, policy: { quotas, quota_unfilled, caps_relaxed: [...caps_relaxed] } };
}
