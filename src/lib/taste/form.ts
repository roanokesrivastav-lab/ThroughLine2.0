// Form: length, and nothing else in Stage 3 (SPEC-STAGE3 §1.4). The 0.15 form
// component scores the length band; craft words are stored but not scored.
//
// fitsTime, estimatedMinutes and TimeBudget moved here from recommend.ts in the
// Session 7B switch-over (byte-identical; SPEC-STAGE3 §B row 10), so the legacy
// scorer module could be deleted. This module holds only the §1.4 functions plus
// those moved ones.
//
// The spec's minutes table covers movie, tv, anime and book — the four Stage 3
// media. Music is profiled but never matched in Stage 3 (DECISIONS #59, Q1), so
// its minutes are unknown (null) here; no behaviour is invented for it.

import type { Category, MediaItem } from "@/lib/types";

/**
 * minutes_to_finish(item) (§1.4):
 *   movie       → metadata.runtime_minutes
 *   tv          → episodes × episode_runtime_minutes
 *   anime       → runtime_minutes when present (a film), else episodes × episode_runtime
 *   book        → pages × 1.6
 * null = unknown: missing information, the form component is 0 and the snapshot
 * records has_evidence.form = false.
 */
export function minutesToFinish(item: MediaItem): number | null {
  const m = item.metadata;
  if (item.category === "movie") {
    return typeof m.runtime_minutes === "number" ? m.runtime_minutes : null;
  }
  if (item.category === "anime" && typeof m.runtime_minutes === "number") {
    return m.runtime_minutes; // an anime film
  }
  if (item.category === "tv" || item.category === "anime") {
    if (typeof m.episodes !== "number" || typeof m.episode_runtime_minutes !== "number") return null;
    return m.episodes * m.episode_runtime_minutes;
  }
  if (item.category === "book") {
    if (typeof m.pages !== "number") return null;
    return m.pages * 1.6;
  }
  return null; // music: not matched in Stage 3; unspecified here by design
}

/**
 * band(minutes) per category, index 0..3 (§1.4):
 *   movie      <90 | 90–119 | 120–149 | ≥150
 *   tv, anime  <300 (5 h) | 300–899 | 900–2399 | ≥2400 (40 h)
 *   book       <300 (5 h) | 300–599 | 600–1199 | ≥1200 (20 h)
 * null when minutes are unknown. Null is missing information, never band 0.
 */
export function band(category: Category, minutes: number | null): 0 | 1 | 2 | 3 | null {
  if (minutes == null) return null;
  if (category === "movie") {
    if (minutes < 90) return 0;
    if (minutes < 120) return 1;
    if (minutes < 150) return 2;
    return 3;
  }
  if (category === "tv" || category === "anime") {
    if (minutes < 300) return 0;
    if (minutes < 900) return 1;
    if (minutes < 2400) return 2;
    return 3;
  }
  if (category === "book") {
    if (minutes < 300) return 0;
    if (minutes < 600) return 1;
    if (minutes < 1200) return 2;
    return 3;
  }
  return null; // music, as above
}

// ---------------------------------------------------------------------------
// Moved from recommend.ts (Session 7B, SPEC-STAGE3 §B row 10), byte-identical.
// ---------------------------------------------------------------------------

export type TimeBudget = 20 | 40 | 60 | 150 | null;

/** Estimated minutes to finish (or to make a satisfying dent in) this item. */
export function estimatedMinutes(item: MediaItem): number | null {
  const m = item.metadata;
  switch (item.category) {
    case "movie": return m.runtime_minutes ?? null;
    case "tv":
    case "anime": return m.episode_runtime_minutes ?? m.runtime_minutes ?? null; // an anime feature carries runtime_minutes
    case "music": return m.duration_seconds ? Math.max(1, Math.round(m.duration_seconds / 60)) : 4;
    case "book": return m.pages ? Math.round(m.pages * 1.6) : null; // ~1.6 min/page, used only for "short read"
  }
}

export function fitsTime(item: MediaItem, minutes: TimeBudget): { ok: boolean; note: string | null } {
  if (!minutes) return { ok: true, note: null };
  const est = estimatedMinutes(item);
  if (item.category === "book") {
    // A reading session is flexible; only very short budgets exclude books.
    if (minutes < 40) return { ok: false, note: null };
    return { ok: true, note: est && est <= 240 ? "Short enough to finish in a few sittings" : "A chapter or two" };
  }
  const isSeries = (item.category === "tv" || item.category === "anime") && !(item.metadata.episode_runtime_minutes == null && item.metadata.runtime_minutes != null);
  if (isSeries) {
    if (est == null) return { ok: minutes >= 40, note: "One episode" };
    return est <= minutes ? { ok: true, note: `One episode, about ${est} min` } : { ok: false, note: null };
  }
  if (est == null) return { ok: minutes >= 150, note: null };
  return est <= minutes ? { ok: true, note: `${est} min` } : { ok: false, note: null };
}
