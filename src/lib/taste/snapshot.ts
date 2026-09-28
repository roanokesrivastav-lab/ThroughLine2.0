// The impression snapshot (SPEC-STAGE3 §9): every stored number reconstructs the
// displayed total, and every sentence is rebuildable from stored fields alone.
// §9.3 lists what may never be stored — no raw notes beyond the verbatim quote or
// valued phrase, no full profiles or centroids, no private scores, no popularity.
import type { Category, EntryWithContext } from "@/lib/types";
import { usableProfile, type UserProfile } from "./profile";
import type { ScoredCandidate } from "./score";
import { anchorBlock, explanationFromSnapshot, explainFields } from "./explain";
import { CALIBRATION, type CalibrationRange } from "./calibration";
import { COMPONENTS, FEATURE_VERSION, RECENCY_DAYS, LOVED, BAND, CREATOR_CAP, type Component } from "./weights";
import { VOCABULARY_VERSION } from "./vocabulary";

export type RouteV3 = "story" | "feeling" | "form" | "creator" | "phase" | "backlog";

export type RerankInfo = { band: "familiar" | "adjacent" | "stretch"; closeness: number; pass: 1 | 2 | 3; bridge_repair: boolean };

export type Filters = { listOnly: boolean; surprise: boolean };

export type ImpressionSnapshot = {
  position: number;
  key: string;
  item: { id: string; title: string; category: Category; creator: string | null; profile_version: string };
  entryId: string | null;
  sources: ScoredCandidate["candidate"]["sources"];
  creatorKey: string | null;
  features: Record<Component, number>;
  raw: ScoredCandidate["raw"];
  has_evidence: Record<Component, boolean>;
  weights: Record<Component, number>;
  contributions: Record<Component, number>;
  score: number;
  route: RouteV3;
  anchor: { entryId: string; itemId: string; title: string; category: Category; affinity: number; ownWords: boolean; family: "story" | "feeling" } | null;
  shared: Array<{ key: string; weight: number }>;
  explain: { summary: string | null; quote: string | null; valued: string | null; creator: string | null; phase_label: string | null; fits: string | null };
  indicators: { is_cross_media: 0 | 1; is_backlog: 0 | 1; band_adjacent: 0 | 1; band_stretch: 0 | 1; own_words: 0 | 1 };
  rerank: RerankInfo;
  versions: { feature_version: string; profile_version: string; vocabulary_version: string; calibration_id: string };
  explanation: string;
};

export type SessionContext = {
  filters: Filters;
  weights_source: "w0" | "learned";
  learned: { n: number; trained_at: string } | null;
  versions: ImpressionSnapshot["versions"];
  calibration: { story: CalibrationRange; feeling: CalibrationRange };
  thresholds: { loved: number; band_familiar: number; band_adjacent: number; creator_cap: number; category_cap: number; theme_cap: number; recency_days: number };
  profile: {
    story: { top: Array<[string, number]>; n_loved: number } | null;
    feeling: { top: Array<[string, number]>; n_loved: number } | null;
    anchors: Array<{ entryId: string; affinity: number }>;
    form: Partial<Record<Category, { dist: [number, number, number, number]; n: number }>>;
    creators: Array<{ key: string; weight: number }>;
    active_phase: UserProfile["activePhase"];
    anti: { story_top: Array<[string, number]>; feeling_top: Array<[string, number]>; evidence: number };
  };
  /** Pools and policy are Session 6/7's to fill; tests may pass fixtures (§9.2). */
  pools: Record<string, unknown> | null;
  policy: { quotas: Record<string, unknown> | null; quota_unfilled: string[]; recency_relaxed: boolean; caps_relaxed: string[]; surprise: boolean };
};

/** The item-side profile version, or the current PROFILE_VERSION when there is none. */
function itemProfileVersion(item: ScoredCandidate["candidate"]["item"]): string {
  return usableProfile(item)?.profile_version ?? "none";
}

const topKeys = (v: Record<string, number>, n: number): Array<[string, number]> =>
  Object.entries(v)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);

/**
 * buildSnapshot (§9.1): every field, in the spec's key order. The explanation is
 * built last from the finished snapshot-minus-explanation, so the reconstruction
 * test (§C37) is honest.
 */
