// Tests for the impression snapshot and session context (SPEC-STAGE3 §9; matrix §C 38–39),
// and the training-eligibility rule (§12.2, §12.8).
import { describe, expect, it } from "vitest";

import { CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
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
});
