import "server-only";
import type { Creator, ItemProfile, MediaItem, MediaMetadata } from "@/lib/types";
export type { ItemProfile };
import type { MediaItemsRow } from "@/lib/db/types";
import { canonProfile } from "@/lib/catalog/canon";
import { aiProvider } from "@/lib/ai/extractor";
import { getProfiler } from "@/lib/ai/item-profiler";
import type { ItemProfiler } from "@/lib/ai/profiler";
import { PROFILE_VERSION } from "@/lib/taste/weights";
import { upsertMediaItem, type Db } from "./entries";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Profile runtime (SPEC-STAGE3 §6 step 8): catalogue items get their profile through a
 * bounded, idempotent, retrying queue. It runs after a log, after an onboarding tap, and
 * in the daily cron. Canon items resolve from the committed profile file for free, and
 * nothing is ever written that isn't a real, strictly validated profile (DECISIONS #72).
 *
 * Runtime limits, not features: they stay out of weights.ts and FEATURE_VERSION.
 */
export const PROFILE_MAX_ATTEMPTS = 5; // SPEC §6 step 8 ("attempts < 5")
export const PROFILE_INLINE_LIMIT = 5; // SPEC §6 step 8 / §E Q7
export const PROFILE_CRON_LIMIT = 20; // SPEC §6 step 8 / §E Q7
export const PROFILE_CALL_TIMEOUT_MS = 120_000; // matches nvidia.ts complete()
/**
 * A claim holds the row for at most two call timeouts (review round, 2026-09-24):
 * `profiled_at` is set at claim and read as a lease — while it is fresh, no other worker
 * loads or claims the row, so two overlapping workers can never pay for the same item.
 * markDone overwrites it with its real meaning; markFailed clears it, so a failed row is
 * re-eligible immediately. A crashed worker's lease expires on its own.
 */
export const PROFILE_LEASE_MS = 2 * PROFILE_CALL_TIMEOUT_MS;

/** The media_items columns the queue reads. Never select("*") into logs. */
export type ProfileRow = Pick<
  MediaItemsRow,
  "id" | "category" | "title" | "subtitle" | "source" | "external_id" | "image_url" | "release_year" | "creators" | "genre_tags" | "metadata" | "profile_status" | "profile_version" | "profile_attempts" | "profiled_at"
>;

export type ProfileRunResult = {
  considered: number;
  canon: number;
  profiled: number;
  failed: number;
  skippedNoProvider: number;
  lostClaim: number;
  stoppedAtDeadline: boolean;
};

const emptyRunResult = (): ProfileRunResult => ({
  considered: 0, canon: 0, profiled: 0, failed: 0, skippedNoProvider: 0, lostClaim: 0, stoppedAtDeadline: false,
});

/**
 * Storage behind a small interface so the queue logic is testable without a database.
 * Implementations must be safe to call from the cron and a post-log run at once.
 */
export interface ProfileStore {
  /** Rows needing a profile: (status ≠ 'done' OR profile_version ≠ current) AND attempts < max for non-done rows (a done row at an old version is always refresh-eligible, however it got there) AND no fresh claim lease. Ids limited to `ids` when given, oldest first. */
  loadNeeding(opts: { limit: number; maxAttempts: number; version: string; ids?: string[] }): Promise<ProfileRow[]>;
  /** Compare-and-swap claim: attempts := expected + 1 and a fresh lease only if attempts still = expected, the row still needs a profile, and no lease is active. Returns false if another worker got there first. */
  claim(id: string, expectedAttempts: number): Promise<boolean>;
  /** status done, profile, profile_version, profiled_at, profile_error null */
  markDone(id: string, profile: ItemProfile, at: string): Promise<void>;
  /** status failed, profile_error ≤ 500 chars, lease released (profiled_at null); attempts were already bumped by claim */
  markFailed(id: string, error: string): Promise<void>;
}

const PROFILE_ROW_COLUMNS =
  "id, category, title, subtitle, source, external_id, image_url, release_year, creators, genre_tags, metadata, profile_status, profile_version, profile_attempts, profiled_at";

/**
 * Supabase store. MUST be built on the service-role client (media_items has no client
 * write policy, DECISIONS #4) and must never be handed a user's RLS client: the cron and
 * profileItemsNow are the only callers, and both use supabaseAdmin().
 */
