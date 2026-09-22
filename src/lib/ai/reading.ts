import { z } from "zod";
import type { FeelingGroup, StoryGroup } from "@/lib/taste/vocabulary";
import type { Reading, WeightedTag } from "@/lib/types";
import {
  AFTERTASTES,
  ARCS,
  BONDS,
  CASTS,
  CONFLICTS,
  ENDINGS,
  FRAMES,
  MOMENTUMS,
  REGISTERS,
  SETTINGS_V2,
  STAKES,
  STRUCTURES,
  TEXTURES,
  THEMES_V2,
  TONES,
  VOCABULARY_V2_KEYS,
  WORLDS,
} from "@/lib/taste/vocabulary";

const tag = (values: readonly string[]) => z.object({
  key: z.enum(values as [string, ...string[]]),
  weight: z.number().min(0).max(1),
});
const evidenceTag = z.object({
  key: z.enum(VOCABULARY_V2_KEYS as [string, ...string[]]),
  weight: z.number().min(0).max(1),
});

/** The exact persisted vocabulary-v2 reading contract (SPEC-STAGE3 §1.3). */
export const ReadingSchema = z.object({
  story: z.object({
    theme: z.array(tag(THEMES_V2)).max(4),
    arc: z.array(tag(ARCS)).max(2),
    conflict: z.array(tag(CONFLICTS)).max(2),
    cast: z.array(tag(CASTS)).max(3),
    bond: z.array(tag(BONDS)).max(2),
    world: z.array(tag(WORLDS)).max(2),
    setting: z.array(tag(SETTINGS_V2)).max(3),
    frame: z.array(tag(FRAMES)).max(3),
    structure: z.array(tag(STRUCTURES)).max(2),
    momentum: z.array(tag(MOMENTUMS)).max(3),
    stakes: z.array(tag(STAKES)).max(1),
    ending: z.array(tag(ENDINGS)).max(1),
  }),
  feeling: z.object({
    tone: z.array(tag(TONES)).max(4),
    register: z.array(tag(REGISTERS)).max(3),
    texture: z.array(tag(TEXTURES)).max(3),
    aftertaste: z.array(tag(AFTERTASTES)).max(3),
  }),
  scalars: z.object({
    intensity: z.number().min(0).max(1).optional(),
    ache: z.number().min(0).max(1).optional(),
    pace: z.number().min(0).max(1).optional(),
    "moral-complexity": z.number().min(0).max(1).optional(),
    complexity: z.number().min(0).max(1).optional(),
  }),
  absent: z.array(z.enum(VOCABULARY_V2_KEYS as [string, ...string[]])).max(6),
  didnt_work: z.object({ keys: z.array(evidenceTag).max(4), phrases: z.array(z.string().max(160)).max(3) }),
  valued: z.array(z.string().max(160)).max(3),
  summary: z.string().max(60),
  quote: z.string().max(160).nullable(),
});

const emptyStory = (): Reading["story"] => ({
  theme: [], arc: [], conflict: [], cast: [], bond: [], world: [], setting: [], frame: [],
  structure: [], momentum: [], stakes: [], ending: [],
});
const emptyFeeling = (): Reading["feeling"] => ({ tone: [], register: [], texture: [], aftertaste: [] });

/** Taps intentionally produce no reading evidence. */
export function emptyReading(): Reading {
  return {
    story: emptyStory(),
    feeling: emptyFeeling(),
    scalars: {},
    absent: [],
    didnt_work: { keys: [], phrases: [] },
    valued: [],
    summary: "",
    quote: null,
  };
}

const unique = <T>(values: T[], key: (value: T) => string): T[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const k = key(value);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const normalizeTags = (tags: WeightedTag[]): WeightedTag[] =>
  unique([...tags].sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key)), (tag) => tag.key);

/** Enforce the fields whose validity depends on the original private note. */
export function finalizeReading(reading: Reading, note: string | null, fallbackQuote: string | null = null): Reading {
  const text = note?.trim() ?? "";
  const verbatim = (phrases: string[], limit: number) =>
    unique(phrases.filter((phrase) => phrase.length > 0 && text.includes(phrase)), (phrase) => phrase).slice(0, limit);
  const story = Object.fromEntries(
    Object.entries(reading.story).map(([group, tags]) => [group, normalizeTags(tags)]),
  ) as Record<StoryGroup, WeightedTag[]>;
  const feeling = Object.fromEntries(
    Object.entries(reading.feeling).map(([group, tags]) => [group, normalizeTags(tags)]),
  ) as Record<FeelingGroup, WeightedTag[]>;
  return {
    ...reading,
    story,
    feeling,
    absent: unique(reading.absent, (key) => key).slice(0, 6),
    didnt_work: {
      keys: normalizeTags(reading.didnt_work.keys).slice(0, 4),
      phrases: verbatim(reading.didnt_work.phrases, 3),
    },
    valued: verbatim(reading.valued, 3),
    summary: text ? reading.summary.slice(0, 60) : "",
    quote: text && reading.quote && text.includes(reading.quote)
      ? reading.quote
      : text && fallbackQuote && text.includes(fallbackQuote)
        ? fallbackQuote
        : null,
  };
}

export const READING_SYSTEM_PROMPT = `You convert one person's private note about a work into vocabulary-v2 evidence shared across movies, TV, anime, books, and music.

Use only evidence in the person's written note. The title, category, and tapped reactions are context only: never infer attributes from them. If no note is supplied, every group is empty, scalars is {}, absent/valued/didnt_work are empty, summary is "", and quote is null.

Story keys by group:
- theme: ${THEMES_V2.join(", ")}
- arc: ${ARCS.join(", ")}
- conflict: ${CONFLICTS.join(", ")}
- cast: ${CASTS.join(", ")}
- bond: ${BONDS.join(", ")}
- world: ${WORLDS.join(", ")}
- setting: ${SETTINGS_V2.join(", ")}
- frame: ${FRAMES.join(", ")}
- structure: ${STRUCTURES.join(", ")}
- momentum: ${MOMENTUMS.join(", ")}
- stakes: ${STAKES.join(", ")}
- ending: ${ENDINGS.join(", ")}

Feeling keys by group:
- tone: ${TONES.join(", ")}
- register: ${REGISTERS.join(", ")}
- texture: ${TEXTURES.join(", ")}
- aftertaste: ${AFTERTASTES.join(", ")}

Rules:
- All weights and scalar values are 0..1. Never emit negative values.
- Scalars are intensity, ache, pace, moral-complexity, and complexity. Omit a scalar when the note gives no evidence. Pace is 0 for slow and 1 for brisk.
- For an explicitly absent attribute (for example "not quiet"), put its full key in absent and do not treat that statement as positive evidence.
- didnt_work.keys are full vocabulary keys for characteristics the person explicitly disliked. Its phrases and every valued phrase must be exact verbatim substrings of the note.
- valued contains only what the person explicitly says they valued, loved, liked, or appreciated.
- summary is a plain noun phrase of at most 60 characters that echoes the note's emphasis, with no quality judgment.
- quote is an exact verbatim substring of at most 160 characters, or null.
- Never use reviews, popularity, outside knowledge, or other users' opinions.`;
