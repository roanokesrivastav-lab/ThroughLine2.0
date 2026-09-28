// Tests for the fixed nine-step hard filter (SPEC-STAGE3 §6; matrix §C 24–26).
// Offline and deterministic: fixture library at a fixed NOW, candidates built in-test
// from canon items. Each step removes exactly its target; the counts are exact.
import { describe, expect, it } from "vitest";

import { CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { EMPTY_TASTE_PREFS, type TastePrefs } from "@/lib/taste/tags";
import { filterCandidates, type PipelineFilters, type RecentImpression } from "@/lib/taste/filters";
import type { StageCandidate } from "@/lib/taste/score";
import type { MediaItem } from "@/lib/types";

const NOW = new Date("2026-09-25T12:00:00Z");
const NOW_MS = NOW.getTime();
const DAY = 86_400_000;

function makeItem(slug: string, over: Partial<MediaItem> = {}): MediaItem {
  const c = CANON_BY_SLUG.get(slug);
  if (!c) throw new Error(`no canon item ${slug}`);
  const r = canonToResult(c);
  return { ...r, id: `item-${slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(slug), ...over };
}

function candidate(item: MediaItem, opts: { entryId?: string | null; key?: string; creatorKey?: string | null } = {}): StageCandidate {
  const creator = item.creators[0];
  return {
    key: opts.key ?? `${item.source}:${item.external_id}`,
    item,
    entryId: opts.entryId ?? null,
    sources: ["canon"],
    creatorKey: opts.creatorKey === undefined ? (creator ? `${item.category}:${creator.name.toLowerCase()}` : null) : opts.creatorKey,
  };
}

const base: PipelineFilters = { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 5 };

function run(
  candidates: StageCandidate[],
  over: Partial<PipelineFilters> = {},
  opts: { prefs?: TastePrefs; recent?: RecentImpression[]; now?: Date } = {},
) {
  return filterCandidates({
    candidates,
    library: buildFixtureLibrary(NOW_MS, { profiles: "canon" }),
    prefs: opts.prefs ?? EMPTY_TASTE_PREFS,
    filters: { ...base, ...over },
    recent: opts.recent ?? [],
    now: opts.now ?? NOW,
  });
}

// The handoff's full-RemovedCounts shape, for exact-equality assertions (§2.1).
const zero = { category: 0, listOnly: 0, logged: 0, hidden: 0, muted: 0, known: 0, time: 0, unprofiled: 0, recent: 0 };
const removed = (over: Partial<typeof zero>) => ({ ...zero, ...over });

describe("the nine steps in order (§6, §C24)", () => {
  it("A: each step removes exactly its target; a music+hidden candidate counts under category; known is always 0", () => {
    const musicLogged = candidate(makeItem("song-hallelujah-buckley"), { entryId: "e-song" }); // music → step 1
    const mismatched = candidate(makeItem("movie-the-godfather")); // a book was asked for → step 1
    const musicHidden = candidate(makeItem("song-strange-fruit")); // music AND hidden → step 1, not step 4
    const result = run([musicLogged, mismatched, musicHidden], { category: "book" }, {
      prefs: { pinned: [], muted: [], hidden: ["canon:song-strange-fruit"] },
    });
    expect(result.removed).toEqual(removed({ category: 3 }));
    expect(result.kept).toHaveLength(0);
    expect(result.deferred).toHaveLength(0);
    expect(result.recencyRelaxed).toBe(false);
  });

  it("A: listOnly removes candidates without an entry and keeps a backlog one", () => {
    const backlog = candidate(makeItem("book-piranesi"), { entryId: "e-want" });
    const notListed = candidate(makeItem("book-1984"));
    const r = run([backlog, notListed], { listOnly: true });
    expect(r.removed).toEqual(removed({ listOnly: 1 }));
    expect(r.kept.map((c) => c.key)).toEqual(["canon:book-piranesi"]);
  });

  it("A: the logged step removes a candidate whose key matches a library source:external_id and one whose item.id is in the library", () => {
    // book-1984 is not a seed: its key differs from every library item, so it is kept.
    const fresh = candidate(makeItem("book-1984"), { key: "canon:book-1984-unique" });
    const seededKey = candidate(makeItem("book-1984"), { key: "canon:movie-aftersun" }); // a seed's source:external_id
    const seededId = candidate(makeItem("movie-past-lives")); // item id `item-movie-past-lives` belongs to a library entry
    const r = run([fresh, seededKey, seededId]);
    expect(r.removed).toEqual(removed({ logged: 2 }));
    expect(r.kept.map((c) => c.key)).toEqual(["canon:book-1984-unique"]);
  });

  it("A: hidden removes exactly the dismissed key", () => {
    const dismissed = candidate(makeItem("book-1984"));
    const kept1 = candidate(makeItem("movie-the-godfather")); // not a seed, so past the logged step
    const r = run([dismissed, kept1], {}, { prefs: { pinned: [], muted: [], hidden: ["canon:book-1984"] } });
    expect(r.removed).toEqual(removed({ hidden: 1 }));
    expect(r.kept.map((c) => c.key)).toEqual(["canon:movie-the-godfather"]);
  });

  it("A: muted is its own step, distinct from hidden, and matches tag families (romance mute catches amelie)", () => {
    // "drama" is stoplisted, so a genre that survives normalisation is used instead.
    const warm = candidate(makeItem("movie-amelie")); // genres: romance, comedy → "romance" survives
    const r = run([warm], {}, { prefs: { pinned: [], muted: ["romance"], hidden: [] } });
    expect(r.removed).toEqual(removed({ muted: 1 }));
    expect(r.kept).toHaveLength(0);
  });

  it("A: the known step is a named no-op — always 0, nothing removed", () => {
    const cands = [candidate(makeItem("movie-the-godfather")), candidate(makeItem("book-1984"))];
    const r = run(cands);
    expect(r.removed.known).toBe(0);
    expect(r.kept).toHaveLength(2);
  });

  it("A: the time step removes only what does not fit the budget", () => {
    const long = candidate(makeItem("movie-the-godfather")); // 175 min > 60; not a seed
    const short = candidate(makeItem("book-1984")); // books pass budgets ≥ 40 minutes
    const r = run([long, short], { minutes: 60 });
    expect(r.removed).toEqual(removed({ time: 1 }));
    expect(r.kept.map((c) => c.key)).toEqual(["canon:book-1984"]);
  });

  it("A: unprofiled candidates are deferred, never scored and never silently dropped", () => {
    const unprofiled = candidate(makeItem("book-the-road", { profile: null }));
    const profiled = candidate(makeItem("book-1984"));
    const r = run([unprofiled, profiled]);
    expect(r.removed).toEqual(removed({ unprofiled: 1 }));
    expect(r.kept).toEqual([profiled]);
    expect(r.deferred).toEqual([unprofiled]);
  });

  it("A: a recently shown candidate is set aside at step 9 and removed.recent counts it", () => {
    const shown = candidate(makeItem("movie-the-godfather"));
    const fresh = candidate(makeItem("book-1984"));
    const r = run([shown, fresh], { limit: 1 }, {
      recent: [{ key: "canon:movie-the-godfather", shownAt: new Date(NOW_MS - 2 * DAY).toISOString() }],
    });
    expect(r.removed).toEqual(removed({ recent: 1 }));
    expect(r.kept.map((c) => c.key)).toEqual(["canon:book-1984"]);
    expect(r.recencyRelaxed).toBe(false);
  });
});

describe("step 7: time, shortRead, returnable (§6)", () => {
  it("D: shortRead removes films and over-480-minute books; an unknown-length book passes", () => {
    const film = candidate(makeItem("movie-the-godfather")); // 120 min, and not a seed
    const longBook = candidate(makeItem("book-a-little-life")); // 720 pages × 1.6 = 1152 min
    const unknown = candidate(makeItem("book-the-road", { metadata: {} })); // no pages → unknown length passes
    const r = run([film, longBook, unknown], { shortRead: true });
    expect(r.removed).toEqual(removed({ time: 2 }));
    expect(r.kept.map((c) => c.key)).toEqual(["canon:book-the-road"]);
  });

  it("D: returnable removes a profiled item without the comfort keys and defers an unprofiled one at step 8, not time", () => {
    const warm = candidate(makeItem("movie-amelie")); // tone.warm 0.855, aftertaste.comforting 0.68
    const notWarm = candidate(makeItem("book-1984")); // profiled; neither key ≥ 0.4
    const unprofiled = candidate(makeItem("book-the-road", { profile: null }));
    const r = run([warm, notWarm, unprofiled], { returnable: true });
    expect(r.removed).toEqual(removed({ time: 1, unprofiled: 1 }));
    expect(r.kept.map((c) => c.key)).toEqual(["canon:movie-amelie"]);
    expect(r.deferred.map((c) => c.key)).toEqual(["canon:book-the-road"]);
  });
});

describe("step 9: recency (§6, §C25)", () => {
  it("B: every candidate recently shown → limit results, oldest impressions re-admitted first, recencyRelaxed = true", () => {
    const cands = [
      candidate(makeItem("book-1984")),
      candidate(makeItem("book-beloved")),
      candidate(makeItem("movie-hereditary")),
      candidate(makeItem("movie-the-godfather")),
      candidate(makeItem("movie-amelie")),
    ];
    // movie-amelie has the oldest impression, so re-admission must start there.
    const recent: RecentImpression[] = cands.map((c, i) => ({ key: c.key, shownAt: new Date(NOW_MS - (i + 1) * DAY).toISOString() }));
    const r = run(cands, { limit: 3 }, { recent });
    expect(r.recencyRelaxed).toBe(true);
    expect(r.kept.map((c) => c.key)).toEqual([
      "canon:movie-amelie",
      "canon:movie-the-godfather",
      "canon:movie-hereditary",
    ]);
    expect(r.removed.recent).toBe(2);
    expect(r.deferred).toHaveLength(0);
  });

  it("B: an impression inside the 14-day window is set aside; outside it the candidate is untouched", () => {
    const inside = candidate(makeItem("movie-the-godfather"));
    const outside = candidate(makeItem("book-1984"));
    const r = run([inside, outside], { limit: 1 }, {
      recent: [
        { key: "canon:movie-the-godfather", shownAt: new Date(NOW_MS - 13 * DAY).toISOString() },
        { key: "canon:book-1984", shownAt: new Date(NOW_MS - 15 * DAY).toISOString() },
      ],
    });
    expect(r.removed.recent).toBe(1);
    expect(r.kept.map((c) => c.key)).toEqual(["canon:book-1984"]);
    expect(r.recencyRelaxed).toBe(false); // limit satisfied without relaxation
  });

  it("B: the 14-day boundary is inclusive — exactly 14 days old is recent, 15 is not", () => {
    const edge = candidate(makeItem("movie-the-godfather"));
    // Exactly 14 days: set aside, then re-admitted because the limit needs it.
    const at = run([edge], { limit: 1 }, {
      recent: [{ key: "canon:movie-the-godfather", shownAt: new Date(NOW_MS - 14 * DAY).toISOString() }],
    });
    expect(at.recencyRelaxed).toBe(true); // proves the key was set aside…
    expect(at.kept.map((c) => c.key)).toEqual(["canon:movie-the-godfather"]); // …and re-admitted at limit 1
    expect(at.removed.recent).toBe(0); // nothing stayed out
    // One day past the window: the candidate is untouched, so nothing relaxes.
    const past = run([edge], { limit: 1 }, {
      recent: [{ key: "canon:movie-the-godfather", shownAt: new Date(NOW_MS - 15 * DAY).toISOString() }],
    });
    expect(past.recencyRelaxed).toBe(false);
    expect(past.removed.recent).toBe(0);
    expect(past.kept).toHaveLength(1);
  });

  it("B: duplicate impressions of one key keep the newest — a stale record cannot pass the window or reorder re-admission", () => {
    const shown = candidate(makeItem("movie-the-godfather"));
    const fresh = candidate(makeItem("book-1984"));
    // A title shown in several sessions arrives with out-of-order impressions: a
    // 2-day-old record first, a 15-day-old one last. Keeping the last duplicate
    // instead of the newest would leave the stale timestamp in the map.
    const godfatherImpressions: RecentImpression[] = [
      { key: "canon:movie-the-godfather", shownAt: new Date(NOW_MS - 2 * DAY).toISOString() },
      { key: "canon:movie-the-godfather", shownAt: new Date(NOW_MS - 15 * DAY).toISOString() },
    ];
    // The newest impression (2 days) is inside the window, so the title is set aside
    // and the untouched candidate fills the limit.
    const r = run([shown, fresh], { limit: 1 }, { recent: godfatherImpressions });
    expect(r.removed).toEqual(removed({ recent: 1 }));
    expect(r.kept.map((c) => c.key)).toEqual(["canon:book-1984"]);
    expect(r.recencyRelaxed).toBe(false);
    // The same newest-wins rule drives re-admission order: with both keys set aside,
    // the oldest *newest-impression* re-admits first, duplicates notwithstanding.
    const both = run([shown, fresh], { limit: 1 }, {
      recent: [...godfatherImpressions, { key: "canon:book-1984", shownAt: new Date(NOW_MS - 3 * DAY).toISOString() }],
    });
    expect(both.recencyRelaxed).toBe(true);
    expect(both.kept.map((c) => c.key)).toEqual(["canon:book-1984"]); // 3 days > 2 days
    expect(both.removed.recent).toBe(1);
  });
});
