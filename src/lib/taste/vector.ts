import type { AttributeVector, Extraction, WeightedTag } from "@/lib/types";
import { GROUP_WEIGHTS, SCALARS, type Group, isKnownKey } from "./vocabulary";

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
