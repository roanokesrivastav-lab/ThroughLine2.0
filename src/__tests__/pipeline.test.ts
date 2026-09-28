// Tests for the pure pipeline (SPEC-STAGE3 §6–§9; matrix §C 44, 48, §D.4): the fixture
// library at a fixed NOW, candidates built in-test from canon items. Covers cold start
// (M), pipeline integrity (N), determinism (K) and surprise mode (O).
import { describe, expect, it } from "vitest";

import { CANON, CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { buildUserProfile } from "@/lib/taste/profile";
import { EMPTY_TASTE_PREFS } from "@/lib/taste/tags";
import { rankPipeline } from "@/lib/taste/pipeline";
import { filterCandidates } from "@/lib/taste/filters";
import type { PipelineFilters } from "@/lib/taste/filters";
import type { StageCandidate, Source } from "@/lib/taste/score";
import { scoreCandidates } from "@/lib/taste/score";
import { snapshotTotal, type ImpressionSnapshot } from "@/lib/taste/snapshot";
import type { UserProfile } from "@/lib/taste/profile";
import type { MediaItem, ItemProfile } from "@/lib/types";

const NOW = new Date("2026-09-25T12:00:00Z");
const NOW_MS = NOW.getTime();

const SOURCE_COUNTS: Record<Source, number> = { backlog: 5, canon: 80, creator: 10, story_neighbour: 12, feeling_neighbour: 8, phase: 0 };

const base: PipelineFilters = { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 5 };

function makeItem(slug: string): MediaItem {
  const c = CANON_BY_SLUG.get(slug);
  if (!c) throw new Error(`no canon item ${slug}`);
  const r = canonToResult(c);
  return { ...r, id: `item-${slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(slug) };
}

function candidate(item: MediaItem): StageCandidate {
  const creator = item.creators[0];
  return {
    key: `${item.source}:${item.external_id}`,
    item,
    entryId: null,
    sources: ["canon"],
    creatorKey: creator ? `${item.category}:${creator.name.toLowerCase()}` : null,
  };
}

function run(
  candidates: StageCandidate[],
  P: UserProfile,
  over: Partial<PipelineFilters> = {},
  library = buildFixtureLibrary(NOW_MS, { profiles: "canon" }),
) {
  return rankPipeline({
    P,
    library,
    prefs: EMPTY_TASTE_PREFS,
    candidates,
    filters: { ...base, ...over },
    recent: [],
    userId: "test-user",
    now: NOW,
    sourceCounts: SOURCE_COUNTS,
    merged: 12,
  });
}

describe("determinism (§C33)", () => {
  it("K: two runs give identical output; permuting the candidate order gives identical output", () => {
    const library = buildFixtureLibrary(NOW_MS, { profiles: "canon" });
    const P = buildUserProfile(library, [], EMPTY_TASTE_PREFS, NOW);
    const candidates = ["book-1984", "book-beloved", "movie-hereditary", "movie-the-godfather", "book-dune", "movie-amelie", "book-never-let-me-go", "movie-past-lives", "tv-succession", "book-normal-people", "anime-frieren", "tv-fleabag", "book-klara-and-the-sun", "movie-lost-in-translation"].map((s) => candidate(makeItem(s)));

    const a = run(candidates, P, { limit: 5 }, library);
    const b = run(candidates, P, { limit: 5 }, library);
    expect(b.snapshots.map((s) => [s.key, s.score, s.position, s.rerank])).toEqual(a.snapshots.map((s) => [s.key, s.score, s.position, s.rerank]));
    expect(b.context).toEqual(a.context);

    const permuted = run([...candidates].reverse(), P, { limit: 5 }, library);
    expect(permuted.snapshots.map((s) => s.key)).toEqual(a.snapshots.map((s) => s.key));
    expect(permuted.snapshots.map((s) => s.score)).toEqual(a.snapshots.map((s) => s.score));
  });
});

describe("cold start (§C44, §D.4)", () => {
  // Ten canon "loved" taps, no notes: the onboarding case (scoring.test.ts precedent).
  const library = buildFixtureLibrary(NOW_MS, { profiles: "canon" })
    .slice(0, 10)
    .map((e) => ({
      ...e,
      entry: { ...e.entry, private_score: null, origin: "canon" as const },
      reactions: e.reactions.map((r) => ({ ...r, raw_note: null, dimensions: { loved: true } })),
      extractions: [],
    }));
  const P = buildUserProfile(library, [], EMPTY_TASTE_PREFS, NOW);

  // Candidates = every other non-music canon item, with its committed profile.
  const seeded = new Set(library.map((e) => e.item.external_id));
  const candidates = CANON.filter((c) => c.category !== "music" && !seeded.has(c.slug)).map((c) => candidate(makeItem(c.slug)));

  const result = run(candidates, P, { limit: 5 }, library);
  // The filter run alone, for an honest pools comparison.
  const filterReport = filterCandidates({
    candidates, library, prefs: EMPTY_TASTE_PREFS, filters: { ...base, limit: 5 }, recent: [], now: NOW,
  });

  it("M: five results, each with story evidence, no own words, and a non-empty explanation", () => {
    expect(result.snapshots).toHaveLength(5);
    for (const s of result.snapshots) {
      expect(s.has_evidence.story).toBe(true);
      expect(s.indicators.own_words).toBe(0);
      expect(s.explanation.length).toBeGreaterThan(0);
    }
    expect(result.deferred).toHaveLength(0);
  });

  it("M: each context pools count equals what the filter reported", () => {
    const pools = result.context.pools as Record<string, unknown>;
    expect(pools.removed).toEqual(filterReport.removed);
    expect(pools.deferred).toBe(filterReport.deferred.length);
    expect(pools.scored).toBe(filterReport.kept.length);
    expect(result.deferred).toHaveLength(filterReport.deferred.length);
  });
});

describe("pipeline integrity (§9, §D.4)", () => {
  it("N: score === snapshotTotal, positions 1..n, thresholds from the real limit, recency 14, deferred = exactly the unprofiled", () => {
    const library = buildFixtureLibrary(NOW_MS, { profiles: "canon" });
    const P = buildUserProfile(library, [], EMPTY_TASTE_PREFS, NOW);
    // An item with no usable profile that is also not a seed, so the logged step lets
    // it through: book-1984's committed profile with the version stamped p0.
    const stale = { ...makeItem("book-1984"), profile: { ...(canonProfile("book-1984") as ItemProfile), profile_version: "p0" } };
    const candidates = [candidate(stale), ...["book-beloved", "movie-the-godfather", "book-dune", "movie-amelie", "movie-hereditary", "tv-succession"].map((s) => candidate(makeItem(s)))];

    const { snapshots, context, deferred } = run(candidates, P, { limit: 3 }, library);
    expect(snapshots).toHaveLength(3);
    snapshots.forEach((s: ImpressionSnapshot, i: number) => {
      expect(s.position).toBe(i + 1);
      expect(s.score).toBeCloseTo(snapshotTotal(s), 12);
    });
    expect(context.thresholds.category_cap).toBe(2); // ceil(3/2)
    expect(context.thresholds.theme_cap).toBe(2);
    expect(context.thresholds.recency_days).toBe(14);
    expect(deferred.map((d) => d.key)).toEqual(["canon:book-1984"]); // the p0-stamped item
    const pools = context.pools as Record<string, unknown>;
    expect(pools.deferred).toBe(1);
    expect(context.policy.recency_relaxed).toBe(false);
  });

  it("N: L=5 caps are ceil(5/2)=3 in the context", () => {
    const library = buildFixtureLibrary(NOW_MS, { profiles: "canon" });
    const P = buildUserProfile(library, [], EMPTY_TASTE_PREFS, NOW);
    const candidates = ["book-1984", "movie-the-godfather", "book-dune", "movie-amelie", "book-beloved", "movie-hereditary", "tv-succession", "book-normal-people"].map((s) => candidate(makeItem(s)));
    const { context } = run(candidates, P, { limit: 5 }, library);
    expect(context.thresholds.category_cap).toBe(3);
    expect(context.thresholds.theme_cap).toBe(3);
  });
});

describe("surprise mode (§2.8, §12.8)", () => {
  it("O: scores identical to the non-surprise run; only selection order may differ; policy.surprise = true", () => {
    const library = buildFixtureLibrary(NOW_MS, { profiles: "canon" });
    const P = buildUserProfile(library, [], EMPTY_TASTE_PREFS, NOW);
    const candidates = ["book-1984", "book-beloved", "movie-hereditary", "movie-the-godfather", "book-dune", "movie-amelie", "book-never-let-me-go", "movie-past-lives", "tv-succession", "book-normal-people", "anime-frieren", "tv-fleabag"].map((s) => candidate(makeItem(s)));

    const plain = run(candidates, P, { limit: 5 }, library);
    const surprise = run(candidates, P, { limit: 5, surprise: true }, library);

    // Surprise changes which candidates make the list, so every candidate's stored
    // score is checked against the same scoring layer, not against the other run's list.
    const allScored = scoreCandidates(P, candidates.filter((c) => c.item.profile)).scored;
    const plainKeys = new Set(plain.snapshots.map((s) => s.key));
    const surpriseKeys = new Set(surprise.snapshots.map((s) => s.key));
    for (const s of allScored) {
      if (plainKeys.has(s.candidate.key)) {
        expect(plain.snapshots.find((x) => x.key === s.candidate.key)!.score).toBe(s.score);
      }
      if (surpriseKeys.has(s.candidate.key)) {
        expect(surprise.snapshots.find((x) => x.key === s.candidate.key)!.score).toBe(s.score);
      }
    }
    // The surprise list can differ; when a key appears in both runs, its score is identical.
    for (const s of surprise.snapshots) {
      const twin = plain.snapshots.find((x) => x.key === s.key);
      if (twin) expect(twin.score).toBe(s.score);
    }
    expect(surprise.context.policy.surprise).toBe(true);
    expect(plain.context.policy.surprise).toBe(false);
    // Every stored number still reconstructs: surprise never mutates a score.
    for (const s of surprise.snapshots) expect(s.score).toBeCloseTo(snapshotTotal(s), 12);
  });
});
