import "server-only";
import type { Db } from "./entries";
import { loadLibrary, upsertMediaItem } from "./entries";
import { CANON } from "@/lib/catalog/canon-data";
import { canonToResult } from "@/lib/catalog/canon";
import { adapterFor } from "@/lib/catalog";
import { getExplainer } from "@/lib/ai/explainer";
import { entryVector } from "@/lib/taste/affinity";
import { buildPortrait } from "@/lib/taste/portrait";
import { scoreCandidates, type Candidate, type RecommendFilters } from "@/lib/taste/recommend";
import { buildTagProfile, EMPTY_TASTE_PREFS, type TagProfile, type TastePrefs } from "@/lib/taste/tags";
import type { Category, EntryWithContext, MediaItem, Recommendation } from "@/lib/types";
import type { QuerySessionsRow } from "@/lib/db/types";

/** Reads the optional pinned / muted / hidden lists out of the user's prefs blob. */
export async function loadTastePrefs(db: Db, userId: string): Promise<TastePrefs> {
  const { data } = await db.from("users").select("onboarding_prefs").eq("id", userId).maybeSingle();
  const prefs = (data?.onboarding_prefs as { taste?: Partial<TastePrefs> } | null) ?? {};
  const taste = prefs.taste ?? {};
  return {
    pinned: Array.isArray(taste.pinned) ? taste.pinned : [],
    muted: Array.isArray(taste.muted) ? taste.muted : [],
    hidden: Array.isArray(taste.hidden) ? taste.hidden : [],
  };
}

/**
 * Candidate generation without popularity: the user's own backlog, the built-in
 * canon, and other works by creators they keep returning to.
 */
async function buildCandidates(library: EntryWithContext[], profile: TagProfile, filters: RecommendFilters): Promise<Candidate[]> {
  const inLibrary = new Set(library.map((e) => `${e.item.source}:${e.item.external_id}`));
  // Title-level dedupe across categories: the novel of a series they watched is not a discovery.
  const byTitle = new Set(library.map((e) => e.item.title.toLowerCase()));
  const out: Candidate[] = [];

  for (const e of library) {
    if (e.entry.status === "want") out.push({ item: e.item, entryId: e.entry.id, vector: entryVector(e) ?? e.item.feel_prior });
  }
  if (filters.listOnly || filters.surprise) return out;

  for (const c of CANON) {
    if (inLibrary.has(`canon:${c.slug}`) || byTitle.has(c.title.toLowerCase())) continue;
    if (filters.category && c.category !== filters.category) continue;
    const r = canonToResult(c);
    out.push({ item: { ...r, id: `canon:${c.slug}`, feel_prior: r.feel_prior ?? null }, vector: r.feel_prior ?? null });
  }

  // Creator expansion, driven by the shared profile so candidate generation and
  // scoring agree on who the user keeps returning to.
  const creators = [...profile.creators.values()]
    .filter((c) => (!filters.category || c.category === filters.category) && c.weight >= 0.4)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  await Promise.all(creators.map(async (g) => {
    const adapter = adapterFor(g.category);
    if (!adapter.byCreator) return;
    try {
      const results = await adapter.byCreator(g.name, g.category);
      for (const r of results.slice(0, 5)) {
        if (inLibrary.has(`${r.source}:${r.external_id}`) || byTitle.has(r.title.toLowerCase())) continue;
        out.push({ item: { ...r, id: `${r.source}:${r.external_id}`, feel_prior: r.feel_prior ?? null }, vector: r.feel_prior ?? null, creatorOf: g.entryIds });
      }
    } catch (err) {
      console.warn("[recommend] creator expansion skipped:", (err as Error).message);
    }
  }));
  return out;
}

export async function buildRecommendations(
  db: Db,
  userId: string,
  filters: RecommendFilters,
  opts: { library?: EntryWithContext[]; prefs?: TastePrefs; kind?: QuerySessionsRow["kind"]; explain?: boolean } = {},
): Promise<Recommendation[]> {
  const library = opts.library ?? (await loadLibrary(db, userId));
  const prefs = opts.prefs ?? (await loadTastePrefs(db, userId).catch(() => EMPTY_TASTE_PREFS));
  const profile = buildTagProfile(library, prefs);
  const candidates = await buildCandidates(library, profile, filters);
  let recs = scoreCandidates(library, candidates, filters, userId, profile);
  if (opts.explain !== false) {
    const portrait = buildPortrait(library);
    recs = await getExplainer().explain(recs, portrait.headline);
  }
  await db.from("query_sessions").insert({
    user_id: userId, kind: opts.kind ?? "recommend", category: filters.category ?? null,
    answers: filters as unknown as QuerySessionsRow["answers"],
    results: recs.map((r) => ({
      id: r.item.id, title: r.item.title, category: r.item.category, score: r.score, route: r.route,
      matchedTags: r.breakdown.matchedTags.map((m) => m.tag), bridge: r.bridge?.entryId ?? null,
    })) as unknown as QuerySessionsRow["results"],
  });
  return recs;
}

/** Recommended items that do not exist in media_items yet are keyed "source:external_id"; this makes them real rows on demand. */
export async function materialise(item: MediaItem): Promise<MediaItem> {
  if (!item.id.includes(":")) return item;
  return upsertMediaItem({ ...item, feel_prior: item.feel_prior });
}

export type { Category };
