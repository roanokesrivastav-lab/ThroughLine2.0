// Tests for the Stage 3 scorer (SPEC-STAGE3 §2; matrix §C 15–21, 46–47, plus the
// anchor-self-skip and determinism cases the S5 handoff adds as P and Q).
// Offline and deterministic: the fixture library with committed canon profiles,
// a fixed `now`, and hand-built profiles where an exact number is asserted.
import { describe, expect, it } from "vitest";

import { CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { mockExtract } from "@/lib/ai/mock-extractor";
import { buildFixtureLibrary, fixtureProfile } from "@/lib/dev/fixtures";
import { buildUserProfile, type UserProfile } from "@/lib/taste/profile";
import { entryVectorFamily } from "@/lib/taste/affinity";
import { scoreCandidate, scoreCandidates, orderScored, type StageCandidate } from "@/lib/taste/score";
import { COMPONENTS, W0, type Component } from "@/lib/taste/weights";
import { EMPTY_TASTE_PREFS } from "@/lib/taste/tags";
import type { ItemProfile, MediaItem } from "@/lib/types";

const NOW = new Date("2026-09-25T12:00:00Z").getTime();

/** A canon item with its committed profile (falling back to the placeholder for the one unprofiled slug). */
function makeItem(slug: string, profile?: ItemProfile | null): MediaItem {
  const c = CANON_BY_SLUG.get(slug);
  if (!c) throw new Error(`no canon item ${slug}`);
  const r = canonToResult(c);
  return {
    ...r,
    id: `item-${slug}`,
    feel_prior: r.feel_prior ?? null,
    profile: profile === undefined ? canonProfile(slug) ?? fixtureProfile(r as MediaItem) : profile,
  };
}

function asProfiledAt(profile: ItemProfile, version: string): ItemProfile {
  return { ...profile, profile_version: version };
}

function candidate(item: MediaItem, opts: { entryId?: string | null; creatorKey?: string | null } = {}): StageCandidate {
  const creator = item.creators[0];
  return {
    key: `${item.source}:${item.external_id}`,
    item,
    entryId: opts.entryId ?? null,
    sources: ["canon"],
    creatorKey: opts.creatorKey === undefined ? (creator ? `book:${creator.name.toLowerCase()}` : null) : opts.creatorKey,
  };
}

/** A profile with no evidence at all: every component scores 0. */
function blankProfile(): UserProfile {
  return {
    story: null,
    feeling: null,
    form: {},
    creators: new Map(),
    activePhase: null,
    anti: { story: null, feeling: null, evidence: 0 },
    evidence: { loved: 0, notes: 0, profiled: 0 },
  };
}

const lib = () => buildFixtureLibrary(NOW, { profiles: "canon" });
const profile = () => buildUserProfile(lib(), [], EMPTY_TASTE_PREFS, new Date(NOW));

describe("scoreCandidate (§2, §C15–21)", () => {
  // A: score is literally Σ contributions, and the creator delta is exact.
  it("A: score equals the sum of the six contributions for fixture candidates", () => {
    const P = profile();
    const items = ["movie-aftersun", "book-never-let-me-go", "movie-past-lives", "tv-fleabag", "anime-frieren"].map((s) => makeItem(s));
    for (const item of items) {
      const s = scoreCandidate(P, candidate(item));
      expect(s).not.toBeNull();
      const sum = COMPONENTS.reduce((n, k) => n + (s as NonNullable<typeof s>).contributions[k], 0);
      expect(Math.abs((s as NonNullable<typeof s>).score - sum)).toBeLessThanOrEqual(1e-9);
    }
  });

  it("A: a creator feature of 0.5 beats an otherwise-identical candidate by exactly 0.10 × 0.5", () => {
    // Hand-built profile so the creator weight is exactly 0.5 and nothing else differs.
    const item = makeItem("book-never-let-me-go");
    const vec = (item.profile as ItemProfile).vector;
    const P: UserProfile = {
      ...blankProfile(),
      creators: new Map([["book:kazuo ishiguro", { key: "book:kazuo ishiguro", name: "Kazuo Ishiguro", role: "author", category: "book", weight: 0.5, entryIds: ["e1", "e2"] }]]),
    };
    const withCreator = scoreCandidate(P, candidate(item, { creatorKey: "book:kazuo ishiguro" }));
    const withoutCreator = scoreCandidate(P, candidate(item, { creatorKey: null }));
    expect(withCreator).not.toBeNull();
    expect(withoutCreator).not.toBeNull();
    expect(withCreator!.features.creator).toBe(0.5);
    expect(withoutCreator!.features.creator).toBe(0);
    expect(Math.abs(withCreator!.score - withoutCreator!.score - 0.1 * 0.5)).toBeLessThanOrEqual(1e-12);
    // The story vectors are identical, so the rest of the score agrees to the last bit.
    expect(withCreator!.features.story).toBe(withoutCreator!.features.story);
    expect(vec).toBeDefined();
  });

  // B: an unprofiled candidate is deferred, never partially scored (§6 step 8).
  it("B: an unprofiled candidate and a p0-profiled one land in deferred, not scored", () => {
    const P = profile();
    const unprofiled = makeItem("book-piranesi", null);
    const stale = makeItem("anime-mushishi", asProfiledAt(canonProfile("anime-mushishi")!, "p0"));
    expect(stale.profile?.profile_version).toBe("p0");
    const { scored, deferred } = scoreCandidates(P, [candidate(unprofiled), candidate(stale), candidate(makeItem("movie-aftersun"))]);
    expect(scored.map((s) => s.candidate.key)).toEqual(["canon:movie-aftersun"]);
    expect(deferred.map((d) => d.key)).toEqual(["canon:book-piranesi", "canon:anime-mushishi"]);
  });

  // C: a null family scores 0 with no evidence, and ranks like a zero weight.
  it("C: with P.feeling null, feeling is 0 everywhere and the order matches weights.feeling = 0", () => {
    const full = profile();
    const P: UserProfile = { ...full, feeling: null };
    const cands = ["movie-aftersun", "book-never-let-me-go", "movie-past-lives", "tv-fleabag", "anime-frieren", "book-klara-and-the-sun"].map((s) => candidate(makeItem(s)));
    const scored = scoreCandidates(P, cands).scored;
    expect(scored.length).toBe(cands.length);
    for (const s of scored) {
      expect(s.features.feeling).toBe(0);
      expect(s.has_evidence.feeling).toBe(false);
    }
    const withZeroWeight = scoreCandidates(full, cands, { ...W0, feeling: 0 }).scored;
    expect(orderScored(scored, { surprise: false, userId: "u" }).map((s) => s.candidate.key))
      .toEqual(orderScored(withZeroWeight, { surprise: false, userId: "u" }).map((s) => s.candidate.key));
  }, 20000);

  // D: creator absent → 0; loved Ishiguro books → ≥ 0.5 and the creator route when it dominates.
  it("D: creator feature comes from the profile, and the creator route wins when its contribution is higher", () => {
    const P = profile();
    const noCreator = scoreCandidate(P, candidate(makeItem("movie-aftersun"), { creatorKey: null }));
    expect(noCreator).not.toBeNull();
    expect(noCreator!.features.creator).toBe(0);

    // Three loved Ishiguro books are in the fixture library.
    const ishiguro = candidate(makeItem("book-klara-and-the-sun"), { creatorKey: "book:kazuo ishiguro" });
    const s = scoreCandidate(P, ishiguro);
    expect(s).not.toBeNull();
    expect(s!.features.creator).toBeGreaterThanOrEqual(0.5);

    // With story and feeling held down, the creator contribution dominates → route creator.
    const weights: Record<Component, number> = { story: 0.01, feeling: 0.01, form: 0, creator: 0.1, phase: 0, anti: -0.15 };
    const forced = scoreCandidate(P, ishiguro, weights);
    expect(forced).not.toBeNull();
    expect(forced!.contributions.creator).toBeGreaterThan(forced!.contributions.story);
  });

  // E: phase feature from the one active phase (§2.6).
  it("E: no active phase scores 0; an injected sci-fi genre_run scores 1 on the tag and 0.6 on a child tag", () => {
    const P = profile();
    const plain = scoreCandidates(P, [candidate(makeItem("book-1984")), candidate(makeItem("book-the-road"))]).scored;
    for (const s of plain) expect(s.features.phase).toBe(0);

    const phase = {
      id: "ph1", user_id: "u", kind: "genre_run" as const, fingerprint: "fp-test",
      label: "Sci-fi run", user_label: null, start_at: "2026-06-01", end_at: "2099-01-01",
      category: null, confidence: 0.9, evidence: { genre: "sci-fi" }, dismissed: false, detected_at: "2026-06-02",
    };
    const withPhase = buildUserProfile(lib(), [phase], EMPTY_TASTE_PREFS, new Date(NOW));
    const direct = scoreCandidate(withPhase, candidate(makeItem("book-1984")));
    const child = scoreCandidate(withPhase, candidate(makeItem("book-the-road")));
    expect(direct).not.toBeNull();
    expect(child).not.toBeNull();
    expect(direct!.features.phase).toBe(1); // "sci-fi" is in the item's own tags
    expect(child!.features.phase).toBe(0.6); // "dystopia" has sci-fi as its parent
  });

  // F: the anti component lowers the score linearly (§2.7, §C20). The fixture library's
  // anti-profile is already active, so the exact arithmetic is asserted on the delta instead
  // of from a zero baseline.
  it("F: injecting an anti vector lowers S by exactly 0.15 × Δv_anti", () => {
    const P = profile();
    const item = makeItem("book-never-let-me-go");
    const base = scoreCandidate(P, candidate(item));
    expect(base).not.toBeNull();
    expect(base!.features.anti).toBeGreaterThan(0); // the fixture library has dropped-entry + didnt_work evidence

    const antiStory = (item.profile as ItemProfile).vector.story; // identical vector → similarity 1
    const P2: UserProfile = { ...P, anti: { story: antiStory, feeling: null, evidence: P.anti.evidence } };
    const raised = scoreCandidate(P2, candidate(item));
    expect(raised).not.toBeNull();
    const delta = raised!.features.anti - base!.features.anti;
    expect(Math.abs((base!.score - raised!.score) - W0.anti * -1 * delta)).toBeLessThanOrEqual(1e-9);
  });

  // N (§C46): an empty library scores without throwing; story and feeling are 0.
  it("N: empty library → null families, story/feeling 0, no throw; empty candidate list → empty", () => {
    const P = buildUserProfile([], [], EMPTY_TASTE_PREFS, new Date(NOW));
    expect(P.story).toBeNull();
    expect(P.feeling).toBeNull();
    const { scored } = scoreCandidates(P, [candidate(makeItem("movie-aftersun")), candidate(makeItem("book-1984"))]);
    expect(scored).toHaveLength(2);
    for (const s of scored) {
      expect(s.features.story).toBe(0);
      expect(s.features.feeling).toBe(0);
      expect(s.has_evidence.story).toBe(false);
    }
    expect(scoreCandidates(P, []).scored).toEqual([]);
  });

  // O (§C47): a single loved entry → the centroid is that entry's vector, one anchor.
  it("O: single loved entry → centroid equals the entry vector, exactly one anchor, results still produced", () => {
    const item = makeItem("book-klara-and-the-sun");
    const created = new Date(NOW - 10 * 86_400_000).toISOString();
    const entryId = "e-klara";
    const reactionId = "r-klara";
    const note = "Quiet and tender, aching the whole way through.";
    const x = mockExtract({ note, dimensions: { loved: true }, category: item.category, title: item.title, subtitle: item.subtitle });
    const library = [{
      entry: { id: entryId, user_id: "u", media_item_id: item.id, status: "completed" as const, private_score: null, consumed_at: created.slice(0, 10), consumed_until: null, consumed_precision: "day" as const, origin: "demo" as const, created_at: created, updated_at: created },
      item,
      reactions: [{ id: reactionId, entry_id: entryId, user_id: "u", dimensions: { loved: true }, raw_note: note, source: "demo" as const, created_at: created }],
      extractions: [{ id: "x-klara", reaction_id: reactionId, entry_id: entryId, user_id: "u", status: "done" as const, attributes: x.extraction, vector: x.vector, vocabulary_version: x.vocabulary_version, extractor: "mock", attempts: 1, last_error: null, extracted_at: created, created_at: created }],
      resurfaces: [],
    }];
    const P = buildUserProfile(library, [], EMPTY_TASTE_PREFS, new Date(NOW));
    expect(P.story).not.toBeNull();
    expect(P.feeling).not.toBeNull();
    // The centroid is exactly the entry's blended family vector.
    const storyVec = entryVectorFamily(library[0]!, "story");
    const feelingVec = entryVectorFamily(library[0]!, "feeling");
    expect(storyVec).not.toBeNull();
    expect(feelingVec).not.toBeNull();
    expect(Math.abs(P.story!.centroid["cast.single-protagonist"] - storyVec!["cast.single-protagonist"])).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(P.feeling!.centroid["tone.tender"] - feelingVec!["tone.tender"])).toBeLessThanOrEqual(1e-12);
    expect(P.story!.anchors).toHaveLength(1);
    expect(P.feeling!.anchors).toHaveLength(1);
    const { scored } = scoreCandidates(P, [candidate(makeItem("book-never-let-me-go")), candidate(makeItem("movie-past-lives"))]);
    expect(scored).toHaveLength(2);
  });

  // P: a candidate that is itself an anchor never picks itself.
  it("P: a candidate whose item is an anchor never picks itself as the anchor", () => {
    const item = makeItem("book-klara-and-the-sun");
    const created = new Date(NOW - 10 * 86_400_000).toISOString();
    const library = [{
      entry: { id: "e-klara", user_id: "u", media_item_id: item.id, status: "completed" as const, private_score: null, consumed_at: created.slice(0, 10), consumed_until: null, consumed_precision: "day" as const, origin: "demo" as const, created_at: created, updated_at: created },
      item,
      reactions: [{ id: "r-klara", entry_id: "e-klara", user_id: "u", dimensions: { loved: true }, raw_note: null, source: "demo" as const, created_at: created }],
      extractions: [],
      resurfaces: [],
    }];
    const P = buildUserProfile(library, [], EMPTY_TASTE_PREFS, new Date(NOW));
    const s = scoreCandidate(P, candidate(item, { entryId: "e-klara" }));
    expect(s).not.toBeNull();
    expect(s!.anchors.story).toBeNull();
    expect(s!.anchors.feeling).toBeNull();
  });

  // Q: deterministic order; surprise re-orders but never changes a score.
  it("Q: shuffled input gives an identical order, and surprise changes order but never score", () => {
    const P = profile();
    const cands = ["movie-aftersun", "book-never-let-me-go", "movie-past-lives", "tv-fleabag", "anime-frieren", "book-klara-and-the-sun", "tv-succession", "book-the-road"].map((s) => candidate(makeItem(s)));
    const a = orderScored(scoreCandidates(P, cands).scored, { surprise: false, userId: "u" });
    const shuffled = [...cands].reverse();
    const b = orderScored(scoreCandidates(P, shuffled).scored, { surprise: false, userId: "u" });
    expect(b.map((s) => s.candidate.key)).toEqual(a.map((s) => s.candidate.key));

    const plain = orderScored(scoreCandidates(P, cands).scored, { surprise: false, userId: "u" });
    const surprise = orderScored(scoreCandidates(P, cands).scored, { surprise: true, userId: "u" });
    const scoreOf = (list: typeof plain) => new Map(list.map((s) => [s.candidate.key, s.score]));
    const before = scoreOf(plain);
    const after = scoreOf(surprise);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [key, score] of before) expect(after.get(key)).toBe(score);
  });
});
