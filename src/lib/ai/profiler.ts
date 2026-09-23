// Item profiling infrastructure (SPEC-STAGE3 §1.2, §B16). This file holds the shared
// ItemProfiler interface, the frameFromGenre table, and the deterministic mock profiler
// (DECISIONS #67): the existing, reviewed note lexicon run over the item's catalogue
// overview, converted to a draft and passed through the same buildItemProfile contract
// every provider uses. No second vector-building path exists.
//
// PLACEHOLDER, like fixtureProfile: mock profiles are lexicon echoes of catalogue prose,
// not real readings of a work. They exist so offline tests and development run without a
// model. Session 4 must never persist one as though it were real without an explicit
// decision (DECISIONS #72). No feel_prior, no randomness, no clock: the same item always
// produces a deep-equal profile.

import type { AttributeVector, ItemProfile, MediaItem } from "@/lib/types";
import { buildItemProfile, type ProfileDraft } from "./profile-contract";
import { lexiconVector } from "./mock-extractor";

export { PROFILE_VERSION } from "@/lib/taste/weights";

/** Writes one item's profile. Implementations must be idempotent per (item, PROFILE_VERSION). */
export interface ItemProfiler {
  /** Stable name for profiling bookkeeping and the extraction-style audit trail ("claude", "nvidia", "mock"). */
  readonly name: string;
  profile(item: MediaItem): Promise<ItemProfile>;
}

// frameFromGenre (SPEC §B): catalogue genre tags map to frame values with weight 1.0,
// source "catalog", confidence 0.9 at merge time. Everything else — drama, animation,
// action, family, history, war, western, documentary, music — maps to nothing; the AI
// supplies frame for those. Exact table, no extensions.
const FRAME_FROM_GENRE: Record<string, string> = {
  comedy: "comedy",
  "sci-fi": "sci-fi",
  fantasy: "fantasy",
  horror: "horror",
  crime: "crime",
  mystery: "mystery",
  thriller: "thriller",
  romance: "romance",
  adventure: "adventure",
  "slice of life": "slice-of-life",
  satire: "satire",
  noir: "crime",
  psychological: "thriller",
  dystopia: "sci-fi",
  supernatural: "fantasy",
  mecha: "sci-fi",
};

/** The frame value for a catalogue genre tag, or null when the table maps it to nothing. */
export function frameFromGenre(genre: string): string | null {
  return FRAME_FROM_GENRE[genre.trim().toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Deterministic mock profiler (DECISIONS #67). See the header comment: placeholder
// output for offline tests, never presented as a real reading of a work.
// ---------------------------------------------------------------------------

/** Per-group caps, matching the draft schema's array maxima. Ties keep the lexicographically smaller key. */
const DRAFT_CAPS: Record<string, number> = {
  theme: 4, arc: 2, conflict: 2, cast: 3, bond: 2, world: 2, setting: 3, frame: 3,
  structure: 2, momentum: 3, stakes: 1, ending: 1,
  tone: 4, register: 3, texture: 3, aftertaste: 3,
};

/** Top-N by weight, ties by key ascending, so cap enforcement is deterministic. */
const topTags = (vector: AttributeVector, prefix: string, cap: number) =>
  Object.entries(vector)
    .filter(([key]) => key.startsWith(`${prefix}.`))
    .map(([key, weight]) => ({ key: key.slice(prefix.length + 1), weight, confidence: 0.5 }))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, cap);

export function mockProfile(item: MediaItem): ItemProfile {
  // Manual items are profiled from title, creators and book kind only (SPEC §1.2): the
  // overview is ignored, so the vector holds nothing but the genre frames from the merge.
  const text = item.source === "manual" ? "" : (item.metadata.overview ?? "");
  const { vector, absent } = lexiconVector(text);
  // Item profiles have no absent: a key the text explicitly negates is dropped completely,
  // even when the same word matched positively elsewhere (the extractor records absent;
  // the profiler's draft simply never carries the key).
  for (const key of absent) delete vector[key];

  const draft: ProfileDraft = {
    premise: null,
    story: {
      theme: topTags(vector, "theme", DRAFT_CAPS.theme),
      arc: topTags(vector, "arc", DRAFT_CAPS.arc),
      conflict: topTags(vector, "conflict", DRAFT_CAPS.conflict),
      cast: topTags(vector, "cast", DRAFT_CAPS.cast),
      bond: topTags(vector, "bond", DRAFT_CAPS.bond),
      world: topTags(vector, "world", DRAFT_CAPS.world),
      setting: topTags(vector, "setting", DRAFT_CAPS.setting),
      frame: topTags(vector, "frame", DRAFT_CAPS.frame),
      structure: topTags(vector, "structure", DRAFT_CAPS.structure),
      momentum: topTags(vector, "momentum", DRAFT_CAPS.momentum),
      stakes: topTags(vector, "stakes", DRAFT_CAPS.stakes),
      ending: topTags(vector, "ending", DRAFT_CAPS.ending),
    },
    feeling: {
      tone: topTags(vector, "tone", DRAFT_CAPS.tone),
      register: topTags(vector, "register", DRAFT_CAPS.register),
      texture: topTags(vector, "texture", DRAFT_CAPS.texture),
      aftertaste: topTags(vector, "aftertaste", DRAFT_CAPS.aftertaste),
    },
    scalars: {},
    craft: [],
  };
  // Scalars, if the lexicon matched any, keep their value with confidence 0.5.
  for (const scalar of ["intensity", "ache", "pace", "moral-complexity", "complexity"] as const) {
    if (vector[scalar] !== undefined) draft.scalars[scalar] = { value: vector[scalar], confidence: 0.5 };
  }

  // The frame merge adds genre frames automatically; validation is lenient because a
  // lexicon cannot honestly assert an ending (DECISIONS #72).
  return buildItemProfile(item, draft, { attributeSource: "catalog", completeness: "lenient" });
}

export const mockProfiler: ItemProfiler = { name: "mock", profile: async (item) => mockProfile(item) };
