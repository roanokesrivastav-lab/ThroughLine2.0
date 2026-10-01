// The Stage 3 scorer, one candidate at a time (SPEC-STAGE3 §2). Pure: no database,
// no network, no clock. The legacy scorer that used to live in recommend.ts was
// deleted in the Session 7B switch-over (DECISIONS #80); daySeed moved here for
// surprise ordering (§2.8), byte-identical.
import type { AttributeVector, Category, MediaItem, WeightedTag } from "@/lib/types";
import { usableProfile, type Anchor, type UserProfile } from "./profile";
import { calStory, calFeeling } from "./calibration";
import { simFamily, sharedFamily, type Family } from "./vector";
import { COMPONENTS, W0, type Component } from "./weights";
import { normaliseTags, tagFamily } from "./tag-lexicon";

export type Source = "backlog" | "canon" | "creator" | "story_neighbour" | "feeling_neighbour" | "phase";
export const SOURCE_ORDER: readonly Source[] = ["backlog", "canon", "creator", "story_neighbour", "feeling_neighbour", "phase"];

/** A candidate as Sessions 6–7 will produce it: item profile already loaded (§1.7). */
export type StageCandidate = {
  key: string;
  item: MediaItem;
  entryId: string | null;
  sources: Source[];
  creatorKey: string | null;
};

export type Weights = Readonly<Record<Component, number>>;

/** Which anchor won a family, with the calibrated similarity the route/explanation read (§8.2). */
export type AnchorPick = { anchor: Anchor; sim: number; family: Family };

