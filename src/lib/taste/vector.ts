import type { AttributeVector, Extraction, WeightedTag } from "@/lib/types";
import { G_FEELING, G_STORY, SCALARS, type FeelingGroup, GROUP_WEIGHTS, type Group, isKnownKey, type StoryGroup } from "./vocabulary";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function groupOf(key: string): Group | "scalar" {
  if ((SCALARS as readonly string[]).includes(key)) return "scalar";
  return key.split(".")[0] as Group;
}

/** Flatten a structured extraction into the scoring space. */
export function extractionToVector(x: Extraction): AttributeVector {
  const v: AttributeVector = {};
  const put = (group: string, tags: WeightedTag[]) => {
    for (const t of tags ?? []) {
      const key = `${group}.${t.key}`;
      if (isKnownKey(key)) v[key] = clamp01(t.weight);
    }
  };
  put("tone", x.tones);
  put("register", x.registers);
  put("texture", x.textures);
  put("aftertaste", x.aftertastes);
  put("theme", x.themes);
  v.intensity = clamp01(x.intensity);
  v.ache = clamp01(x.ache);
  v.pace = clamp01(x.pace);
  return v;
}

/**
 * Weighted mean of several vectors. Missing keys count as zero, so a tag that only one
 * vector carries is diluted rather than promoted — prevalence matters for centroids.
 */
export function blend(parts: Array<{ v: AttributeVector; w: number }>): AttributeVector {
  const out: AttributeVector = {};
  let total = 0;
  for (const { v, w } of parts) {
    if (w <= 0) continue;
    total += w;
    for (const [k, val] of Object.entries(v)) out[k] = (out[k] ?? 0) + val * w;
  }
  if (!total) return out;
  for (const k of Object.keys(out)) out[k] = out[k] / total;
  // Scalars are only meaningful where present: average them over the vectors that define them.
  for (const s of SCALARS) {
    const defined = parts.filter((p) => p.w > 0 && p.v[s] !== undefined);
    if (defined.length) out[s] = defined.reduce((a, p) => a + p.v[s] * p.w, 0) / defined.reduce((a, p) => a + p.w, 0);
    else delete out[s];
  }
  return out;
}

export function scale(v: AttributeVector, f: number): AttributeVector {
  const out: AttributeVector = {};
  for (const [k, val] of Object.entries(v)) out[k] = groupOf(k) === "scalar" ? val : clamp01(val * f);
  return out;
}

export function isEmpty(v: AttributeVector | null | undefined): boolean {
  if (!v) return true;
  return Object.keys(v).filter((k) => groupOf(k) !== "scalar").length === 0;
}

export type SimilarityResult = {
  score: number;               // 0..1
  shared: WeightedTag[];       // the keys that carried the match, strongest first
  byGroup: Record<string, number>;
};

/**
 * Deterministic similarity between two attribute vectors.
 * Tag groups use a weighted cosine; scalars use closeness. Everything is debuggable via `shared`.
 */
export function similarity(a: AttributeVector, b: AttributeVector): SimilarityResult {
  const byGroup: Record<string, number> = {};
  const contributions: WeightedTag[] = [];
  let total = 0;
  let totalWeight = 0;

  for (const group of ["theme", "aftertaste", "tone", "register", "texture"] as Group[]) {
    const keysA = Object.keys(a).filter((k) => k.startsWith(group + "."));
    const keysB = Object.keys(b).filter((k) => k.startsWith(group + "."));
    if (keysA.length === 0 || keysB.length === 0) continue;
    let dot = 0, na = 0, nb = 0;
    for (const k of keysA) na += a[k] * a[k];
    for (const k of keysB) nb += b[k] * b[k];
    for (const k of keysA) if (b[k] !== undefined) {
      const c = a[k] * b[k];
      dot += c;
      contributions.push({ key: k, weight: c * GROUP_WEIGHTS[group] });
    }
    const cos = dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
    byGroup[group] = cos;
    total += cos * GROUP_WEIGHTS[group];
    totalWeight += GROUP_WEIGHTS[group];
  }

  let scalarSum = 0, scalarN = 0;
  for (const s of SCALARS) {
    if (a[s] === undefined || b[s] === undefined) continue;
    const close = 1 - Math.abs(a[s] - b[s]);
    scalarSum += close;
    scalarN++;
    if (close > 0.8) contributions.push({ key: s, weight: close * 0.15 });
  }
  if (scalarN) {
    const sc = scalarSum / scalarN;
    byGroup.scalar = sc;
    total += sc * GROUP_WEIGHTS.scalar;
    totalWeight += GROUP_WEIGHTS.scalar;
  }

  const score = totalWeight ? clamp01(total / totalWeight) : 0;
  contributions.sort((x, y) => y.weight - x.weight);
  return { score, shared: contributions.slice(0, 6), byGroup };
}