export function supabaseProfileStore(db: Db): ProfileStore {
  return {
    async loadNeeding({ limit, maxAttempts, version, ids }) {
      // Attempts cap scopes to non-done rows: a profile that succeeded on its last attempt
      // under an old version must still be refresh-eligible when the version changes
      // (review round, 2026-09-24). Freshly claimed rows (lease) are excluded so a second
      // worker never sees an in-flight row.
      const leaseCutoff = new Date(Date.now() - PROFILE_LEASE_MS).toISOString();
      let q = db
        .from("media_items")
        .select(PROFILE_ROW_COLUMNS)
        .or(`and(profile_status.neq.done,profile_attempts.lt.${maxAttempts}),profile_version.neq.${version}`)
        .or(`profiled_at.is.null,profiled_at.lt.${leaseCutoff}`)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (ids?.length) q = q.in("id", ids);
      const { data, error } = await q;
      if (error) throw new Error(`[profiles] loadNeeding failed: ${error.message}`);
      return (data ?? []) as unknown as ProfileRow[];
    },

    async claim(id, expectedAttempts) {
      // Compare-and-swap on attempts PLUS a lease on profiled_at: the CAS alone cannot
      // distinguish "bumped by a claim" from "bumped by a failure", so a second worker
      // could load a claimed-but-still-pending row and pay for a second call (review
      // round, 2026-09-24). The lease closes that window; markFailed releases it, and a
      // crashed worker's lease simply expires (PROFILE_LEASE_MS).
      const leaseCutoff = new Date(Date.now() - PROFILE_LEASE_MS).toISOString();
      const { data, error } = await db
        .from("media_items")
        .update({ profile_attempts: expectedAttempts + 1, profiled_at: new Date().toISOString() })
        .eq("id", id)
        .eq("profile_attempts", expectedAttempts)
        .or(`profiled_at.is.null,profiled_at.lt.${leaseCutoff}`)
        .select("id");
      if (error) {
        console.error("[profiles] claim failed:", error.message);
        return false;
      }
      return (data ?? []).length === 1;
    },

    async markDone(id, profile, at) {
      const { error } = await db
        .from("media_items")
        .update({
          profile_status: "done",
          profile: profile as unknown as MediaItemsRow["profile"],
          profile_version: PROFILE_VERSION,
          profiled_at: at,
          profile_error: null,
        })
        .eq("id", id);
      if (error) throw new Error(`[profiles] markDone failed: ${error.message}`);
    },

    async markFailed(id, error) {
      const { error: e } = await db
        .from("media_items")
        .update({ profile_status: "failed", profile_error: error.slice(0, 500), profiled_at: null })
        .eq("id", id);
      if (e) console.error("[profiles] markFailed failed:", e.message);
    },
  };
}

/** The row as a MediaItem for the profiler. The stored profile column and feel_prior are not profiling inputs (SPEC §1.2); the queue never reads them back. */
function profileRowToItem(row: ProfileRow): MediaItem {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    subtitle: row.subtitle,
    source: row.source,
    external_id: row.external_id,
    image_url: row.image_url,
    release_year: row.release_year,
    creators: Array.isArray(row.creators) ? (row.creators as unknown as Creator[]) : [],
    genre_tags: row.genre_tags ?? [],
    metadata: (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as MediaMetadata,
    feel_prior: null,
    profile: null,
  };
}

/**
 * One row → one profile, or an explicit skip. Canon rows resolve from the committed
 * profile file with no model call, even when the provider is mock. A null profiler means
 * the provider is mock or unconfigured: the row stays untouched (DECISIONS #72).
 */
async function resolveProfile(
  item: MediaItem,
  profiler: ItemProfiler | null,
): Promise<{ profile: ItemProfile; source: "canon" | "model" } | { skip: "no-provider" }> {
  if (canonResolvable(item)) return { profile: canonProfile(item.external_id) as ItemProfile, source: "canon" };
  if (!profiler) return { skip: "no-provider" };
  return { profile: await profiler.profile(item), source: "model" };
}

/** True when this canon row would resolve from the committed file with no model call. The preflight uses it before claiming: an unresolvable row must never spend an attempt (review round, 2026-09-24). */
function canonResolvable(item: MediaItem): boolean {
  return item.source === "canon" && canonProfile(item.external_id) !== null;
}