export function buildSnapshot(args: {
  position: number;
  scored: ScoredCandidate;
  library: EntryWithContext[];
  filters: Filters;
  fits: string | null;
  rerank: RerankInfo;
  route: RouteV3;
  anchor: ScoredCandidate["anchors"]["story"];
  shared: Array<{ key: string; weight: number }>;
  anchorEntry: EntryWithContext | null;
  /** The active phase's label on the phase route (§8.5, §9.1); the caller owns it, nothing is invented here. */
  phaseLabel?: string | null;
}): ImpressionSnapshot {
  const { position, scored: s, library, fits, rerank, route, anchor, shared, anchorEntry, phaseLabel } = args;
  const item = s.candidate.item;

  const explain = explainFields({ route, anchor, anchorEntry, item });
  explain.fits = fits;
  // The phase label is the caller's to pass (the profile's activePhase carries the user's
  // own label); on the phase route it must never be an empty placeholder.
  explain.phase_label = route === "phase" ? phaseLabel ?? "" : null;

  const base: ImpressionSnapshot = {
    position,
    key: s.candidate.key,
    item: {
      id: item.id,
      title: item.title,
      category: item.category,
      creator: item.creators[0]?.name ?? null,
      profile_version: itemProfileVersion(item),
    },
    entryId: s.candidate.entryId,
    sources: [...s.candidate.sources],
    creatorKey: s.candidate.creatorKey,
    features: { ...s.features },
    raw: JSON.parse(JSON.stringify(s.raw)) as ScoredCandidate["raw"],
    has_evidence: { ...s.has_evidence },
    weights: { ...s.weights },
    contributions: { ...s.contributions },
    score: s.score,
    route,
    anchor: anchorBlock(anchor, library),
    shared: shared.map((x) => ({ key: x.key, weight: x.weight })),
    explain,
    indicators: {
      is_cross_media: base_cross(s, anchor),
      is_backlog: s.candidate.entryId ? 1 : 0,
      band_adjacent: rerank.band === "adjacent" ? 1 : 0,
      band_stretch: rerank.band === "stretch" ? 1 : 0,
      own_words: base_ownWords(anchor),
    },
    rerank,
    versions: {
      feature_version: FEATURE_VERSION,
      profile_version: itemProfileVersion(item),
      vocabulary_version: VOCABULARY_VERSION,
      calibration_id: CALIBRATION.id,
    },
    explanation: "",
  };
  base.explanation = explanationFromSnapshot(base);
  return base;
}

const base_cross = (s: ScoredCandidate, anchor: ScoredCandidate["anchors"]["story"]): 0 | 1 =>
  anchor && anchor.anchor.category !== s.candidate.item.category ? 1 : 0;

const base_ownWords = (anchor: ScoredCandidate["anchors"]["story"]): 0 | 1 =>
  anchor && anchor.anchor.ownWords ? 1 : 0;

/** buildContext (§9.2): the session-level record stored next to the results. */
export function buildContext(args: {
  filters: Filters;
  profile: UserProfile;
  /** The list length the caps are computed from (§7.3). Default 6 keeps the Session 5 shape (ceil(6/2) = 3). */
  limit?: number;
  versions?: ImpressionSnapshot["versions"];
  pools?: SessionContext["pools"];
  policy?: Partial<SessionContext["policy"]>;
}): SessionContext {
  const { filters, profile: P } = args;
  const cap = Math.ceil((args.limit ?? 6) / 2);
  const versions = args.versions ?? {
    feature_version: FEATURE_VERSION,
    profile_version: "n/a",
    vocabulary_version: VOCABULARY_VERSION,
    calibration_id: CALIBRATION.id,
  };
  const familySummary = (f: "story" | "feeling") => {
    const fp = P[f];
    if (!fp) return null;
    // n_loved is every loved entry with a family vector (§9.2); the anchors array caps at
    // MAX_ANCHORS and would understate it (review round).
    return { top: topKeys(fp.centroid, 20), n_loved: fp.n_loved };
  };
  return {
    filters,
    weights_source: "w0",
    learned: null,
    versions,
    calibration: { story: CALIBRATION.story, feeling: CALIBRATION.feeling },
    thresholds: {
      loved: LOVED,
      band_familiar: BAND.familiar,
      band_adjacent: BAND.adjacent,
      creator_cap: CREATOR_CAP,
      category_cap: cap,
      theme_cap: cap,
      recency_days: RECENCY_DAYS,
    },
    profile: {
      story: familySummary("story"),
      feeling: familySummary("feeling"),
      anchors: (P.story?.anchors ?? []).slice(0, 40).map((a) => ({ entryId: a.entryId, affinity: a.affinity })),
      form: JSON.parse(JSON.stringify(P.form)) as SessionContext["profile"]["form"],
      creators: [...P.creators.values()].filter((c) => c.weight >= 0.4).map((c) => ({ key: c.key, weight: c.weight })),
      active_phase: P.activePhase,
      anti: {
        story_top: P.anti.story ? topKeys(P.anti.story, 10) : [],
        feeling_top: P.anti.feeling ? topKeys(P.anti.feeling, 10) : [],
        evidence: P.anti.evidence,
      },
    },
    pools: args.pools ?? null,
    policy: { quotas: null, quota_unfilled: [], recency_relaxed: false, caps_relaxed: [], surprise: filters.surprise, ...args.policy },
  };
}

/** The displayed total MUST equal Σ contributions (§2.8). */
export function snapshotTotal(s: Pick<ImpressionSnapshot, "contributions">): number {
  return COMPONENTS.reduce((n, k) => n + s.contributions[k], 0);
}

/** A snapshot trains the ranker only at the current feature version and never from surprise sessions (§12.2, §12.8). */
export function trainingEligible(s: Pick<ImpressionSnapshot, "versions">, ctx: Pick<SessionContext, "policy">): boolean {
  return s.versions.feature_version === FEATURE_VERSION && !ctx.policy.surprise;
}