// ---------------------------------------------------------------------------
// Family-restricted similarity (SPEC-STAGE3 §2.1). Additive: the legacy whole-vector
// similarity above stays until the Stage 3 engine replaces it (DECISIONS #60).
// ---------------------------------------------------------------------------

export type Family = "story" | "feeling";
export type FamilyWeights = Record<StoryGroup | "scalar", number> | Record<FeelingGroup | "scalar", number>;

/**
 * sim_F(u, v), exactly as written in §2.1: per-group weighted cosines over the groups
 * present on BOTH sides (a group empty on either side is skipped and its weight excluded
 * from the divisor), scalar closeness averaged over the scalars both sides define, all
 * normalised by the weight actually used, clamped to [0, 1]. Keys of the other family are
 * ignored; a group with weight 0 (ending) is never read because the loop runs over G_F.
 */
export function simFamily(family: Family, u: AttributeVector, v: AttributeVector): number {
  const G = (family === "story" ? G_STORY : G_FEELING) as Record<string, number>;
  let total = 0;
  let weight = 0;

  for (const [g, gw] of Object.entries(G)) {
    if (gw <= 0 || g === "scalar") continue;
    const U = Object.keys(u).filter((k) => k.startsWith(g + "."));
    const V = Object.keys(v).filter((k) => k.startsWith(g + "."));
    if (U.length === 0 || V.length === 0) continue; // group skipped: missing on one side
    let dot = 0;
    let nu = 0;
    let nv = 0;
    for (const k of U) nu += u[k] * u[k];
    for (const k of V) nv += v[k] * v[k];
    for (const k of U) if (v[k] !== undefined) dot += u[k] * v[k];
    const cos = nu === 0 || nv === 0 ? 0 : dot / (Math.sqrt(nu) * Math.sqrt(nv));
    total += gw * cos;
    weight += gw;
  }

  const scalars = family === "story" ? ["moral-complexity", "complexity"] : ["intensity", "ache", "pace"];
  const defined = scalars.filter((s) => u[s] !== undefined && v[s] !== undefined);
  if (defined.length) {
    const close = defined.reduce((acc, s) => acc + (1 - Math.abs(u[s] - v[s])), 0) / defined.length;
    total += G.scalar * close;
    weight += G.scalar;
  }

  return weight > 0 ? clamp01(total / weight) : 0;
}

/**
 * shared_F(u, v): { key, weight } pairs for explanation (§2.1). Word keys present on both
 * sides contribute u[k]·v[k]·G_F[group]; scalars closer than 0.8 contribute
 * (1 − |u[s] − v[s]|)·0.15. Sorted by weight descending, then key ascending. Not a score.
 */
export function sharedFamily(family: Family, u: AttributeVector, v: AttributeVector): WeightedTag[] {
  const G = (family === "story" ? G_STORY : G_FEELING) as Record<string, number>;
  const out: WeightedTag[] = [];
  for (const k of Object.keys(u)) {
    if (v[k] === undefined) continue;
    const g = k.includes(".") ? (k.split(".")[0] as StoryGroup | FeelingGroup) : null;
    const gw = g ? G[g] : undefined;
    if (!g || gw === undefined || gw <= 0) continue;
    out.push({ key: k, weight: u[k] * v[k] * gw });
  }
  const scalars = family === "story" ? ["moral-complexity", "complexity"] : ["intensity", "ache", "pace"];
  for (const s of scalars) {
    if (u[s] === undefined || v[s] === undefined) continue;
    const close = 1 - Math.abs(u[s] - v[s]);
    if (close > 0.8) out.push({ key: s, weight: close * 0.15 });
  }
  return out.sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
}

/**
 * A vector with any negative value is invalid input, not a smaller opinion (SPEC §1.3:
 * NEGATIVE VALUES ARE INVALID). Readers of stored vectors call this before trusting them.
 */
export function assertNonNegative(v: AttributeVector, where = "vector"): void {
  for (const [k, n] of Object.entries(v)) {
    if (typeof n === "number" && n < 0) throw new Error(`${where}: negative value for ${k} (${n})`);
  }
}

/** Top-N strongest tags of a vector (non-scalar), strongest first. */
export function topTags(v: AttributeVector, n = 4, minWeight = 0.35): WeightedTag[] {
  return Object.entries(v)
    .filter(([k, w]) => groupOf(k) !== "scalar" && w >= minWeight)
    .map(([key, weight]) => ({ key, weight }))
    .sort((x, y) => y.weight - x.weight)
    .slice(0, n);
}

export function centroid(vectors: AttributeVector[]): AttributeVector {
  return blend(vectors.map((v) => ({ v, w: 1 })));
}