export type ScoredCandidate = {
  candidate: StageCandidate;
  features: Record<Component, number>;
  raw: {
    story: { centroid: number; anchor: number } | null;
    feeling: { centroid: number; anchor: number } | null;
    anti: { story: number | null; feeling: number | null };
  };
  has_evidence: Record<Component, boolean>;
  weights: Weights;
  contributions: Record<Component, number>;
  score: number;
  anchors: { story: AnchorPick | null; feeling: AnchorPick | null };
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const calF = (family: Family, s: number) => (family === "story" ? calStory(s) : calFeeling(s));

type FamilyScore = { v: number; rawCentroid: number | null; rawAnchor: number; pick: AnchorPick | null };

/**
 * The story or feeling component (§2.2–§2.3): 0.5 × calibrated centroid similarity +
 * 0.5 × calibrated best-anchor similarity. The anchor attaining the max is kept, ties by
 * higher affinity then entryId ascending; an anchor over the candidate's own item is skipped.
 */
function familyScore(family: Family, P: UserProfile, x: StageCandidate): FamilyScore {
  const fp = P[family];
  const vec = usableProfile(x.item)?.vector[family] ?? null;
  const result: FamilyScore = { v: 0, rawCentroid: null, rawAnchor: 0, pick: null };
  if (!fp || !vec) return result;

  const rawCentroid = simFamily(family, vec, fp.centroid);
  let best: { anchor: Anchor; sim: number } | null = null;
  for (const a of fp.anchors) {
    if (a.itemId === x.item.id) continue; // never an anchor to itself (§2.2)
    const sim = simFamily(family, vec, a.vector);
    if (!best || sim > best.sim + 1e-12 || (Math.abs(sim - best.sim) <= 1e-12 && (a.affinity > best.anchor.affinity || (a.affinity === best.anchor.affinity && a.entryId.localeCompare(best.anchor.entryId) < 0)))) {
      best = { anchor: a, sim };
    }
  }
  const rawAnchor = best ? best.sim : 0;
  result.rawCentroid = rawCentroid;
  result.rawAnchor = rawAnchor;
  result.pick = best ? { anchor: best.anchor, sim: calF(family, rawAnchor), family } : null;
  result.v = clamp01(0.5 * calF(family, rawCentroid) + 0.5 * (best ? calF(family, rawAnchor) : 0));
  return result;
}

/** The form component (§2.4): the loved-band share around the candidate's own band. */
function formFeature(P: UserProfile, category: Category, band: number | null): number {
  if (band == null) return 0;
  const d = P.form[category];
  if (!d) return 0;
  const at = (i: number) => (i >= 0 && i <= 3 ? d.dist[i] : 0);
  return clamp01(at(band) + 0.5 * at(band - 1) + 0.5 * at(band + 1));
}

/** The phase component (§2.6): exactly the three active-phase kinds. */
function phaseFeature(P: UserProfile, x: StageCandidate): number {
  const ph = P.activePhase;
  if (!ph) return 0;
  if (ph.kind === "feeling_cluster") {
    const vec: AttributeVector = { ...(usableProfile(x.item)?.vector.story ?? {}), ...(usableProfile(x.item)?.vector.feeling ?? {}) };
    const primary = vec[ph.key] ?? 0;
    const second = ph.second ? vec[ph.second] ?? 0 : 0;
    return clamp01(primary + 0.5 * second);
  }
  if (ph.kind === "genre_run") {
    const tags = normaliseTags(x.item.genre_tags);
    if (tags.includes(ph.key)) return 1;
    // 0.6 when one of the item's tags has the run key as its tagFamily parent (§2.6:
    // "a tag's tagFamily parent equals ph.key" — the child tag is on the item, not the key).
    for (const tag of tags) {
      if (tagFamily(tag).some((t) => t.factor < 1 && t.tag === ph.key)) return 0.6;
    }
    return 0;
  }
  return x.item.category === ph.key ? 1 : 0; // category_stretch
}

/** The anti component (§2.7): mean calibrated similarity over the non-null anti families. */
function antiFeature(P: UserProfile, vec: { story: AttributeVector | null; feeling: AttributeVector | null }) {
  const parts: Array<{ family: Family; raw: number }> = [];
  const raw: { story: number | null; feeling: number | null } = { story: null, feeling: null };
  if (P.anti.story && vec.story) {
    raw.story = simFamily("story", vec.story, P.anti.story);
    parts.push({ family: "story", raw: raw.story });
  }
  if (P.anti.feeling && vec.feeling) {
    raw.feeling = simFamily("feeling", vec.feeling, P.anti.feeling);
    parts.push({ family: "feeling", raw: raw.feeling });
  }
  const v = parts.length ? parts.reduce((n, p) => n + calF(p.family, p.raw), 0) / parts.length : 0;
  return { v, raw };
}

export function scoreCandidate(P: UserProfile, x: StageCandidate, weights: Weights = W0): ScoredCandidate | null {  const profile = usableProfile(x.item);
  if (!profile) return null; // an unprofiled item never gets a partial score (§6 step 8)

  const story = familyScore("story", P, x);
  const feeling = familyScore("feeling", P, x);
  const anti = antiFeature(P, { story: profile.vector.story ?? null, feeling: profile.vector.feeling ?? null });

  const features: Record<Component, number> = {
    story: story.v,
    feeling: feeling.v,
    form: formFeature(P, x.item.category, profile.form.band),
    creator: x.creatorKey ? (P.creators.get(x.creatorKey)?.weight ?? 0) : 0,
    phase: phaseFeature(P, x),
    anti: anti.v,
  };
  const contributions = {} as Record<Component, number>;
  for (const k of COMPONENTS) contributions[k] = weights[k] * features[k];
  const score = COMPONENTS.reduce((n, k) => n + contributions[k], 0);

  const has_evidence: Record<Component, boolean> = {
    story: P.story !== null && Object.keys(profile.vector.story ?? {}).length > 0,
    feeling: P.feeling !== null && Object.keys(profile.vector.feeling ?? {}).length > 0,
    form: profile.form.band != null && P.form[x.item.category] !== undefined,
    creator: x.creatorKey !== null && P.creators.has(x.creatorKey),
    phase: P.activePhase !== null,
    anti: P.anti.story !== null || P.anti.feeling !== null,
  };

  return {
    candidate: x,
    features,
    raw: {
      story: story.rawCentroid === null ? null : { centroid: story.rawCentroid, anchor: story.rawAnchor },
      feeling: feeling.rawCentroid === null ? null : { centroid: feeling.rawCentroid, anchor: feeling.rawAnchor },
      anti: anti.raw,
    },
    has_evidence,
    weights: { ...weights },
    contributions,
    score,
    anchors: { story: story.pick, feeling: feeling.pick },
  };
}

/** Score a list, preserving input order; unprofiled candidates come back in `deferred` (§6 step 8). */
export function scoreCandidates(P: UserProfile, candidates: StageCandidate[], weights: Weights = W0): { scored: ScoredCandidate[]; deferred: StageCandidate[] } {
  const scored: ScoredCandidate[] = [];
  const deferred: StageCandidate[] = [];
  for (const c of candidates) {
    const s = scoreCandidate(P, c, weights);
    if (s) scored.push(s);
    else deferred.push(c);
  }
  return { scored, deferred };
}

/** Order by score (or the surprise blend), ties on the candidate key ascending (DECISIONS #56). */
export function orderScored(scored: ScoredCandidate[], opts: { surprise: boolean; userId: string }): ScoredCandidate[] {
  const sortKey = (s: ScoredCandidate) => (opts.surprise ? 0.5 * s.score + 0.5 * daySeed(`${opts.userId}${s.candidate.key}`) : s.score);
  return [...scored].sort((a, b) => sortKey(b) - sortKey(a) || a.candidate.key.localeCompare(b.candidate.key));
}

/** Shared attributes for one family, ending dropped (§8.3). Exported for explain.ts. */
export function sharedForFamily(family: Family, u: AttributeVector, v: AttributeVector, limit = 3): WeightedTag[] {
  return sharedFamily(family, u, v).filter((s) => !s.key.startsWith("ending.")).slice(0, limit);
}

/** Deterministic hash for "surprise me": stable within a day so refreshes do not thrash. */
export function daySeed(userSalt: string): number {
  const s = `${userSalt}:${new Date().toISOString().slice(0, 10)}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}
