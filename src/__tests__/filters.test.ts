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
import type { MediaItem, EntryWithContext } from "@/lib/types";

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

describe("the nine steps in order (§6, §C24)", () => {
  it("A: each step removes exactly its target; a music+hidden candidate counts under category; known is always 0", () => {
    const musicLogged = candidate(makeItem("song-wide-open-spaces"), { entryId: "e-song" });
    const mismatched = candidate(makeItem("book-1984"));
    const musicHidden = candidate(makeItem("song-heroes")); // music AND hidden → counted at step 1
    const result = run([musicLogged, mismatched, musicHidden], {}, {
      prefs: { pinned: [], muted: [], hidden: ["canon:book-1984", "canon:song-heroes"] },
    });
    expect(result.removed).toEqual({ category: 2, listOnly: 0, logged: 1, hidden: 0, muted: 0, known: 0, time: 0, unprofiled: 0, recent: 0 });
    expect(result.kept).toHaveLength(0);
    expect(result.deferred).toHaveLength(0);
    expect(result.recencyRelaxed).toBe(false);
  });

  it("A: listOnly removes candidates without an entry and keeps a backlog one", () => {
    const backlog = candidate(makeItem("book-piranesi"), { entryId: "e-want" });
    const notListed = candidate(makeItem("book-1984"));
    const r = run([backlog, notListed], { listOnly: true });
    expect(r.removed.listOnly).toBe(1);
    expect(r.kept.map((c) => c.key)).toEqual(["canon:book-piranesi"]);
  });

  it("A: the logged step removes a candidate whose key matches a library source:external_id and one whose item.id is in the library", () => {
    // book-1984 is not a seed: its key differs from every library item, so it is kept.
    const fresh = candidate(makeItem("book-1984"), { key: "canon:book-1984-unique" });
    const seededKey = candidate(makeItem("book-1984"), { key: "canon:movie-aftersun" }); // matches a seed slug
    const seededId = candidate(makeItem("movie-past-lives")); // item id `item-movie-past-lives` is a library item
    const r = run([fresh, seededKey, seededId]);
    expect(r.removed.logged).toBe(2);
    expect(r.kept.map((c) => c.key)).toEqual(["canon:book-1984-unique"]);
  });

  it("A: muted is its own step, distinct from hidden", () => {
    const drama = candidate(makeItem("movie-aftersun")); // genres: ["drama"]
    const r = run([drama], {}, { prefs: { pinned: [], muted: ["drama"], hidden: [] } });
    expect(r.removed.muted).toBe(1);
    expect(r.removed.hidden).toBe(0);
    expect(r.kept).toHaveLength(0);
  });
});

describe("step 7: time, shortRead, returnable (§6)", () => {
  it("D: shortRead removes films and over-480-minute books; an unknown-length book passes", () => {
    const film = candidate(makeItem("movie-aftersun")); // 102 min
    const longBook = candidate(makeItem("book-a-little-life")); // 720 pages × 1.6 = 1152 min
    const unknown = candidate(makeItem("book-the-road", { metadata: {} })); // no pages → unknown length passes
    const r = run([film, longBook, unknown], { shortRead: true });
    expect(r.removed.time).toBe(2);
    expect(r.kept.map((c) => c.key)).toEqual(["canon:book-the-road"]);
  });

  it("D: returnable removes a profiled item without the comfort keys and defers an unprofiled one at step 8, not time", () => {
    const warm = candidate(makeItem("movie-amelie")); // aftertaste.comforting 0.7, tone.warm 0.8
    const notWarm = candidate(makeItem("book-1984"));
    const unprofiled = candidate(makeItem("book-the-road", { profile: null }));
    const r = run([warm, notWarm, unprofiled], { returnable: true });
    expect(r.removed.time).toBe(1); // book-1984 fails the returnable rule
    expect(r.kept.map((c) => c.key)).toEqual(["canon:movie-amelie"]);
    expect(r.deferred.map((c) => c.key)).toEqual(["canon:book-the-road"]);
    expect(r.removed.unprofiled).toBe(1);
  });

  it("C: a music backlog entry is removed at step 1 and never reaches scoring", () => {
    const r = run([candidate(makeItem("song-heroes"), { entryId: "e-heroes" })]);
    expect(r.removed.category).toBe(1);
    expect(r.kept).toHaveLength(0);
  });
});

describe("step 8: unprofiled → deferred (§6)", () => {
  it("B/M: unprofiled candidates are deferred, never scored and never silently dropped", () => {
    const unprofiled = candidate(makeItem("book-the-road", { profile: null }));
    const profiled = candidate(makeItem("book-1984"));
    const r = run([unprofiled, profiled]);
    expect(r.kept).toEqual([profiled]);
    expect(r.deferred).toEqual([unprofiled]);
    expect(r.removed.unprofiled).toBe(1);
  });
});

describe("step 9: recency (§6, §C25)", () => {
  it("B: every candidate recently shown → limit results, oldest impressions re-admitted first, recencyRelaxed = true", () => {
    const cands = [
      candidate(makeItem("movie-aftersun")),
      candidate(makeItem("book-1984")),
      candidate(makeItem("book-never-let-me-go")),
      candidate(makeItem("movie-past-lives")),
      candidate(makeItem("tv-fleabag")),
    ];
    // tv-fleabag has the oldest impression, so re-admission must start there.
    const recent: RecentImpression[] = cands.map((c, i) => ({ key: c.key, shownAt: new Date(NOW_MS - (i + 1) * DAY).toISOString() }));
    const r = run(cands, { limit: 3 }, { recent });
    expect(r.recencyRelaxed).toBe(true);
    expect(r.kept.map((c) => c.key)).toEqual([
      "canon:tv-fleabag",
      "canon:movie-past-lives",
      "canon:book-never-let-me-go",
    ]);
    expect(r.removed.recent).toBe(2);
  });

  it("B: an impression inside the 14-day window is set aside; outside it the candidate is untouched", () => {
    const inside = candidate(makeItem("movie-aftersun"));
    const outside = candidate(makeItem("book-1984"));
    const r = run([inside, outside], { limit: 1 }, {
      recent: [
        { key: "canon:movie-aftersun", shownAt: new Date(NOW_MS - 13 * DAY).toISOString() },
        { key: "canon:book-1984", shownAt: new Date(NOW_MS - 15 * DAY).toISOString() },
      ],
    });
    expect(r.removed.recent).toBe(1);
    expect(r.kept.map((c) => c.key)).toEqual(["canon:book-1984"]);
    expect(r.recencyRelaxed).toBe(false); // limit satisfied without relaxation
  });
});
