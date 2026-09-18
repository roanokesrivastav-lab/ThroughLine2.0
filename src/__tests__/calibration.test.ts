import { describe, expect, it } from "vitest";
import {
  CALIBRATION,
  CALIBRATION_SEED,
  EXHAUSTIVE_MAX_N,
  MIN_POPULATION,
  SAMPLE_PAIRS,
  cal,
  calFeeling,
  calStory,
  calibrate,
  pairIndexes,
  percentile,
  xorshift32,
} from "@/lib/taste/calibration";

describe("calibration map (SPEC §3.1, test matrix #5)", () => {
  const range = { lo: 0.18, hi: 0.62 };

  it("clamps outside [lo, hi] with no extrapolation", () => {
    expect(cal(range.lo, range)).toBe(0);
    expect(cal(range.hi, range)).toBe(1);
    expect(cal(range.lo - 0.2, range)).toBe(0);
    expect(cal(range.hi + 0.2, range)).toBe(1);
  });

  it("is linear and monotone in between", () => {
    expect(cal(0.4, range)).toBeCloseTo((0.4 - 0.18) / 0.44, 12);
    for (let s = 0; s <= 1; s += 0.01) {
      expect(cal(s + 0.01, range)).toBeGreaterThanOrEqual(cal(s, range));
    }
  });

  it("the worked example: cal_story(0.50) = 0.727 on the provisional-to-example scale", () => {
    // SPEC §3.8: lo 0.18, hi 0.62 → (0.50 − 0.18)/0.44 = 0.727…
    expect(cal(0.5, range)).toBeCloseTo(0.7272727, 5);
  });

  it("the committed provisional constants are the §3.5 defaults", () => {
    expect(CALIBRATION.id).toBe("cal-provisional");
    expect(CALIBRATION.n_items).toBe(0);
    expect(CALIBRATION.story).toEqual({ lo: 0.15, hi: 0.65 });
    expect(CALIBRATION.feeling).toEqual({ lo: 0.15, hi: 0.65 });
    expect(calStory(0.15)).toBe(0);
    expect(calStory(0.65)).toBe(1);
    expect(calFeeling(0.4)).toBeCloseTo(0.5, 12);
  });
});

describe("nearest-rank percentiles (SPEC §3.4, §3.8 example)", () => {
  it("picks s[ceil(p/100·M) − 1]: for M = 3486, P10 → index 348 and P90 → index 3137", () => {
    const m = 3486; // N = 84 in the spec's example
    const sorted = Array.from({ length: m }, (_, k) => k / m);
    expect(percentile(sorted, 10)).toBe(sorted[348]);
    expect(percentile(sorted, 90)).toBe(sorted[3137]);
  });

  it("handles the ends: P0 is the first element, P100 the last, empty is 0", () => {
    const s = [0.1, 0.2, 0.3];
    expect(percentile(s, 0)).toBe(0.1);
    expect(percentile(s, 100)).toBe(0.3);
    expect(percentile([], 10)).toBe(0);
  });
});

describe("pair indexes (SPEC §3.3)", () => {
  it("exhaustive below the threshold: M = N(N−1)/2 unique pairs, never i = j", () => {
    const pairs = pairIndexes(84, CALIBRATION_SEED);
    expect(pairs.length).toBe((84 * 83) / 2);
    const seen = new Set(pairs.map(([i, j]) => `${i}:${j}`));
    expect(seen.size).toBe(pairs.length);
    expect(pairs.every(([i, j]) => i < j)).toBe(true);
  });

  it("switches to a seeded sample above N = 1500 and draws SAMPLE_PAIRS of them", () => {
    const pairs = pairIndexes(EXHAUSTIVE_MAX_N + 1, CALIBRATION_SEED);
    expect(pairs.length).toBe(SAMPLE_PAIRS);
    const seen = new Set(pairs.map(([i, j]) => `${i}:${j}`));
    expect(seen.size).toBe(pairs.length);
    expect(pairs.every(([i, j]) => i < j && i < EXHAUSTIVE_MAX_N + 1)).toBe(true);
  });
});

describe("xorshift32", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const a = xorshift32(20260915);
    const b = xorshift32(20260915);
    const c = xorshift32(20260916);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    const seqC = Array.from({ length: 8 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("calibrate guards (SPEC §3.4, test matrix #6)", () => {
  const simByIndex = (n: number) => (a: number, b: number) => ((a * 31 + b * 17) % n) / n;

  it("N = 59 → error, before any similarity is computed", () => {
    const items = Array.from({ length: MIN_POPULATION - 1 }, (_, i) => i);
    const r = calibrate({ items, sim: { story: simByIndex(59), feeling: simByIndex(59) } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("population");
  });

  it("a span under 0.05 for either family → error", () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    const flat = () => 0.5; // every pair identical → span 0
    const r = calibrate({ items, sim: { story: flat, feeling: flat } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("span");
  });

  it("N = 60 → exhaustive, 1,770 pairs, both families above the span guard", () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    const r = calibrate({ items, sim: { story: simByIndex(60), feeling: simByIndex(60) } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.method).toBe("exhaustive");
      expect(r.n_items).toBe(60);
      expect(r.n_pairs).toBe(1770);
      expect(r.story.hi - r.story.lo).toBeGreaterThanOrEqual(0.05);
      expect(r.feeling.hi - r.feeling.lo).toBeGreaterThanOrEqual(0.05);
    }
  });

  it("N = 1501 → sampled, 1,000,000 pairs, and the same seed reproduces identical constants twice", () => {
    const items = Array.from({ length: EXHAUSTIVE_MAX_N + 1 }, (_, i) => i);
    const once = calibrate({ items, sim: { story: simByIndex(1501), feeling: simByIndex(1501) }, seed: CALIBRATION_SEED });
    const twice = calibrate({ items, sim: { story: simByIndex(1501), feeling: simByIndex(1501) }, seed: CALIBRATION_SEED });
    expect(once.ok && twice.ok).toBe(true);
    if (once.ok && twice.ok) {
      expect(once.method).toBe("sampled");
      expect(once.n_pairs).toBe(SAMPLE_PAIRS);
      expect(once.story).toEqual(twice.story);
      expect(once.feeling).toEqual(twice.feeling);
    }
  }, 60_000);
});
