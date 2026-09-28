// The fixed nine-step hard filter (SPEC-STAGE3 §6). Pure: no database, no network,
// no clock — the candidate arrives with its item profile already loaded (§1.7) and
// `now` is passed in. A candidate a step removes never reaches scoring; each count
// equals exactly the number that step removed, so the session context can show the
// pool arithmetic honestly (§9.2).
import type { Category, EntryWithContext, MediaItem } from "@/lib/types";
import { usableProfile } from "./affinity";
import { minutesToFinish } from "./form";
import { fitsTime, type TimeBudget } from "./recommend";
import { buildTagProfile, isMuted, type TagProfile, type TastePrefs } from "./tags";
import { RECENCY_DAYS } from "./weights";
import type { StageCandidate } from "./score";

export type PipelineFilters = {
  category: Category | null;
  minutes: TimeBudget;
  listOnly: boolean;
  returnable: boolean;
  shortRead: boolean;
  surprise: boolean;
  /** limit ≥ 1: 3 on Home, 5 on Recommend (§6 step 9). */
  limit: number;
};

/** A key shown within the recency window. Session 7 loads these from query_sessions. */
export type RecentImpression = { key: string; shownAt: string };

export type RemovedCounts = {
  category: number;
  listOnly: number;
  logged: number;
  hidden: number;
  muted: number;
  known: number;
  time: number;
  unprofiled: number;
  recent: number;
};

const DAY = 86_400_000;

export function filterCandidates(args: {
  candidates: StageCandidate[];
  library: EntryWithContext[];
  prefs: TastePrefs;
  filters: PipelineFilters;
  recent: RecentImpression[];
  now: Date;
}): { kept: StageCandidate[]; deferred: StageCandidate[]; removed: RemovedCounts; recencyRelaxed: boolean } {
  const { candidates, library, prefs, filters, recent, now } = args;
  const removed: RemovedCounts = { category: 0, listOnly: 0, logged: 0, hidden: 0, muted: 0, known: 0, time: 0, unprofiled: 0, recent: 0 };

  // Shared state, built once: the tag profile (step 5), the library identity sets
  // (step 3) and the recency cutoff (step 9). Nothing here is per-candidate work.
  const tagProfile: TagProfile = buildTagProfile(library, prefs);
  const libraryItemIds = new Set(library.map((e) => e.item.id));
  const libraryKeys = new Set(library.map((e) => `${e.item.source}:${e.item.external_id}`));
  // A title can surface in several sessions, so `recent` may hold duplicates per key:
  // the newest impression must win, or a stale record could wave the title through the
  // window or misorder its re-admission. (Map literal construction would keep whichever
  // duplicate came last.)
  const recentAt = new Map<string, number>();
  for (const r of recent) {
    const at = new Date(r.shownAt).getTime();
    const prev = recentAt.get(r.key);
    if (prev === undefined || at > prev) recentAt.set(r.key, at);
  }
  const cutoff = now.getTime() - RECENCY_DAYS * DAY;

  // Step 7's returnable rule reads profile keys. An item with no usable profile cannot
  // fail it — step 8 is where unprofiled items are queued (DECISIONS below) — so it
  // would otherwise never be profiled during returnable-filtered requests.
  const passesReturnable = (item: MediaItem): boolean => {
    const p = usableProfile(item);
    if (!p) return true;
    return (p.vector.feeling["aftertaste.comforting"] ?? 0) >= 0.4 || (p.vector.feeling["tone.warm"] ?? 0) >= 0.4;
  };

  const core: StageCandidate[] = []; // through step 8
  const deferred: StageCandidate[] = [];

  for (const c of candidates) {
    const item = c.item;
    // 1. category: music never matches (§E Q1); a set category must match exactly.
    if (item.category === "music" || (filters.category !== null && item.category !== filters.category)) {
      removed.category++;
      continue;
    }
    // 2. listOnly: only the user's own backlog.
    if (filters.listOnly && c.entryId === null) {
      removed.listOnly++;
      continue;
    }
    // 3. logged: already in the library, by item id or by source:external_id key.
    if (c.entryId === null && (libraryItemIds.has(item.id) || libraryKeys.has(c.key))) {
      removed.logged++;
      continue;
    }
    // 4. hidden: "not for me", item-scoped, never widened (DECISIONS #32).
    if (prefs.hidden.includes(c.key)) {
      removed.hidden++;
      continue;
    }
    // 5. muted: a hard filter on the derived tag profile, not a penalty.
    if (isMuted(item.genre_tags, tagProfile)) {
      removed.muted++;
      continue;
    }
    // 6. known: a named no-op, reserved for Part 4 (SPEC §6). Its own step, always 0.
    // 7. time: the budget, then shortRead with the legacy semantics (non-books removed;
    //    books over 480 known minutes removed; unknown-length books pass), then returnable.
    if (!fitsTime(item, filters.minutes).ok) {
      removed.time++;
      continue;
    }
    if (filters.shortRead) {
      if (item.category !== "book") {
        removed.time++;
        continue;
      }
      const mins = minutesToFinish(item);
      if (mins !== null && mins > 480) {
        removed.time++;
        continue;
      }
    }
    if (filters.returnable && !passesReturnable(item)) {
      removed.time++;
      continue;
    }
    // 8. unprofiled: never scored, never dropped silently — queued for ensureProfiles.
    if (usableProfile(item) === null) {
      deferred.push(c);
      removed.unprofiled++;
      continue;
    }
    core.push(c);
  }

  // 9. recent: set aside keys shown within the window; if the kept list then runs short
  // of the limit, re-admit oldest-most-recent-impression first (ties by key).
  const setAside: StageCandidate[] = [];
  const kept: StageCandidate[] = [];
  for (const c of core) {
    const at = recentAt.get(c.key);
    if (at !== undefined && at >= cutoff) setAside.push(c);
    else kept.push(c);
  }
  let recencyRelaxed = false;
  if (kept.length < filters.limit && setAside.length > 0) {
    recencyRelaxed = true;
    setAside.sort(
      (a, b) => (recentAt.get(a.key) as number) - (recentAt.get(b.key) as number) || a.key.localeCompare(b.key),
    );
    for (const c of setAside) {
      if (kept.length >= filters.limit) break;
      kept.push(c);
    }
  }
  const untouched = core.length - setAside.length;
  removed.recent = setAside.length - (kept.length - untouched);

  return { kept, deferred, removed, recencyRelaxed };
}
