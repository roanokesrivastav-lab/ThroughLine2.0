// Tests for the impression snapshot and session context (SPEC-STAGE3 §9; matrix §C 38–39),
// and the training-eligibility rule (§12.2, §12.8).
import { describe, expect, it } from "vitest";

import { CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { mockExtract } from "@/lib/ai/mock-extractor";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { buildUserProfile } from "@/lib/taste/profile";
import { scoreCandidate, type StageCandidate } from "@/lib/taste/score";
import { buildContext, buildSnapshot, snapshotTotal, trainingEligible } from "@/lib/taste/snapshot";
import { COMPONENTS, FEATURE_VERSION, PROFILE_VERSION, RECENCY_DAYS } from "@/lib/taste/weights";
import { CALIBRATION } from "@/lib/taste/calibration";
import { VOCABULARY_VERSION } from "@/lib/taste/vocabulary";
import { EMPTY_TASTE_PREFS } from "@/lib/taste/tags";
import type { MediaItem } from "@/lib/types";

const NOW = new Date("2026-09-25T12:00:00Z").getTime();

function makeItem(slug: string): MediaItem {
  const c = CANON_BY_SLUG.get(slug);
  if (!c) throw new Error(`no canon item ${slug}`);
  const r = canonToResult(c);
  return { ...r, id: `item-${slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(slug) };
}

function candidate(item: MediaItem, entryId: string | null = null): StageCandidate {
  const creator = item.creators[0];
  return { key: `${item.source}:${item.external_id}`, item, entryId, sources: ["canon"], creatorKey: creator ? `${item.category}:${creator.name.toLowerCase()}` : null };
}

const lib = () => buildFixtureLibrary(NOW, { profiles: "canon" });
const profile = () => buildUserProfile(lib(), [], EMPTY_TASTE_PREFS, new Date(NOW));

function snap(slug: string) {
  const library = lib();
  const s = scoreCandidate(profile(), candidate(makeItem(slug)));
  if (!s) throw new Error(`${slug} did not score`);
  return buildSnapshot({
    position: 1, scored: s, library, filters: { listOnly: false, surprise: false },
    fits: null, rerank: { band: "familiar", closeness: 0.7, pass: 1, bridge_repair: false },
    route: s.contributions.story >= Math.max(s.contributions.feeling, s.contributions.form, s.contributions.creator, s.contributions.phase) ? "story" : "feeling",
    anchor: s.anchors.story ?? s.anchors.feeling,
    shared: [],
    anchorEntry: (s.anchors.story ?? s.anchors.feeling) ? library.find((e) => e.entry.id === (s.anchors.story ?? s.anchors.feeling)!.anchor.entryId) ?? null : null,
  });
}

describe("ImpressionSnapshot completeness (§9.1, §C38)", () => {
  it("L: every §9.1 key is present in order; features carry exactly the six components; score = snapshotTotal; recency_days = 14", () => {
    const snapshot = snap("book-never-let-me-go");
    expect(Object.keys(snapshot)).toEqual([
      "position", "key", "item", "entryId", "sources", "creatorKey", "features", "raw", "has_evidence",
      "weights", "contributions", "score", "route", "anchor", "shared", "explain", "indicators", "rerank", "versions", "explanation",
    ]);
    expect(Object.keys(snapshot.features)).toEqual([...COMPONENTS]);
    expect(Object.keys(snapshot.item)).toEqual(["id", "title", "category", "creator", "profile_version"]);
    expect(snapshot.score).toBeCloseTo(snapshotTotal(snapshot), 12);
    const ctx = buildContext({ filters: { listOnly: false, surprise: false }, profile: profile() });
    expect(ctx.thresholds.recency_days).toBe(RECENCY_DAYS);
    expect(ctx.thresholds.recency_days).toBe(14);
  });

  it("versions carry the four ids; never-stored fields are absent (§9.3)", () => {
    const snapshot = snap("movie-aftersun");
    expect(snapshot.versions).toEqual({
      feature_version: FEATURE_VERSION,
      profile_version: PROFILE_VERSION,
      vocabulary_version: VOCABULARY_VERSION,
      calibration_id: CALIBRATION.id,
    });
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("raw_note");
    expect(json).not.toContain("premise");
    expect(json).not.toContain("feel_prior");
  });

  it("indicators are all 0 or 1 and derived correctly", () => {
    const snapshot = snap("book-never-let-me-go");
    for (const v of Object.values(snapshot.indicators)) expect([0, 1]).toContain(v);
    expect(snapshot.indicators.is_backlog).toBe(0);
    expect(snapshot.indicators.band_adjacent).toBe(0); // rerank.band = familiar
    if (snapshot.anchor) expect(snapshot.indicators.own_words).toBe(snapshot.anchor.ownWords ? 1 : 0);
  });
});

describe("SessionContext (§9.2)", () => {
  it("weights_source, learned, calibration and the profile summary shape", () => {
    const ctx = buildContext({ filters: { listOnly: false, surprise: true }, profile: profile() });
    expect(ctx.weights_source).toBe("w0");
    expect(ctx.learned).toBeNull();
    expect(ctx.calibration.story.lo).toBe(CALIBRATION.story.lo);
    expect(ctx.calibration.feeling.hi).toBe(CALIBRATION.feeling.hi);
    expect(ctx.filters.surprise).toBe(true);
    // Profile summary: tops are [key, weight] pairs, creators are weight ≥ 0.4.
    if (ctx.profile.story) {
      expect(ctx.profile.story.top.length).toBeLessThanOrEqual(20);
      for (const [key, weight] of ctx.profile.story.top) {
        expect(typeof key).toBe("string");
        expect(weight).toBeGreaterThan(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
    for (const c of ctx.profile.creators) expect(c.weight).toBeGreaterThanOrEqual(0.4);
    expect(ctx.pools).toBeNull();
    expect(ctx.policy).toEqual({ quotas: null, quota_unfilled: [], recency_relaxed: false, caps_relaxed: [], surprise: true });
  });
});

describe("trainingEligible (§12.2, §12.8; §C39)", () => {
  it("M: false for an f0 snapshot or a surprise context; true otherwise", () => {
    const snapshot = snap("movie-past-lives");
    const ctx = buildContext({ filters: { listOnly: false, surprise: false }, profile: profile() });
    expect(trainingEligible(snapshot, ctx)).toBe(true);
    const stale = { ...snapshot, versions: { ...snapshot.versions, feature_version: "f0" } };
    expect(trainingEligible(stale, ctx)).toBe(false);
    const surpriseCtx = buildContext({ filters: { listOnly: false, surprise: true }, profile: profile() });
    expect(trainingEligible(snapshot, surpriseCtx)).toBe(false);
  });

  // Review round: n_loved counts loved entries, not retained anchors. A library with more
  // loved entries than MAX_ANCHORS (40) must not report 40.
  it("n_loved counts every loved entry even when anchors cap at MAX_ANCHORS", () => {
    const library = lib();
    // The first fixture entry (completed, tapped, noted, profiled) is loved at aff ≈ 0.83.
    const loved = library.find((e) => e.entry.status === "completed" && e.reactions.length > 0 && e.extractions.length > 0);
    expect(loved).toBeDefined();
    for (let i = 0; i < 45; i++) {
      library.push({
        ...loved!,
        entry: { ...loved!.entry, id: `e-clone-${i}` },
        item: { ...loved!.item, id: `item-clone-${i}` },
        reactions: loved!.reactions.map((r) => ({ ...r, id: `r-clone-${i}`, entry_id: `e-clone-${i}` })),
        extractions: loved!.extractions.map((x) => ({ ...x, id: `x-clone-${i}`, reaction_id: `r-clone-${i}`, entry_id: `e-clone-${i}` })),
      });
    }
    const P = buildUserProfile(library, [], EMPTY_TASTE_PREFS, new Date(NOW));
    expect(P.story).not.toBeNull();
    expect(P.story!.anchors.length).toBeLessThanOrEqual(40);
    const ctx = buildContext({ filters: { listOnly: false, surprise: false }, profile: P });
    expect(ctx.profile.story!.n_loved).toBeGreaterThan(40);
  });

  // Review round: an entry with neither a v2 reading nor a usable profile supplies no
  // anchor evidence (§4.3). A done v1 row must not be misread as a v2 family vector.
  it("a loved entry whose only reading is v1, on an unprofiled item, is excluded from anchors", () => {
    const item = { ...makeItem("book-the-road"), profile: null };
    const created = new Date(NOW - 5 * 86_400_000).toISOString();
    const x = mockExtract({ note: "Cold and heavy, devastating.", dimensions: { loved: true }, category: item.category, title: item.title, subtitle: item.subtitle });
    const library = [{
      entry: { id: "e-road", user_id: "u", media_item_id: item.id, status: "completed" as const, private_score: null, consumed_at: created.slice(0, 10), consumed_until: null, consumed_precision: "day" as const, origin: "demo" as const, created_at: created, updated_at: created },
      item,
      reactions: [{ id: "r-road", entry_id: "e-road", user_id: "u", dimensions: { loved: true }, raw_note: "Cold and heavy, devastating.", source: "demo" as const, created_at: created }],
      extractions: [{ ...mockRow(x), vocabulary_version: "v1" as const }],
      resurfaces: [],
    }];
    const P = buildUserProfile(library, [], EMPTY_TASTE_PREFS, new Date(NOW));
    expect(P.story).toBeNull();
    expect(P.feeling).toBeNull();

    // The same entry with a v2 row does anchor — the exclusion is version-specific.
    const x2 = mockExtract({ note: "A quiet meditation on memory and grief, tender and devastating.", dimensions: { loved: true }, category: item.category, title: item.title, subtitle: item.subtitle });
    const libraryV2 = [{ ...library[0]!, extractions: [mockRow(x2)] }];
    const P2 = buildUserProfile(libraryV2, [], EMPTY_TASTE_PREFS, new Date(NOW));
    expect(P2.story).not.toBeNull();
    expect(P2.story!.anchors).toHaveLength(1);
  });
});

function mockRow(x: ReturnType<typeof mockExtract>) {
  const created = new Date().toISOString();
  return { id: "x-road", reaction_id: "r-road", entry_id: "e-road", user_id: "u", status: "done" as const, attributes: x.extraction, vector: x.vector, vocabulary_version: "v2" as const, extractor: "mock" as const, attempts: 1, last_error: null, extracted_at: created, created_at: created };
};
