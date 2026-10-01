// The whole pure path (SPEC-STAGE3 §6–§9): filter → score → order → rerank →
// snapshots → context. One function, no database, no network, no clock — Session 7
// wraps it with candidate generation and persistence. Everything the explainer needs
// is computed here and handed to buildSnapshot; nothing is invented downstream.
import type { EntryWithContext } from "@/lib/types";
import { anchorOf, routeOf, sharedFor } from "./explain";
import { fitsTime } from "./form";
import { filterCandidates, type PipelineFilters, type RecentImpression } from "./filters";
import type { Source, StageCandidate } from "./score";
import { scoreCandidates, orderScored } from "./score";
import { buildContext, buildSnapshot } from "./snapshot";
import type { ImpressionSnapshot, SessionContext } from "./snapshot";
import { rerank } from "./rerank";
import type { TastePrefs } from "./tags";
import type { UserProfile } from "./profile";

export function rankPipeline(args: {
  P: UserProfile;
  library: EntryWithContext[];
  prefs: TastePrefs;
  candidates: StageCandidate[];
  filters: PipelineFilters;
  recent: RecentImpression[];
  userId: string;
  now: Date;
  /** Session 7 candidate-generation pool counts; tests pass fixtures. */
  sourceCounts: Record<Source, number>;
  merged: number;
}): { snapshots: ImpressionSnapshot[]; context: SessionContext; deferred: StageCandidate[] } {
  const { P, library, prefs, candidates, filters, recent, userId, now, sourceCounts, merged } = args;

  // 1. The fixed nine steps. A removed candidate never reaches scoring.
  const { kept, deferred, removed, recencyRelaxed } = filterCandidates({
    candidates,
    library,
    prefs,
    filters,
    recent,
    now,
  });

  // 2. Score. Step 8 already removed the unprofiled, so this deferred must be empty.
  const { scored, deferred: scoreDeferred } = scoreCandidates(P, kept);
  if (scoreDeferred.length > 0) {
    throw new Error(`rankPipeline: ${scoreDeferred.length} unprofiled candidate(s) survived the filter`);
  }

  // 3. Order by score — or the surprise blend, which re-orders but never changes a score.
  const ordered = orderScored(scored, { surprise: filters.surprise, userId });

  // 4. Band quotas, caps, bridge repair. Selection only; every score is untouched.
  const { out, policy } = rerank(ordered, filters);
  const { quotas, quota_unfilled, caps_relaxed } = policy;

  // 5. Snapshots, in display order, with the explainer inputs computed by the Session 5
  // helpers — the pipeline is buildSnapshot's intended caller (STATE 2026-09-26 note).
  const snapshots = out.map(({ scored: s, rerank: info }, i) => {
    const route = routeOf(s, filters);
    const anchor = anchorOf(s, route);
    const shared = sharedFor(s, route, anchor);
    const anchorEntry = anchor ? library.find((e) => e.entry.id === anchor.anchor.entryId) ?? null : null;
    const phaseLabel = route === "phase" ? P.activePhase?.label ?? null : null;
    const fits = fitsTime(s.candidate.item, filters.minutes).note;
    return buildSnapshot({
      position: i + 1,
      scored: s,
      library,
      filters,
      fits,
      rerank: info,
      route,
      anchor,
      shared,
      anchorEntry,
      phaseLabel,
    });
  });

  // 6. The session context: thresholds from the real limit, pools from what each stage
  // actually saw, policy from what the re-ranker did.
  const context = buildContext({
    filters,
    profile: P,
    limit: filters.limit,
    pools: {
      ...sourceCounts,
      merged,
      removed,
      deferred: deferred.length,
      scored: scored.length,
    },
    policy: {
      quotas,
      quota_unfilled,
      recency_relaxed: recencyRelaxed,
      caps_relaxed,
      surprise: filters.surprise,
    },
  });

  return { snapshots, context, deferred };
}
