// Every Stage 3 constant in one place (SPEC-STAGE3 §A), under one version.
// FEATURE_VERSION changes whenever anything here can change x for the same inputs:
// the component set, the formulas, the group weights, W0, the calibration constants,
// the band thresholds, the affinity formula (§1.9). Snapshots and learned weights
// carry this string; rows with an older value are never trained on (§12.8).
//
// The learned per-user vector (§12) has this same shape and is consulted only when it
// exists for the current feature_version. Stage 3 always uses W0.

export const FEATURE_VERSION = "f1";

/** Fixed component order = feature order for the learner (§2.8, §12.1). */
export const COMPONENTS = ["story", "feeling", "form", "creator", "phase", "anti"] as const;
export type Component = (typeof COMPONENTS)[number];

/** Hand-tuned weights (§2.8). S(x) = Σ W0[k]·v_k(x) ∈ [−0.15, 0.95]. No denominator. */
export const W0: Readonly<Record<Component, number>> = {
  story: 0.4,
  feeling: 0.2,
  form: 0.15,
  creator: 0.1,
  phase: 0.1,
  anti: -0.15,
};
export { W0 as WEIGHTS };

/** aff(e) at or above this counts as loved (§4.1). */
export const LOVED = 0.55;

/** Anchors kept per family (§4.3). */
export const MAX_ANCHORS = 40;

/** Re-rank band thresholds on the calibrated closeness scale (§7.1). Provisional (§E Q2). */
export const BAND = { familiar: 0.6, adjacent: 0.35 } as const;

/**
 * Quota table (§7.2): familiar / adjacent / stretch per list length L. L ≥ 6 is computed:
 * L − adjacent − stretch familiar, round(0.2·L) adjacent, max(1, round(0.1·L)) stretch.
 */
export const QUOTAS: Record<number, { familiar: number; adjacent: number; stretch: number }> = {
  1: { familiar: 1, adjacent: 0, stretch: 0 },
  2: { familiar: 1, adjacent: 0, stretch: 1 },
  3: { familiar: 2, adjacent: 0, stretch: 1 },
  4: { familiar: 2, adjacent: 1, stretch: 1 },
  5: { familiar: 3, adjacent: 1, stretch: 1 },
};

/** Re-rank caps (§7.3). Category and theme caps are ceil(L/2), computed at the list length. */
export const CREATOR_CAP = 2;

/** A key in query_sessions results within this many days is "recently shown" (§6 step 9). Founder ruling: 14, not the spec default of 7 (DECISIONS #59). */
export const RECENCY_DAYS = 14;

/** A phase is active while !dismissed, one of the three matching kinds, and end_at ≥ today − this (§4.7). */
export const PHASE_ACTIVE_DAYS = 90;

/** Anti-profile evidence needed per family before it becomes non-null (§4.6). */
export const ANTI_MIN_EVIDENCE = 2;

/** The candidate pool: the most recently profiled items considered by neighbour and phase sources (§5). */
export const POOL_SIZE = 500;

/** Neighbour and phase source sizes (§5). */
export const NEIGHBOUR_TOP = 30;
export const PHASE_TOP = 20;
/** Creator expansion: top creators × results each (§5). */
export const CREATOR_TOP = 3;
export const CREATOR_RESULTS_EACH = 5;

/** Loved-creator weight at or above which creator expansion runs (§5). */
export const CREATOR_EXPAND_MIN_WEIGHT = 0.4;
