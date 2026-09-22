import type { AttributeVector, Category, Dimensions, Reading, ReadingVector, WeightedTag } from "@/lib/types";
import { readingToVector } from "@/lib/taste/vector";
import { VOCABULARY_VERSION, describeKey, familyOf } from "@/lib/taste/vocabulary";
import { DISLIKE_LEXICON, DISLIKE_MARKER, LEXICON, VALUED_MARKER, type Rule } from "./lexicon";
import { emptyReading, finalizeReading } from "./reading";

export type ExtractionInput = {
  note: string | null;
  dimensions: Dimensions;
  category: Category;
  title: string;
  subtitle?: string | null;
};

export type ExtractionResult = {
  extraction: Reading;
  vector: ReadingVector;
  extractor: "mock" | "claude" | "nvidia";
  vocabulary_version: string;
};

export interface Extractor {
  readonly name: "mock" | "claude" | "nvidia";
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

const NEGATORS = new Set(["no", "not", "never", "isn't", "wasn't", "without", "lacks", "lacking"]);

function matches(rule: Rule, text: string): Array<{ index: number; value: string }> {
  const regex = new RegExp(rule.match.source, rule.match.flags.includes("g") ? rule.match.flags : `${rule.match.flags}g`);
  return [...text.matchAll(regex)].map((match) => ({ index: match.index ?? 0, value: match[0] }));
}

function isNegated(text: string, index: number): boolean {
  const tokens = text.slice(0, index).match(/[a-z0-9]+(?:['’][a-z]+)?/gi) ?? [];
  return tokens.slice(-3).some((token) => NEGATORS.has(token.toLowerCase().replace("’", "'")));
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean);

const CAPS: Record<string, number> = {
  theme: 4, arc: 2, conflict: 2, cast: 3, bond: 2, world: 2, setting: 3, frame: 3,
  structure: 2, momentum: 3, stakes: 1, ending: 1,
  tone: 4, register: 3, texture: 3, aftertaste: 3,
};

const groupTags = (vector: AttributeVector, group: string): WeightedTag[] =>
  Object.entries(vector)
    .filter(([key]) => key.startsWith(`${group}.`))
    .map(([key, weight]) => ({ key: key.slice(group.length + 1), weight: Math.round(weight * 100) / 100 }))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, CAPS[group] ?? 0);

function mockSummary(vector: AttributeVector, quote: string | null): string {
  const words = Object.entries(vector)
    .filter(([key]) => key.includes("."))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([key]) => describeKey(key));
  if (words.length) return words.join(" and ").slice(0, 60);
  return (quote ?? "").slice(0, 60);
}

export function mockExtract(input: ExtractionInput): ExtractionResult {
  const text = (input.note ?? "").trim();
  if (!text) {
    const extraction = emptyReading();
    return { extraction, vector: readingToVector(extraction), extractor: "mock", vocabulary_version: VOCABULARY_VERSION };
  }

  const acc: Record<string, number[]> = {};
  const absent = new Set<string>();
  const push = (key: string, weight: number) => { (acc[key] ??= []).push(weight); };

  for (const rule of LEXICON) {
    for (const match of matches(rule, text)) {
      for (const [key, weight] of rule.tags) {
        if (familyOf(key) === null) continue;
        if (isNegated(text, match.index)) absent.add(key);
        else push(key, weight);
      }
    }
  }

  const vector: AttributeVector = {};
  for (const [key, weights] of Object.entries(acc)) {
    if (["intensity", "ache", "pace", "moral-complexity", "complexity"].includes(key)) {
      vector[key] = weights.reduce((sum, weight) => sum + weight, 0) / weights.length;
    } else {
      vector[key] = 1 - weights.reduce((product, weight) => product * (1 - weight), 1);
    }
  }

  const dislikedKeys = new Map<string, number>();
  const dislikedPhrases: string[] = [];
  const valued: string[] = [];
  for (const sentence of sentences(text)) {
    if (DISLIKE_MARKER.test(sentence)) {
      if (sentence.length <= 160 && !dislikedPhrases.includes(sentence)) dislikedPhrases.push(sentence);
      for (const rule of DISLIKE_LEXICON) {
        if (!rule.match.test(sentence)) continue;
        for (const [key, weight] of rule.tags) {
          if (familyOf(key) !== null) dislikedKeys.set(key, Math.max(dislikedKeys.get(key) ?? 0, weight));
        }
      }
    }
    if (VALUED_MARKER.test(sentence) && sentence.length <= 160 && !valued.includes(sentence)) valued.push(sentence);
  }

  const quote = mockQuote(text);
  const draft: Reading = {
    story: {
      theme: groupTags(vector, "theme"), arc: groupTags(vector, "arc"), conflict: groupTags(vector, "conflict"),
      cast: groupTags(vector, "cast"), bond: groupTags(vector, "bond"), world: groupTags(vector, "world"),
      setting: groupTags(vector, "setting"), frame: groupTags(vector, "frame"), structure: groupTags(vector, "structure"),
      momentum: groupTags(vector, "momentum"), stakes: groupTags(vector, "stakes"), ending: groupTags(vector, "ending"),
    },
    feeling: {
      tone: groupTags(vector, "tone"), register: groupTags(vector, "register"),
      texture: groupTags(vector, "texture"), aftertaste: groupTags(vector, "aftertaste"),
    },
    scalars: Object.fromEntries(
      ["intensity", "ache", "pace", "moral-complexity", "complexity"]
        .filter((key) => vector[key] !== undefined)
        .map((key) => [key, vector[key]]),
    ),
    absent: [...absent].slice(0, 6),
    didnt_work: {
      keys: [...dislikedKeys].map(([key, weight]) => ({ key, weight })).sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key)).slice(0, 4),
      phrases: dislikedPhrases.slice(0, 3),
    },
    valued: valued.slice(0, 3),
    summary: mockSummary(vector, quote),
    quote,
  };
  const extraction = finalizeReading(draft, text, quote);
  return { extraction, vector: readingToVector(extraction), extractor: "mock", vocabulary_version: VOCABULARY_VERSION };
}

export function mockQuote(text: string): string | null {
  if (!text) return null;
  const parts = sentences(text);
  let best: string | null = null;
  let bestScore = -1;
  for (const sentence of parts) {
    if (sentence.length > 160) continue;
    let score = 0;
    for (const rule of LEXICON) if (rule.match.test(sentence)) score += rule.tags.some(([key]) => !key.startsWith("theme.")) ? 1.5 : 0.7;
    const density = score / Math.sqrt(Math.max(1, sentence.split(/\s+/).length));
    if (density > bestScore) { best = sentence; bestScore = density; }
  }
  if (!best) best = parts[0] ?? null;
  return best;
}

export const mockExtractor: Extractor = { name: "mock", extract: async (input) => mockExtract(input) };
