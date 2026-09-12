import type { AttributeVector, Category, Dimensions, Extraction } from "@/lib/types";
import { extractionToVector } from "@/lib/taste/vector";
import { VOCABULARY_VERSION, describeKey } from "@/lib/taste/vocabulary";
import { DIMENSION_TAGS, LEXICON } from "./lexicon";

export type ExtractionInput = {
  note: string | null;
  dimensions: Dimensions;
  category: Category;
  title: string;
  subtitle?: string | null;
};

export type ExtractionResult = { extraction: Extraction; vector: AttributeVector; extractor: "mock" | "claude"; vocabulary_version: string };

export interface Extractor {
  readonly name: "mock" | "claude";
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

const weighted = (pairs: Array<[string, number]>) => pairs;

export function mockExtract(input: ExtractionInput): ExtractionResult {
  const text = (input.note ?? "").trim();
  const acc: Record<string, number[]> = {};
  const push = (k: string, w: number) => { (acc[k] ??= []).push(w); };

  for (const rule of LEXICON) if (text && rule.match.test(text)) for (const [k, w] of rule.tags) push(k, w);
  for (const [dim, on] of Object.entries(input.dimensions ?? {})) if (on && DIMENSION_TAGS[dim]) for (const [k, w] of weighted(DIMENSION_TAGS[dim])) push(k, w * 0.9);

  // Combine: noisy-or so repeated evidence strengthens but never exceeds 1.
  const vec: AttributeVector = {};
  for (const [k, ws] of Object.entries(acc)) vec[k] = 1 - ws.reduce((p, w) => p * (1 - w), 1);
  // Scalars: average rather than noisy-or, with sensible defaults.
  const avg = (k: string, d: number) => (acc[k] ? acc[k].reduce((a, b) => a + b, 0) / acc[k].length : d);
  const intensity = avg("intensity", 0.5), ache = avg("ache", 0.3), pace = avg("pace", 0.5);

  const group = (g: string) => Object.entries(vec).filter(([k]) => k.startsWith(g + ".")).map(([k, w]) => ({ key: k.slice(g.length + 1), weight: Math.round(w * 100) / 100 })).sort((a, b) => b.weight - a.weight).slice(0, 4);
  const extraction: Extraction = {
    tones: group("tone"), registers: group("register"), textures: group("texture"), aftertastes: group("aftertaste"), themes: group("theme"),
    intensity, ache, pace,
    summary: mockSummary(vec, intensity, ache, pace),
    quote: mockQuote(text),
  };
  return { extraction, vector: extractionToVector(extraction), extractor: "mock", vocabulary_version: VOCABULARY_VERSION };
}

function mockSummary(vec: AttributeVector, intensity: number, ache: number, pace: number): string {
  const top = Object.entries(vec).filter(([k]) => !["intensity", "ache", "pace"].includes(k)).sort((a, b) => b[1] - a[1]);
  const tone = top.find(([k]) => k.startsWith("tone.") || k.startsWith("register.") || k.startsWith("texture."));
  const adj = tone ? tone[0].split(".")[1] : pace < 0.35 ? "slow-burning" : intensity > 0.7 ? "fierce" : "quiet";
  const after = top.find(([k]) => k.startsWith("aftertaste."));
  if (after) return `${adj} ${describeKey(after[0]).replace(/^an? /, "").replace(" aftertaste", "")}`;
  if (ache > 0.6) return `${adj} ache`;
  const theme = top.find(([k]) => k.startsWith("theme."));
  if (theme) return `${adj} sense of ${describeKey(theme[0])}`;
  return `${adj} feeling`;
}

export function mockQuote(text: string): string | null {
  if (!text) return null;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  let best: string | null = null, bestScore = -1;
  for (const s of sentences) {
    if (s.length > 160) continue;
    // Emotional words (tone, aftertaste, scalars) count more than subject words (themes);
    // density matters so a short, charged sentence beats a long descriptive one.
    let score = 0;
    for (const rule of LEXICON) if (rule.match.test(s)) score += rule.tags.some(([k]) => !k.startsWith("theme.")) ? 1.5 : 0.7;
    const words = Math.max(1, s.split(/\s+/).length);
    const density = score / Math.sqrt(words);
    if (density > bestScore) { best = s; bestScore = density; }
  }
  if (!best) best = sentences[0] ?? null;
  if (!best) return null;
  return best.length > 140 ? best.slice(0, 137).trimEnd() + "…" : best;
}

export const mockExtractor: Extractor = { name: "mock", extract: async (i) => mockExtract(i) };

