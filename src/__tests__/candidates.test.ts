// Candidate generation tests (handoff §3 A–I; SPEC-STAGE3 §5). Offline and
// deterministic: fixed NOW, a loved-library built deterministically from canon feel
// priors, no database and no network. Adapter call behaviour lives in the
// stage-recommend tests, which own the fetch step.
import { describe, expect, it } from "vitest";

import { CANON, CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { creatorQueries, generateCandidates } from "@/lib/taste/candidates";
import { buildUserProfile, usableProfile, type UserProfile } from "@/lib/taste/profile";
import { scoreCandidate } from "@/lib/taste/score";
import type { Source } from "@/lib/taste/score";
import { simFamily } from "@/lib/taste/vector";
import type { PipelineFilters } from "@/lib/taste/filters";
import { CREATOR_EXPAND_MIN_WEIGHT, CREATOR_TOP, NEIGHBOUR_TOP, PHASE_TOP } from "@/lib/taste/weights";
import { EMPTY_TASTE_PREFS } from "@/lib/taste/tags";
import type { Category, MediaItem, Phase } from "@/lib/types";

const NOW = new Date("2026-09-25T12:00:00Z");

const base: PipelineFilters = { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 5 };

function canonItem(slug: string, over: Partial<MediaItem> = {}): MediaItem {
  const c = CANON_BY_SLUG.get(slug);
  if (!c) throw new Error(`no canon item ${slug}`);
  const r = canonToResult(c);
  return { ...r, id: `canon:${slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(slug), ...over };
}

/** The canon deck as the server would hand it over: every profiled non-music item. */
function canonPool(): MediaItem[] {
  return CANON.filter((c) => c.category !== "music" && canonProfile(c.slug) !== null).map((c) => canonItem(c.slug));
}

/** The pool as buildStageRecommendations prepares it: library items excluded before the cut (§2.2). */
function poolFor(library: ReturnType<typeof lovedLibrary>): MediaItem[] {
  const inLibrary = new Set(library.map((e) => (e.item.id.includes(":") ? e.item.id : `${e.item.source}:${e.item.external_id}`)));
  return canonPool().filter((i) => !inLibrary.has(i.id.includes(":") ? i.id : `${i.source}:${i.external_id}`));
}

/**
 * A deterministic library: canon items with loved taps and no notes, exactly as the
 * onboarding deck writes them. Vectors come from the committed feel priors, so the
 * story/feeling centroids — and every ranking below — are fixed. Loved slugs come
 * first (status completed, dims {loved:true}); want slugs follow (status want).
 * A want item may be given a uuid-shaped id via wantItems, standing in for a real row.
 */
function lovedLibrary(lovedSlugs: string[], wants: Array<{ slug: string; id?: string }> = []) {
  const bySlug = new Map<string, MediaItem>();
  const item = (slug: string, id?: string) => {
    const hit = bySlug.get(id ?? slug);
    if (hit) return hit;
    const made = canonItem(slug, id ? { id } : {});
    bySlug.set(id ?? slug, made);
    return made;
  };
  const rows = [
    ...lovedSlugs.map((slug) => ({ slug, loved: true as const })),
    ...wants.map((w) => ({ slug: w.slug, loved: false as const, id: w.id })),
  ];
  return rows.map((row, i) => {
    const it = item(row.slug, "id" in row ? row.id : undefined);
    const created = new Date(NOW.getTime() - (i + 1) * 86_400_000).toISOString();
    return {
      entry: {
        id: `entry-${row.slug}`, user_id: "u", media_item_id: it.id, status: row.loved ? ("completed" as const) : ("want" as const),
        private_score: null, consumed_at: created.slice(0, 10), consumed_until: null, consumed_precision: "day" as const,
        origin: "canon" as const, created_at: created, updated_at: created,
      },
      item: it,
      reactions: row.loved ? [{ id: `reaction-${row.slug}`, entry_id: `entry-${row.slug}`, user_id: "u", dimensions: { loved: true }, raw_note: null, source: "onboarding" as const, created_at: created }] : [],
      extractions: [],
      resurfaces: [],
    };
  });
}

const LOVED = ["movie-in-the-mood-for-love", "movie-aftersun", "movie-past-lives", "book-never-let-me-go", "movie-moonlight", "book-the-remains-of-the-day", "anime-frieren"];
const WANTS = [{ slug: "book-piranesi" }, { slug: "anime-mushishi" }];

function profile(): UserProfile {
  return buildUserProfile(lovedLibrary(LOVED, WANTS), [], EMPTY_TASTE_PREFS, NOW);
}

function runGeneration(args: {
  P?: UserProfile;
  filters?: Partial<PipelineFilters>;
  pool?: MediaItem[];
  canonList?: MediaItem[];
  creatorResults?: Map<string, MediaItem[]>;
  library?: ReturnType<typeof lovedLibrary>;
}) {
  const P = args.P ?? profile();
  const filters = { ...base, ...args.filters };
  const out = generateCandidates({
    library: args.library ?? lovedLibrary(LOVED, WANTS),
    P,
    filters,
    canon: args.canonList ?? canonPool(),
    creatorResults: args.creatorResults ?? new Map(),
    pool: args.pool ?? canonPool(),
  });
  return { P, filters, out };
}

const sumSources = (counts: Record<Source, number>): number => Object.values(counts).reduce((a, b) => a + b, 0);

const phase = (over: Partial<Phase>): Phase => ({
  id: "phase-1", user_id: "u", kind: "feeling_cluster", fingerprint: "fp", label: "Quiet aching", user_label: null,
  start_at: "2026-08-01", end_at: "2026-10-01", category: null, confidence: 0.9,
  evidence: { dominant: "aftertaste.lingering" }, dismissed: false, detected_at: "2026-08-01T00:00:00Z", ...over,
});

describe("sources (§5)", () => {
  it("A: the same item from canon and story_neighbour is one candidate with unioned sources and an identical score", () => {
    // The feeling profile is null, so the feeling_neighbour source cannot also pick the
    // item — exactly the §C22 scenario, with sources deterministically [canon, story_neighbour].
    const P: UserProfile = { ...profile(), feeling: null };
    const library = lovedLibrary(LOVED, WANTS);
    const pool = poolFor(library);
    const { out } = runGeneration({ P, pool, library });
    // The story top-30 covers the pool's head, so a story-adjacent canon item is dual-sourced.
    const slug = "movie-lost-in-translation";
    const dual = out.candidates.find((x) => x.key === `canon:${slug}`);
    expect(dual).toBeDefined();
    expect(dual!.sources).toEqual(["canon", "story_neighbour"]);

    // The same item from canon alone: no neighbour copy in the pool, sources stay single,
    // and the score is identical — provenance never moves a number (§C22).
    const single = generateCandidates({
      library: lovedLibrary(LOVED, WANTS), P, filters: base,
      canon: [canonItem(slug)], creatorResults: new Map(),
      pool: poolFor(library).filter((i) => i.external_id !== slug),
    });
    const alone = single.candidates.find((x) => x.key === `canon:${slug}`);
    expect(alone).toBeDefined();
    expect(alone!.sources).toEqual(["canon"]);
    expect(scoreCandidate(P, dual!)!.score).toBe(scoreCandidate(P, alone!)!.score);
  });

  it("B: a canon item and an adapter row with the same normalised title merge into one candidate with the non-canon key", () => {
    // Both family profiles null: no neighbour source can attach, so the union is exactly canon + creator.
    const P: UserProfile = { ...profile(), story: null, feeling: null };
    const tmdb = canonItem("movie-before-sunrise", { id: "tmdb:ext-bs", source: "tmdb", external_id: "ext-bs" });
    const { out } = runGeneration({
      P,
      creatorResults: new Map([["movie:richard linklater", [tmdb]]]),
      pool: [tmdb, canonItem("book-dune")],
    });
    const merged = out.candidates.filter((c) => c.item.title === "Before Sunrise");
    expect(merged).toHaveLength(1);
    expect(merged[0]!.key).toBe("tmdb:ext-bs"); // the live catalogue row's key wins over the canon card (§C23)
    expect(merged[0]!.sources).toEqual(["canon", "creator"]);
    expect(out.merged).toBe(out.candidates.length);
  });

  it("C: a backlog entry is never lost — the canon deck skips it by key, a colliding pool title loses to it, and entryId survives both merges", () => {
    // A real backlog row: uuid-shaped id, key still canon:book-piranesi. The canon deck
    // also carries the slug; the canon source skips it (already in the library), so the
    // single piranesi candidate is the user's own entry, entryId intact.
    const library = lovedLibrary(LOVED, [{ slug: "anime-mushishi" }, { slug: "book-piranesi", id: "row-uuid-1" }]);
    const P: UserProfile = { ...profile(), feeling: null };
    const { out } = runGeneration({ P, library, pool: poolFor(library) });
    const piranesi = out.candidates.filter((c) => c.item.title.toLowerCase().includes("piranesi"));
    expect(piranesi).toHaveLength(1);
    expect(piranesi[0]!.entryId).toBe("entry-book-piranesi");
    expect(piranesi[0]!.item.id).toBe("row-uuid-1"); // the backlog copy's item
    expect(piranesi[0]!.key).toBe("canon:book-piranesi");
    expect(piranesi[0]!.sources).toEqual(["backlog"]);

    // A profiled pool row with the same title (a differently-keyed edition) reaches the
    // title merge through the neighbour source, which does not skip by title. A one-item
    // pool pins the ranking question, so the source membership is not under test here.
    // The backlog copy wins outright: its item and key are kept, its entryId survives (§5).
    const edition = canonItem("book-piranesi", { id: "tmdb:77", source: "tmdb", external_id: "77" });
    const { out: merged } = runGeneration({ P, library, pool: [edition] });
    const again = merged.candidates.filter((c) => c.item.title.toLowerCase().includes("piranesi"));
    expect(again).toHaveLength(1);
    expect(again[0]!.item.id).toBe("row-uuid-1");
    expect(again[0]!.key).toBe("canon:book-piranesi"); // the backlog copy's key, not the edition's
    expect(again[0]!.entryId).toBe("entry-book-piranesi");
    expect(again[0]!.sources).toEqual(["backlog", "story_neighbour"]);
    expect(merged.sourceCounts.backlog).toBe(2); // both wants, both kept

    // Merge 1: the exact same item arriving as backlog and as neighbour keeps its entryId.
    const want = library.filter((e) => e.entry.status === "want").find((e) => e.item.id === "row-uuid-1")!;
    const both = generateCandidates({
      library, P, filters: base,
      canon: [], creatorResults: new Map(),
      pool: [want.item],
    });
    const c = both.candidates.find((x) => x.key === "canon:book-piranesi");
    expect(c).toBeDefined();
    expect(c!.sources).toEqual(["backlog", "story_neighbour"]);
    expect(c!.entryId).toBe("entry-book-piranesi");
  });

  it("D: music never appears — no music creator queries and no music candidates from any source", () => {
    // A loved song puts its artist in the profile at exactly the expansion threshold.
    const withSong = lovedLibrary([...LOVED, "song-blue-in-green"], WANTS);
    const P = buildUserProfile(withSong, [], EMPTY_TASTE_PREFS, NOW);
    expect(P.creators.has("music:miles davis")).toBe(true);
    expect(P.creators.get("music:miles davis")!.weight).toBeGreaterThanOrEqual(CREATOR_EXPAND_MIN_WEIGHT);
    expect(creatorQueries(P, base).map((q) => q.category)).not.toContain("music");

    // And generation drops music from every source, whatever the inputs hold.
    const song = canonItem("song-holocene");
    const { out } = runGeneration({
      P,
      library: withSong,
      creatorResults: new Map([["music:miles davis", [song]]]),
      pool: [...canonPool(), song],
      canonList: [...canonPool(), song],
    });
    expect(out.candidates.filter((c) => c.item.category === "music")).toHaveLength(0);
    expect(out.sourceCounts.creator).toBe(0);
  });

  it("E: listOnly and surprise run backlog only — no canon, creator, neighbour or phase candidates", () => {
    for (const flag of ["listOnly", "surprise"] as const) {
      const withPhase = buildUserProfile(lovedLibrary(LOVED, WANTS), [phase({})], EMPTY_TASTE_PREFS, NOW);
      const { out } = runGeneration({
        P: withPhase,
        filters: { [flag]: true },
        creatorResults: new Map([["movie:someone", [canonItem("movie-her")]]]),
      });
      expect(out.candidates.length).toBe(2); // the two wants, nothing else
      expect(out.candidates.every((c) => c.sources.length === 1 && c.sources[0] === "backlog")).toBe(true);
      expect(out.candidates.every((c) => c.entryId !== null)).toBe(true);
      expect(sumSources(out.sourceCounts)).toBe(2);
      expect(creatorQueries(withPhase, { ...base, [flag]: true })).toEqual([]);
    }
  });

  it("F: neighbours are at most 30 each, in similarity order with ties by key, and skipped when the family profile is null", () => {
    const P = profile();
    const library = lovedLibrary(LOVED, WANTS);
    const pool = poolFor(library);
    const { out } = runGeneration({ P, pool, library });
    for (const [source, family] of [["story_neighbour", "story"], ["feeling_neighbour", "feeling"]] as const) {
      const fp = P[family];
      expect(fp).not.toBeNull();
      const sim = (i: MediaItem) => simFamily(family, usableProfile(i)!.vector[family], fp!.centroid);
      const ranked = [...pool]
        .sort((a, b) => sim(b) - sim(a) || `canon:${a.external_id}`.localeCompare(`canon:${b.external_id}`))
        .slice(0, NEIGHBOUR_TOP)
        .map((i) => `canon:${i.external_id}`);
      const picked = out.candidates.filter((c) => c.sources.includes(source));
      expect(picked.length).toBeGreaterThan(0);
      expect(picked.length).toBeLessThanOrEqual(NEIGHBOUR_TOP);
      // The output list is key-sorted, so compare the picked SET against the expected
      // top-30 cut; the cut itself is what pins the similarity order and the key tie-break.
      expect([...picked].map((c) => c.key).sort()).toEqual([...ranked].sort());
    }

    // A null family profile skips its source entirely; the other still runs.
    const noFeeling: UserProfile = { ...P, feeling: null };
    const { out: outNoFeeling } = runGeneration({ P: noFeeling, pool });
    expect(outNoFeeling.candidates.some((c) => c.sources.includes("feeling_neighbour"))).toBe(false);
    expect(outNoFeeling.candidates.some((c) => c.sources.includes("story_neighbour"))).toBe(true);

    const noStory: UserProfile = { ...P, story: null };
    const { out: outNoStory } = runGeneration({ P: noStory, pool });
    expect(outNoStory.candidates.some((c) => c.sources.includes("story_neighbour"))).toBe(false);
    expect(outNoStory.candidates.some((c) => c.sources.includes("feeling_neighbour"))).toBe(true);
  });

  it("G: a feeling_cluster phase admits only gate-passing items, at most 20; category_stretch adds nothing; no phase → 0", () => {
    const P = profile();
    const library = lovedLibrary(LOVED, WANTS);
    const pool = poolFor(library);
    const gate = (i: MediaItem) => (usableProfile(i)!.vector.feeling["aftertaste.lingering"] ?? 0) >= 0.5;
    const passing = pool.filter(gate);
    expect(passing.length).toBeGreaterThan(0);
    expect(passing.length).toBeLessThan(pool.length); // the gate is real, not a tautology

    const cluster = runGeneration({ P: buildUserProfile(library, [phase({})], EMPTY_TASTE_PREFS, NOW), pool, library });
    const picked = cluster.out.candidates.filter((c) => c.sources.includes("phase"));
    expect(picked.length).toBe(Math.min(passing.length, PHASE_TOP));
    expect(picked.every((c) => gate(c.item))).toBe(true);
    expect(cluster.out.sourceCounts.phase).toBe(picked.length);

    const stretch = runGeneration({
      P: buildUserProfile(lovedLibrary(LOVED, WANTS), [phase({ kind: "category_stretch", evidence: { category: "book" } })], EMPTY_TASTE_PREFS, NOW),
      pool,
    });
    expect(stretch.out.candidates.some((c) => c.sources.includes("phase"))).toBe(false);
    expect(stretch.out.sourceCounts.phase).toBe(0);

    const none = runGeneration({ P, pool });
    expect(none.out.candidates.some((c) => c.sources.includes("phase"))).toBe(false);
  });

  it("H: creator queries take the top 3 by weight then key at ≥ 0.4, and the source takes the first 5 results minus library matches", () => {
    const library = lovedLibrary(LOVED, WANTS);
    const P = buildUserProfile(library, [], EMPTY_TASTE_PREFS, NOW);
    const strong = [...P.creators.values()].filter((c) => c.weight >= CREATOR_EXPAND_MIN_WEIGHT && c.category !== "music");
    expect(strong.length).toBeGreaterThanOrEqual(CREATOR_TOP);
    const expected = [...strong].sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key)).slice(0, CREATOR_TOP);
    expect(creatorQueries(P, base).map((q) => [q.creatorKey, q.name, q.category])).toEqual(
      expected.map((c) => [c.key, c.name, c.category]),
    );

    // Below the weight floor: no queries at all.
    const low: UserProfile = { ...P, creators: new Map([...P.creators].map(([k, c]) => [k, { ...c, weight: 0.39 }])) };
    expect(creatorQueries(low, base)).toEqual([]);

    // A set category narrows queries to that category.
    expect(creatorQueries(P, { ...base, category: "movie" as Category }).every((q) => q.category === "movie")).toBe(true);

    // Results: the first 5 of the list are considered; a library match is skipped by key
    // (a tmdb copy of a loved film) and by title (a differently-keyed loved title).
    const creator = expected[0]!;
    const keyCopy = canonItem("movie-moonlight", { id: "tmdb:ml", source: "tmdb", external_id: "ml" }); // key unknown, title loved
    const titleCopy = canonItem("movie-past-lives", { id: "tmdb:pl", source: "tmdb", external_id: "pl" }); // title loved
    const clean = [
      canonItem("movie-la-la-land", { id: "tmdb:1", source: "tmdb", external_id: "1" }),
      canonItem("movie-her", { id: "tmdb:2", source: "tmdb", external_id: "2" }),
      canonItem("movie-inception", { id: "tmdb:3", source: "tmdb", external_id: "3" }),
    ];
    const { out } = runGeneration({
      P,
      library,
      pool: poolFor(library),
      creatorResults: new Map([[creator.key, [keyCopy, titleCopy, ...clean]]]),
    });
    expect(out.sourceCounts.creator).toBe(3); // five considered, two skipped
    expect(out.candidates.filter((c) => c.sources.includes("creator")).map((c) => c.key).sort())
      .toEqual(["tmdb:1", "tmdb:2", "tmdb:3"]);
    expect(out.candidates.find((c) => c.key === "tmdb:ml")).toBeUndefined();
    expect(out.candidates.find((c) => c.key === "tmdb:pl")).toBeUndefined();
    // The loved originals are still absent (logged filter) and present only as library entries.
    expect(out.candidates.find((c) => c.item.title === "Moonlight")).toBeUndefined();
  });

  it("I: permuting the canon, pool and adapter result orders gives identical candidates", () => {
    const P = profile();
    const pool = canonPool();
    const results = [
      canonItem("movie-la-la-land", { id: "tmdb:1", source: "tmdb", external_id: "1" }),
      canonItem("movie-her", { id: "tmdb:2", source: "tmdb", external_id: "2" }),
      canonItem("movie-inception", { id: "tmdb:3", source: "tmdb", external_id: "3" }),
    ];
    const mk = (canonList: MediaItem[], p: MediaItem[], r: MediaItem[]) =>
      generateCandidates({
        library: lovedLibrary(LOVED, WANTS), P, filters: base, canon: canonList,
        creatorResults: new Map([["movie:whomever", r]]), pool: p,
      }).candidates;
    const a = mk(pool, pool, results);
    const b = mk([...pool].reverse(), [...pool].sort((x, y) => x.title.localeCompare(y.title)), [...results].reverse());
    expect(b).toEqual(a);
  });
});

describe("merges and counts (§5)", () => {
  it("sourceCounts counts before merging, merged counts after, and the output is sorted by key", () => {
    const P = profile();
    const { out } = runGeneration({ P, pool: canonPool() });
    const before = sumSources(out.sourceCounts);
    expect(out.merged).toBe(out.candidates.length);
    expect(out.merged).toBeLessThan(before); // canon items re-sourced by neighbours merge down
    expect(out.sourceCounts.backlog).toBe(2);
    expect([...out.candidates].sort((a, b) => a.key.localeCompare(b.key)).map((c) => c.key)).toEqual(out.candidates.map((c) => c.key));
    // Every candidate carries at least one source, in SOURCE_ORDER with no duplicates.
    for (const c of out.candidates) {
      expect(c.sources.length).toBeGreaterThan(0);
      expect(new Set(c.sources).size).toBe(c.sources.length);
    }
  });
});
