import { describe, expect, it } from "vitest";
import {
  categoryArtifacts,
  evaluate,
  pairwise,
  prevalence,
  scalarMae,
  setJaccard,
  topKOverlap,
  weightedJaccard,
} from "@/lib/taste/qa";
import { PROFILE_CAPS } from "@/lib/ai/profile-contract";
import type { ItemProfile } from "@/lib/types";

describe("weightedJaccard (test A)", () => {
  it("identical vectors → 1", () => {
    expect(weightedJaccard({ a: 0.5, b: 0.2 }, { a: 0.5, b: 0.2 })).toBe(1);
  });
  it("disjoint → 0", () => {
    expect(weightedJaccard({ a: 0.5 }, { b: 0.5 })).toBe(0);
  });
  it("both empty → null", () => {
    expect(weightedJaccard({}, {})).toBeNull();
  });
  it("one empty → 0", () => {
    expect(weightedJaccard({ a: 0.5 }, {})).toBe(0);
    expect(weightedJaccard({}, { a: 0.5 })).toBe(0);
  });
  it("hand-worked example: Σmin/Σmax over the union", () => {
    // u = {a: 0.8, b: 0.4, c: 0.1}; v = {a: 0.6, d: 0.2, c: 0.9}
    // Σmin = 0.6 + 0 + 0.1 + 0 = 0.7; Σmax = 0.8 + 0.4 + 0.9 + 0.2 = 2.3
    expect(weightedJaccard({ a: 0.8, b: 0.4, c: 0.1 }, { a: 0.6, c: 0.9, d: 0.2 })).toBeCloseTo(0.7 / 2.3, 10);
  });
});

describe("topKOverlap / scalarMae / setJaccard / pairwise (test B)", () => {
  it("ties broken by key ascending", () => {
    // {b: 0.5, a: 0.5, c: 0.9} top 2 = c then a (tie between a and b broken by key).
    const u = { b: 0.5, a: 0.5, c: 0.9 };
    const v = { a: 0.5, c: 0.9, b: 0.5 };
    expect(topKOverlap(u, v, 2)).toBe(1); // {c, a} ∩ {c, a}
    const w = { b: 0.5, d: 0.5, c: 0.9 };
    // topK(u) = {c, a}; topK(w) = {c, b}; overlap = 1/2.
    expect(topKOverlap(u, w, 2)).toBe(0.5);
  });
  it("both empty → null", () => {
    expect(topKOverlap({}, {}, 5)).toBeNull();
  });
  it("scalarMae ignores one-sided keys and returns null when none are shared", () => {
    const keys = ["intensity", "ache", "pace"] as const;
    expect(scalarMae({ intensity: 0.8, ache: 0.2 }, { intensity: 0.6, pace: 1 }, keys)).toBeCloseTo(0.2, 10);
    expect(scalarMae({ intensity: 0.8 }, { ache: 0.2 }, keys)).toBeNull();
  });
  it("setJaccard: null when both empty, otherwise |∩|/|∪|", () => {
    expect(setJaccard([], [])).toBeNull();
    expect(setJaccard(["a"], [])).toBe(0);
    expect(setJaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3, 10);
  });
  it("pairwise gives all unordered pairs in stable order", () => {
    expect(pairwise([1, 2, 3])).toEqual([[1, 2], [1, 3], [2, 3]]);
  });
});

const profile = (category: import("@/lib/types").Category, vector: { story?: Record<string, number>; feeling?: Record<string, number> }): { category: import("@/lib/types").Category; profile: ItemProfile } => {
  const toAttrs = (v: Record<string, number>) => Object.entries(v).map(([key, weight]) => ({ key, weight, confidence: 1, source: "ai" as const }));
  return {
    category,
    profile: {
      profile_version: "p1",
      vocabulary_version: "v2",
      premise: null,
      story: toAttrs(vector.story ?? {}),
      feeling: toAttrs(vector.feeling ?? {}),
      form: { minutes_to_finish: null, band: null, craft: [] },
      vector: { story: vector.story ?? {}, feeling: vector.feeling ?? {} },
    },
  };
};

