// Candidate generation (SPEC-STAGE3 §5), Session 7A. Pure: no database, no network,
// no clock. The server wrapper (server/stage-recommend.ts) loads and hydrates the pool
// and creator results, then calls generateCandidates; the pipeline filters and scores
// what comes out. Music never enters: it is profiled, never matched (§E Q1).
import type { Category, EntryWithContext, MediaItem } from "@/lib/types";
import { norm } from "@/lib/catalog/canon";
import { normaliseTags } from "./tag-lexicon";
import { simFamily } from "./vector";
import { usableProfile, type UserProfile } from "./profile";
import type { PipelineFilters } from "./filters";
import type { Source, StageCandidate } from "./score";
import { SOURCE_ORDER } from "./score";
import { CREATOR_EXPAND_MIN_WEIGHT, CREATOR_RESULTS_EACH, CREATOR_TOP, NEIGHBOUR_TOP, PHASE_TOP } from "./weights";
import { candidateKey, primaryCreator } from "./tags";

/** A creator the expansion should fetch other works for (§5). */
export type CreatorQuery = { creatorKey: string; name: string; category: Category };

/**
 * Loved-creator queries (§5): weight ≥ 0.4, in the requested category when one is set,
 * never music, strongest first with ties by key, at most CREATOR_TOP. Off entirely for
 * listOnly and surprise — both show the user's own list and nothing else.
 */
export function creatorQueries(P: UserProfile, filters: PipelineFilters): CreatorQuery[] {
  if (filters.listOnly || filters.surprise) return [];
  return [...P.creators.values()]
    .filter(
      (c) =>
        c.weight >= CREATOR_EXPAND_MIN_WEIGHT &&
        c.category !== "music" &&
        (filters.category === null || c.category === filters.category),
    )
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, CREATOR_TOP)
    .map((c) => ({ creatorKey: c.key, name: c.name, category: c.category }));
}

/** A candidate between generation and the merges: item, entryId, and the sources that produced it. */
type RawEntry = { item: MediaItem; entryId: string | null; sources: Source[] };

export function generateCandidates(args: {
  library: EntryWithContext[];
  P: UserProfile;
  filters: PipelineFilters;
  /** CANON as items with id `canon:<slug>` and the committed canonProfile attached (§2.4 step 2). */
  canon: MediaItem[];
  /** creatorKey → results, already hydrated to MediaItems (§2.2–§2.4). */
  creatorResults: Map<string, MediaItem[]>;
  /** The profiled pool, already loaded and library-excluded (§2.2). */
  pool: MediaItem[];
}): { candidates: StageCandidate[]; sourceCounts: Record<Source, number>; merged: number } {
  const { library, P, filters, canon, creatorResults, pool } = args;
  const sourceCounts = SOURCE_ORDER.reduce((acc, s) => {
    acc[s] = 0;
    return acc;
  }, {} as Record<Source, number>);

  // Library identity, both ways a source can double-count: the source:external_id key
  // (a canon entry's key is canon:<slug>) and the normalised title.
  const libraryKeys = new Set(library.map((e) => candidateKey(e.item)));
  const titles = new Map<string, EntryWithContext>();
  for (const e of library) titles.set(norm(e.item.title), e);

  const raw: RawEntry[] = [];
  const push = (source: Source, item: MediaItem, entryId: string | null) => {
    sourceCounts[source]++;
    raw.push({ item, entryId, sources: [source] });
  };

  // Backlog: every "want" entry, whatever the filters say. It is the user's own list.
  for (const e of library) {
    if (e.entry.status === "want") push("backlog", e.item, e.entry.id);
  }

  // Everything else is disabled for listOnly and surprise (§5).
  if (!filters.listOnly && !filters.surprise) {
    // Canon: the committed deck, in the four matched categories, minus what the library
    // already holds by key or by normalised title.
    for (const c of canon) {
      if (c.category === "music") continue;
      if (filters.category !== null && c.category !== filters.category) continue;
      if (libraryKeys.has(candidateKey(c)) || titles.has(norm(c.title))) continue;
      push("canon", c, null);
    }

    // Creator expansion: the first CREATOR_RESULTS_EACH of each query's hydrated results,
    // minus library matches by key or by title. An adapter result and an existing row
    // share the same key after hydration, so the key check covers both.
    for (const results of creatorResults.values()) {
      for (const item of results.slice(0, CREATOR_RESULTS_EACH)) {
        if (item.category === "music") continue;
        if (libraryKeys.has(candidateKey(item)) || titles.has(norm(item.title))) continue;
        push("creator", item, null);
      }
    }

    // Neighbours: the pool ranked by raw family similarity to the centroid. Calibration
    // is monotone, so the raw score orders identically (DECISIONS below); ties by key so
    // the cut never depends on pool order.
    const neighbour = (family: "story" | "feeling", source: Source) => {
      const fp = P[family];
      if (!fp) return;
      const ranked = pool
        .filter((item) => item.category !== "music" && usableProfile(item) !== null)
        .map((item) => {
          const vec = usableProfile(item)!.vector[family];
          return { item, sim: simFamily(family, vec, fp.centroid) };
        })
        .sort((a, b) => b.sim - a.sim || candidateKey(a.item).localeCompare(candidateKey(b.item)))
        .slice(0, NEIGHBOUR_TOP);
      for (const { item } of ranked) push(source, item, null);
    };
    neighbour("story", "story_neighbour");
    neighbour("feeling", "feeling_neighbour");

    // Phase (§5): the one active phase narrows the pool by its own rule.
    const ph = P.activePhase;
    if (ph) {
      const ranked = pool
        .filter((item) => item.category !== "music" && usableProfile(item) !== null)
        .map((item) => {
          const profile = usableProfile(item)!;
          if (ph.kind === "feeling_cluster") {
            const gate = profile.vector.feeling[ph.key] ?? 0;
            return { item, ok: gate >= 0.5, sim: simFamily("feeling", profile.vector.feeling, P.feeling?.centroid ?? {}) };
          }
          if (ph.kind === "genre_run") {
            const ok = normaliseTags(item.genre_tags).includes(ph.key);
            return { item, ok, sim: simFamily("story", profile.vector.story, P.story?.centroid ?? {}) };
          }
          return { item, ok: false, sim: 0 }; // category_stretch adds no candidates
        })
        .filter((x) => x.ok)
        .sort((a, b) => b.sim - a.sim || candidateKey(a.item).localeCompare(candidateKey(b.item)))
        .slice(0, PHASE_TOP);
      for (const { item } of ranked) push("phase", item, null);
    }
  }

  const candidates = dedupe(raw);
  return { candidates, sourceCounts, merged: candidates.length };
}

