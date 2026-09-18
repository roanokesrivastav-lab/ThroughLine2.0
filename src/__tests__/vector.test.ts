import { describe, expect, it } from "vitest";
import { assertNonNegative, sharedFamily, simFamily } from "@/lib/taste/vector";

describe("simFamily family restriction (SPEC §2.1, test matrix #1)", () => {
  it("ignores keys of the other family entirely", () => {
    const u = { "tone.warm": 1, "theme.grief": 1 }; // theme is story, tone is feeling
    const v = { "tone.warm": 1 };
    // Feeling read: identical on the one group present → 1. The story key must not dilute it.
    expect(simFamily("feeling", u, v)).toBe(1);
    // Story read: tone is invisible; no story group is shared → 0.
    expect(simFamily("story", u, v)).toBe(0);
  });

  it("ending contributes 0: it is excluded from both total and weight", () => {
    const u = { "ending.tragic": 1 };
    const v = { "ending.tragic": 1 };
    expect(simFamily("story", u, v)).toBe(0);
    // Even with a shared scored group, ending adds nothing beyond it.
    const a = { "theme.grief": 1, "ending.tragic": 1 };
    const b = { "theme.grief": 1, "ending.tragic": 0.2 };
    expect(simFamily("story", a, b)).toBe(1);
  });

  it("scalars belong to their own family: story scalars do not enter feeling", () => {
    const u = { "tone.warm": 1, complexity: 0.2 };
    const v = { "tone.warm": 1, complexity: 0.9 };
    expect(simFamily("feeling", u, v)).toBe(1); // complexity ignored
    expect(simFamily("story", u, v)).toBeLessThan(1); // scalar closeness 1 − 0.7
  });
});

describe("group skipping (test matrix #2)", () => {
  it("excludes a group empty on one side from the divisor", () => {
    // u has tone+texture; v has only tone. Texture is skipped, so the result is the tone cosine alone.
    const u = { "tone.warm": 1, "texture.dense": 1 };
    const v = { "tone.warm": 1 };
    const toneOnly = simFamily("feeling", { "tone.warm": 1 }, { "tone.warm": 1 });
    expect(simFamily("feeling", u, v)).toBe(toneOnly);
  });

  it("two vectors with no common group → 0", () => {
    expect(simFamily("feeling", { "tone.warm": 1 }, { "tone.bleak": 1 })).toBe(0);
    expect(simFamily("feeling", {}, { "tone.warm": 1 })).toBe(0);
  });

  it("per-pair normalisation: a shared low-weight group alone can still score 1", () => {
    // Only register (0.55) is shared; the divisor is 0.55, not the full G_FEELING sum.
    expect(simFamily("feeling", { "register.quiet": 1 }, { "register.quiet": 1 })).toBe(1);
  });
});

describe("symmetry, bounds, identity (test matrix #3, property)", () => {
  const samples: Array<[Record<string, number>, Record<string, number>]> = [
    [{ "tone.warm": 0.8, "aftertaste.lingering": 0.6, intensity: 0.7 }, { "tone.bleak": 0.5, "aftertaste.devastating": 0.9 }],
    [{ "theme.grief": 0.9, "arc.descent": 0.4, "bond.found-family": 0.7, complexity: 0.6 }, { "theme.memory": 0.8, "arc.homecoming": 0.5 }],
    [{ "theme.grief": 1 }, { "theme.grief": 1, "register.epic": 0.3 }],
    [{}, { "tone.warm": 0.4 }],
  ];
  for (const family of ["story", "feeling"] as const) {
    it(`[${family}] sim(u,v) = sim(v,u), both in [0,1]`, () => {
      for (const [u, v] of samples) {
        const uv = simFamily(family, u, v);
        const vu = simFamily(family, v, u);
        expect(uv).toBeCloseTo(vu, 12);
        expect(uv).toBeGreaterThanOrEqual(0);
        expect(uv).toBeLessThanOrEqual(1);
      }
    });
    it(`[${family}] sim(u,u) = 1 for a non-empty u (and 0 for an empty one)`, () => {
      const u = { "tone.warm": 0.8, "aftertaste.lingering": 0.6, intensity: 0.7, ...(family === "story" ? { "theme.grief": 0.9 } : {}) };
      expect(simFamily(family, u, u)).toBe(1);
      expect(simFamily(family, {}, {})).toBe(0);
    });
  }

  it("story: identical non-empty vectors are 1 even with scalars", () => {
    const u = { "theme.grief": 0.7, "arc.descent": 0.5, "moral-complexity": 0.8, complexity: 0.3 };
    expect(simFamily("story", u, u)).toBe(1);
  });
});

describe("sharedFamily (SPEC §2.1 shared_F)", () => {
  it("weights are u·v·G, sorted descending then by key; zero-weight keys drop out", () => {
    const u = { "tone.warm": 1, "aftertaste.comforting": 0.5, "register.quiet": 1 };
    const v = { "tone.warm": 0.5, "aftertaste.comforting": 0.5, "register.quiet": 0.5 };
    const shared = sharedFamily("feeling", u, v);
    // aftertaste 0.25·1.0 = 0.25; tone 0.5·0.9 = 0.45; register 0.5·0.55 = 0.275
    expect(shared.map((s) => s.key)).toEqual(["tone.warm", "register.quiet", "aftertaste.comforting"]);
    expect(shared[0].weight).toBeCloseTo(0.45, 12);
  });

  it("excludes ending (weight 0) and includes close scalars above 0.8 closeness only", () => {
    const u = { "ending.tragic": 1, "tone.warm": 1, ache: 0.1, pace: 0.9 };
    const v = { "ending.tragic": 1, "tone.warm": 1, ache: 0.2, pace: 0.2 };
    const shared = sharedFamily("feeling", u, v);
    expect(shared.map((s) => s.key)).toEqual(["tone.warm", "ache"]); // pace closeness 0.3 ≤ 0.8
    expect(shared[1].weight).toBeCloseTo((1 - 0.1) * 0.15, 12);
  });
});

describe("assertNonNegative (test matrix #4)", () => {
  it("accepts zeros and ones, throws on any negative value, naming the key", () => {
    expect(() => assertNonNegative({ "tone.warm": 0, "theme.grief": 1 })).not.toThrow();
    expect(() => assertNonNegative({ "tone.warm": -0.01 })).toThrow(/tone\.warm/);
    expect(() => assertNonNegative({ ache: -1 }, "entry vector")).toThrow(/entry vector/);
  });
});
