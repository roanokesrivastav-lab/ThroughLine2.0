// Calibration of the two family similarities (SPEC-STAGE3 §3).
//
// Only the family similarities are calibrated. Form, creator and phase are already
// 0..1 shares and are not. cal_F(s) maps a raw similarity into [0, 1] linearly between
// lo_F (P10) and hi_F (P90) of the population's pair distribution, clamping outside —
// no extrapolation (§3.1).
//
// The committed constants below are provisional (§3.5) and are used until the first
// successful script run against a profiled population (scripts/calibrate.ts, §B27, not
// part of this session). A run that changes lo or hi must bump FEATURE_VERSION in the
// same commit (§3.6). Population, pair sampling and guards are specified in §3.2–§3.4;
// calibrate() here is the pure computation the script will call. The guard semantics
// (exit non-zero, leave this file unchanged) live in the script, which is why calibrate
// returns errors instead of throwing them.

/** The two families (SPEC §1.1). Declared here so calibration stands alone; vector.ts carries the same union. */
export type Family = "story" | "feeling";

/** Provisional constants until the first calibration run (§3.5). */
export const CALIBRATION = {
  id: "cal-provisional",
  n_items: 0,
  n_pairs: 0,
  story: { lo: 0.15, hi: 0.65 },
  feeling: { lo: 0.15, hi: 0.65 },
} as const;

export type CalibrationRange = { lo: number; hi: number };
export type CalibrationTable = {
  id: string;
  computed_at: string;
  n_items: number;
  n_pairs: number;
  method: "exhaustive" | "sampled";
  story: CalibrationRange;
  feeling: CalibrationRange;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** cal_F(s): linear map of s from [lo, hi] into [0, 1], clamped at both ends. */
export function cal(s: number, range: CalibrationRange): number {
  if (range.hi <= range.lo) return 0; // unreachable for a valid table; keeps the map total
  return clamp01((s - range.lo) / (range.hi - range.lo));
}

/** cal_story with the committed table. */
export function calStory(s: number): number {
  return cal(s, CALIBRATION.story);
}

/** cal_feeling with the committed table. */
export function calFeeling(s: number): number {
  return cal(s, CALIBRATION.feeling);
}

// ---------------------------------------------------------------------------
// The calibration computation itself (§3.3–§3.4, §3.8).
// ---------------------------------------------------------------------------

/** Seeded pair sample size above N = 1500 (§3.3). */
export const SAMPLE_PAIRS = 1_000_000;
/** Exhaustive up to and including N = 1500 (§3.3). */
export const EXHAUSTIVE_MAX_N = 1500;
/** The script's seed (§3.3); fixed so a sampled run is reproducible. */
export const CALIBRATION_SEED = 20260915;
/** Guards (§3.4): fewer than 60 items, or a span under 0.05 for either family. */
export const MIN_POPULATION = 60;
export const MIN_SPAN = 0.05;

/**
 * Nearest-rank percentile of an ascending-sorted array: p-th = s[ceil(p/100·M) − 1] (§3.4).
 * Caller sorts; this never re-orders.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

/**
 * The existing-project xorshift (§3.3 names "the existing xorshift generator"; none was
 * committed, so this is one, 32-bit, non-zero state). Deterministic and dependency-free:
 * scripts/calibrate.ts and any future re-run get identical pairs from the same seed.
 */
export function xorshift32(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Distinct unordered pairs of indexes; exhaustive below the sampling threshold (§3.3). */
export function pairIndexes(n: number, seed = CALIBRATION_SEED): Array<[number, number]> {
  const m = (n * (n - 1)) / 2;
  if (n <= EXHAUSTIVE_MAX_N) {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]);
    return out;
  }
  const rnd = xorshift32(seed);
  const seen = new Set<number>();
  const out: Array<[number, number]> = [];
  // Rejection-sample pairs without duplicates: pack (i, j) i<j into a single number.
  // The load factor stays tiny (1e6 of ~1.25e13), so collisions are rare and the loop
  // is bounded by the attempts cap rather than the pair space.
  let attempts = 0;
  while (out.length < Math.min(SAMPLE_PAIRS, m) && attempts < SAMPLE_PAIRS * 20) {
    attempts++;
    const i = Math.floor(rnd() * n);
    const j0 = Math.floor(rnd() * n);
    if (j0 === i) continue;
    const [a, b] = j0 < i ? [j0, i] : [i, j0];
    const packed = a * n + b;
    if (seen.has(packed)) continue;
    seen.add(packed);
    out.push([a, b]);
  }
  return out;
}

export type CalibrateInput<F> = {
  /** Population in the order the caller fixed (§3.2: by id ascending for the script). */
  items: F[];
  /** One similarity per family over two population members (§3.8). */
  sim: { story: (a: F, b: F) => number; feeling: (a: F, b: F) => number };
  seed?: number;
};

export type CalibrateResult =
  | { ok: true; method: "exhaustive" | "sampled"; n_items: number; n_pairs: number; story: CalibrationRange; feeling: CalibrationRange }
  | { ok: false; error: string };

/**
 * Compute lo/hi for one family over the population (§3.8). Guards are the caller's
 * population-level ones: this returns ok:false when either family's span is under
 * MIN_SPAN, so a run can fail loudly before anything is written.
 */
export function calibrate<F>(input: CalibrateInput<F>): CalibrateResult {
  const { items, sim, seed = CALIBRATION_SEED } = input;
  const n = items.length;
  if (n < MIN_POPULATION) return { ok: false, error: `population ${n} < ${MIN_POPULATION} (fewer than 1,770 pairs)` };
  const pairs = pairIndexes(n, seed);
  const method = n <= EXHAUSTIVE_MAX_N ? "exhaustive" : "sampled";
  const m = pairs.length;

  const ranges: Record<Family, CalibrationRange> = { story: { lo: 0, hi: 0 }, feeling: { lo: 0, hi: 0 } };
  for (const family of ["story", "feeling"] as Family[]) {
    const s = pairs.map(([i, j]) => sim[family](items[i], items[j])).sort((a, b) => a - b);
    const lo = percentile(s, 10);
    const hi = percentile(s, 90);
    if (hi - lo < MIN_SPAN) return { ok: false, error: `${family} span ${(hi - lo).toFixed(4)} < ${MIN_SPAN}` };
    ranges[family] = { lo, hi };
  }
  return { ok: true, method, n_items: n, n_pairs: m, story: ranges.story, feeling: ranges.feeling };
}