// ---------------------------------------------------------------------------
// Deduplication (§5), in order: merge by key, then by (category, norm(title)).
// Sources union in SOURCE_ORDER with no duplicates; entryId survives if any copy
// had one; the backlog copy always wins its merge.
// ---------------------------------------------------------------------------

function unionSources(groups: Source[][]): Source[] {
  const seen = new Set<Source>();
  const out: Source[] = [];
  for (const group of groups) {
    for (const s of group) {
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out.sort((a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b));
}

function toCandidate(raw: RawEntry): StageCandidate {
  const creator = primaryCreator(raw.item);
  return {
    key: candidateKey(raw.item),
    item: raw.item,
    entryId: raw.entryId,
    sources: unionSources([raw.sources]),
    creatorKey: creator ? `${raw.item.category}:${creator.name.toLowerCase()}` : null,
  };
}

/** Merge 1: identical keys are one candidate. The backlog copy's item wins (§5). */
function mergeByKey(raw: RawEntry[]): StageCandidate[] {
  const byKey = new Map<string, RawEntry[]>();
  for (const r of raw) {
    const key = candidateKey(r.item);
    const group = byKey.get(key);
    if (group) group.push(r);
    else byKey.set(key, [r]);
  }

  const out: StageCandidate[] = [];
  for (const [key, group] of byKey) {
    const sources = unionSources(group.map((g) => g.sources));
    const backlog = group.find((g) => g.entryId !== null) ?? null;
    const kept =
      backlog ??
      [...group].sort((a, b) => SOURCE_ORDER.indexOf(a.sources[0]!) - SOURCE_ORDER.indexOf(b.sources[0]!))[0]!;
    out.push({
      key,
      item: kept.item,
      entryId: backlog ? backlog.entryId : kept.entryId,
      sources,
      creatorKey: toCandidate(kept).creatorKey,
    });
  }
  return out;
}

/**
 * Merge 2: one candidate per (category, normalised title). The copy whose sources do
 * not include "canon" wins — a profiled catalogue row beats the unprofiled canon card
 * (§5); if both or neither are canon, the lower key wins. A backlog entry always wins
 * its merge: dropping a list entry would break listOnly and the backlog route
 * (§5, DECISIONS below), and the loser's list membership rides into the winner as an
 * inherited entryId and source, so the list is never silently shortened.
 */
function mergeByTitle(cands: StageCandidate[]): StageCandidate[] {
  const byTitle = new Map<string, StageCandidate[]>();
  for (const c of cands) {
    const t = `${c.item.category}:${norm(c.item.title)}`;
    const group = byTitle.get(t);
    if (group) group.push(c);
    else byTitle.set(t, [c]);
  }

  const out: StageCandidate[] = [];
  for (const group of byTitle.values()) {
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    // The winner keeps its item and key; the whole group's sources union onto it.
    // A backlog copy always wins outright; otherwise the copy whose sources exclude
    // canon wins (the profiled catalogue row over the unprofiled canon card), ties
    // and all-canon groups by the lower key.
    const backlog = group.find((c) => c.entryId !== null) ?? null;
    const live = group.filter((c) => !c.sources.includes("canon"));
    const pool = live.length > 0 ? live : group;
    const winner = backlog ?? [...pool].sort((a, b) => a.key.localeCompare(b.key))[0]!;
    out.push({ ...winner, sources: unionSources(group.map((c) => c.sources)) });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Both merges in order, output sorted by key (§5). */
function dedupe(raw: RawEntry[]): StageCandidate[] {
  return mergeByTitle(mergeByKey(raw));
}
