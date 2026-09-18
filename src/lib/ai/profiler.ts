// Item profiling infrastructure (SPEC-STAGE3 §1.2, §B16) — interface and deterministic
// pieces only in this session (DECISIONS #60). The Claude and NVIDIA profiler clients and
// the deterministic overview-lexicon mock are later work: the mock's lexicon contents are
// not specified anywhere, so none is stubbed here rather than invented. Real profiling
// runs no model calls from this session.
//
// What a profiler owes the pipeline: an ItemProfile whose profile_version is
// PROFILE_VERSION and whose vector[F][key] = clamp01(weight × confidence) for every
// attribute with weight × confidence ≥ 0.05, computed at write time (§1.2) — that
// vector is the only thing the scorer reads.

import type { ItemProfile, MediaItem } from "@/lib/types";

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