/** The profiler the queue may actually run: null under the mock provider, so no mock profile can reach markDone (DECISIONS #72). */
export function activeProfiler(): ItemProfiler | null {
  return aiProvider() === "mock" ? null : getProfiler();
}

/**
 * The queue itself. Sequential, one item at a time; claiming always happens before any
 * model call; one row failing never stops the loop; the deadline is checked before every
 * row so no call is started that could outlive the caller.
 */
export async function runPendingProfiles(
  store: ProfileStore,
  profiler: ItemProfiler | null,
  opts: { limit: number; deadlineAt?: number; ids?: string[]; now?: () => number },
): Promise<ProfileRunResult> {
  const now = opts.now ?? Date.now;
  const result = emptyRunResult();

  let rows: ProfileRow[];
  try {
    rows = await store.loadNeeding({ limit: opts.limit, maxAttempts: PROFILE_MAX_ATTEMPTS, version: PROFILE_VERSION, ids: opts.ids });
  } catch (err) {
    console.error("[profiles] load failed:", (err as Error).message);
    return result;
  }

  for (const row of rows) {
    if (opts.deadlineAt !== undefined && now() > opts.deadlineAt - PROFILE_CALL_TIMEOUT_MS) {
      result.stoppedAtDeadline = true;
      break;
    }
    result.considered++;

    const item = profileRowToItem(row);
    // Preflight before claiming (review round, 2026-09-24): a row that cannot be resolved
    // under the current provider — no committed canon profile and no real profiler — must
    // not be claimed. Claiming first would burn its attempts with no model call ever made.
    if (!canonResolvable(item) && profiler === null) {
      result.skippedNoProvider++;
      continue;
    }

    const claimed = await store.claim(row.id, row.profile_attempts).catch(() => false);
    if (!claimed) {
      result.lostClaim++;
      continue;
    }

    try {
      const resolved = await resolveProfile(item, profiler);
      if ("skip" in resolved) {
        // Defensive: the preflight above should make this unreachable. Release the lease
        // so the row is not stuck in flight (a skip is not an attempt-worthy failure).
        await store.markFailed(row.id, "no provider available for this row").catch(() => undefined);
        result.skippedNoProvider++;
        continue;
      }
      await store.markDone(row.id, resolved.profile, new Date().toISOString());
      if (resolved.source === "canon") result.canon++;
      else result.profiled++;
    } catch (err) {
      // ProfileValidationError (or any provider error): markFailed releases the claim
      // lease, so the row is retryable by the next run within the attempts cap.
      const msg = ((err as Error).message ?? String(err)).slice(0, 500);
      console.error(`[profiles] ${row.id} failed:`, msg);
      await store.markFailed(row.id, msg).catch((e) => console.error("[profiles] markFailed failed:", (e as Error).message));
      result.failed++;
    }
  }
  return result;
}

/**
 * Inline pass after a save (founder ruling: profile on log). Bounded by
 * PROFILE_INLINE_LIMIT; swallows and logs errors — a save must never fail because of
 * profiling, and this must never throw into after().
 */
export async function profileItemsNow(ids: string[]): Promise<ProfileRunResult> {
  const failed: ProfileRunResult = emptyRunResult();
  if (!ids.length) return failed;
  try {
    return await runPendingProfiles(supabaseProfileStore(supabaseAdmin()), activeProfiler(), {
      limit: Math.min(ids.length, PROFILE_INLINE_LIMIT),
      ids,
    });
  } catch (err) {
    console.error("[profiles] inline run failed:", (err as Error).message);
    return failed;
  }
}

/**
 * For Session 7: materialise catalogue items that are not yet rows (their id is still the
 * `source:external_id` key) and report which ids still need a usable profile. No model
 * calls here — the queue does the work; this only prepares and reports. The upsert does
 * not list the profile columns, so existing profile state is preserved.
 */
export async function ensureProfiles(items: MediaItem[]): Promise<{ materialised: MediaItem[]; needing: string[] }> {
  const materialised: MediaItem[] = [];
  const existing: MediaItem[] = [];
  for (const item of items) {
    if (!item.id.includes(":")) {
      existing.push(item);
      continue;
    }
    materialised.push(await upsertMediaItem(item));
  }
  // rowToItem's contract: profile is non-null iff status = done and version is current.
  const needing = [...existing, ...materialised].filter((i) => !i.profile).map((i) => i.id);
  return { materialised, needing };
}