describe("prevalence and categoryArtifacts (test C)", () => {
  const items = [
    profile("movie", { story: { "theme.grief": 0.8, "frame.crime": 0.9 }, feeling: { "tone.bleak": 0.7 } }),
    profile("movie", { story: { "theme.grief": 0.5, "frame.crime": 0.6 }, feeling: {} }),
    profile("book", { story: { "theme.grief": 0.9 }, feeling: { "tone.bleak": 0.4, "tone.warm": 0.6 } }),
  ];
  it("gives exact shares and the specified ordering", () => {
    const rows = prevalence(items);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect(byKey.get("theme.grief")?.global).toBe(1); // 3/3
    expect(byKey.get("frame.crime")?.global).toBeCloseTo(2 / 3, 10);
    expect(byKey.get("tone.bleak")?.global).toBeCloseTo(2 / 3, 10);
    expect(byKey.get("tone.warm")?.global).toBeCloseTo(1 / 3, 10);
    // Ordering: global desc, then key ascending. theme.grief first.
    expect(rows[0].key).toBe("theme.grief");
    // frame.crime and tone.bleak tie at 2/3 → key ascending: "frame.crime" < "tone.bleak".
    expect(rows[1].key).toBe("frame.crime");
    expect(rows[2].key).toBe("tone.bleak");
    // Per-category shares.
    expect(byKey.get("theme.grief")?.byCategory.movie).toBe(1);
    expect(byKey.get("theme.grief")?.byCategory.book).toBe(1);
    expect(byKey.get("tone.warm")?.byCategory.book).toBe(1);
    // Categories where the key is absent report a 0 share (so categoryArtifacts can see them).
    expect(byKey.get("tone.warm")?.byCategory.movie).toBe(0);
  });
  it("categoryArtifacts flags a category-local key and ignores categories with < 5 profiles", () => {
    // Construct an artifact: "anime-only" key present in the single anime profile,
    // absent everywhere else. movie/book have < 5 profiles here, so nothing qualifies.
    const few = [...items, profile("anime", { story: { "frame.slice-of-life": 0.9 } })];
    expect(categoryArtifacts(prevalence(few), { movie: 2, book: 1, anime: 1 })).toEqual([]);

    // With ≥ 5 profiles per category, a key at 0.8 in one and 0 elsewhere is flagged.
    const many: Array<{ category: import("@/lib/types").Category; profile: ItemProfile }> = [];
    for (let i = 0; i < 5; i++) {
      many.push(profile("anime", { story: { "frame.slice-of-life": 0.9 } }));
      many.push(profile("book", { story: { "theme.grief": 0.5 } }));
    }
    const rows = categoryArtifacts(prevalence(many), { anime: 5, book: 5 });
    expect(rows.map((r) => r.key)).toContain("frame.slice-of-life");
    // theme.grief (100% book, 0% anime) is equally category-local and is flagged too —
    // the rule is symmetric; "artifact" means category-confined, whatever the category.
    expect(rows.map((r) => r.key)).toContain("theme.grief");
    // A key shared broadly across categories is not an artifact.
    const broad = prevalence([
      profile("anime", { story: { "theme.grief": 0.9 } }),
      profile("book", { story: { "theme.grief": 0.9 } }),
      profile("movie", { story: { "theme.grief": 0.9 } }),
      profile("tv", { story: { "theme.grief": 0.9 } }),
      profile("music", { story: { "theme.grief": 0.9 } }),
    ]);
    expect(categoryArtifacts(broad, { anime: 1, book: 1, movie: 1, tv: 1, music: 1 })).toEqual([]); // < 5 per category
  });
});

describe("evaluate (test D)", () => {
  const rows = (metrics: Parameters<typeof evaluate>[0]) =>
    new Map(evaluate(metrics).map((r) => [r.name, r]));

  it("boundary values pass and fail at the right side", () => {
    const m = rows({
      firstPassStrict: 0.9, committedStrict: 1, agreementStory: 0.5, agreementFeeling: 0.5,
      scalarMae: 0.15, maxPrevalence: 0.5,
    });
    expect(m.get("agreementStory")).toMatchObject({ pass: true, threshold: 0.5 });
    expect(m.get("agreementFeeling")).toMatchObject({ pass: true });
    expect(m.get("scalarMae")).toMatchObject({ pass: true, value: 0.15, threshold: 0.15 });
    expect(m.get("prevalenceFlag")).toMatchObject({ pass: true, value: 0.5 });
    // One notch over fails.
    const bad = rows({
      firstPassStrict: 0.9, committedStrict: 1, agreementStory: 0.49, agreementFeeling: 0.5,
      scalarMae: 0.16, maxPrevalence: 0.51,
    });
    expect(bad.get("agreementStory")?.pass).toBe(false);
    expect(bad.get("scalarMae")?.pass).toBe(false);
    expect(bad.get("prevalenceFlag")?.pass).toBe(false);
  });
  it("null values give pass: null, never a silent pass", () => {
    const m = rows({
      firstPassStrict: 0.9, committedStrict: 1, agreementStory: null, agreementFeeling: null,
      scalarMae: null, maxPrevalence: 0.4,
    });
    expect(m.get("agreementStory")).toMatchObject({ pass: null, value: null });
    expect(m.get("agreementFeeling")?.pass).toBeNull();
    expect(m.get("scalarMae")?.pass).toBeNull();
  });
  it("firstPassStrict and committedStrict use ≥ on their shares", () => {
    const m = rows({
      firstPassStrict: 0.899999, committedStrict: 1, agreementStory: 0.6, agreementFeeling: 0.6,
      scalarMae: 0.1, maxPrevalence: 0.4,
    });
    expect(m.get("firstPassStrict")?.pass).toBe(false);
    expect(m.get("committedStrict")?.pass).toBe(true);
  });
});

describe("PROFILE_CAPS feeds the schema and groupFill", () => {
  it("caps match SPEC §1.2", () => {
    expect(PROFILE_CAPS.theme).toBe(4);
    expect(PROFILE_CAPS.ending).toBe(1);
    expect(PROFILE_CAPS.tone).toBe(4);
    expect(PROFILE_CAPS.aftertaste).toBe(3);
  });
  it("groupFill reports mean count, cap and share at cap", async () => {
    const { groupFill } = await import("@/lib/taste/qa");
    const items = [
      profile("movie", { story: { "theme.grief": 0.8, "theme.love": 0.7 } }),
      profile("book", { story: { "theme.grief": 0.9, "theme.love": 0.6 } }),
    ];
    const rows = groupFill(items);
    const theme = rows.find((r) => r.group === "theme");
    expect(theme?.cap).toBe(4);
    expect(theme?.meanCount).toBeCloseTo(2, 10);
    expect(theme?.shareAtCap).toBe(0); // nobody reached the cap of 4
  });
});
