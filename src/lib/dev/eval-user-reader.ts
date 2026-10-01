// The --user mode of the evaluation CLI (handoff §2.3): a read-only, RecommendStore-shaped
// reader over one user's library. The service-role client is built inside the script
// (like seed-demo.ts); this module is never imported by app code and is covered by a
// stub test only — Session 9 runs it against live data, with the founder present.
// Nothing here writes: there is no insertSession, no update, no upsert, by design.
import type { Category, EntryWithContext, MediaItem, Phase } from "@/lib/types";
import type { RecommendStore } from "@/lib/server/stage-recommend";
import { loadLibrary } from "@/lib/server/entries";
import { loadPhases } from "@/lib/server/phases";
import { loadTastePrefs } from "@/lib/server/recommend";
import { PROFILE_VERSION, POOL_SIZE } from "@/lib/taste/weights";
import { MATCHED_CATEGORIES } from "@/lib/taste/profile";
import { candidateKey, type TastePrefs } from "@/lib/taste/tags";

/** The media_items columns the eval path reads. Never select("*"). */
const MEDIA_COLUMNS =
  "id, category, title, subtitle, source, external_id, image_url, release_year, creators, genre_tags, metadata, feel_prior, profile, profile_status, profile_version, profiled_at";

type Db = Parameters<typeof loadLibrary>[0];

/**
 * A read-only store over one user's data. Every read is the same query shape the live
 * path uses; the insertSession method exists only to throw, so a future mistake cannot
 * silently become a write. The pool is loaded once, library-excluded, and capped.
 */
export function userEvalReader(db: Db, userId: string): RecommendStore {
  let poolCache: MediaItem[] | null = null;
  return {
    async loadLibrary(userIdArg) {
      if (userIdArg !== userId) throw new Error(`eval reader is bound to user ${userId}, not ${userIdArg}`);
      return loadLibrary(db, userId);
    },
    async loadPrefs() {
      const prefs: TastePrefs = await loadTastePrefs(db, userId);
      return prefs;
    },
    async loadPhases() {
      const rows = await loadPhases(db, userId);
      return rows.map((p) => ({
        id: p.id, user_id: p.user_id, kind: p.kind, fingerprint: p.fingerprint, label: p.label, user_label: p.user_label,
        start_at: p.start_at, end_at: p.end_at, category: p.category, confidence: p.confidence,
        evidence: p.evidence, dismissed: p.dismissed, detected_at: p.detected_at,
      }));
    },
    async loadPool(categories: Category[], limit: number) {
      if (poolCache) return poolCache;
      const library = await loadLibrary(db, userId);
      const inLibrary = new Set(library.map((e) => candidateKey(e.item)));
      // Load past the cut so the library exclusion happens before it (§2.2), then take
      // the caller's limit — the script passes POOL_SIZE for live-pipeline parity
      // (review P2-5: the earlier hard 50 silently shrank the candidate population).
      const { data, error } = await db
        .from("media_items")
        .select(MEDIA_COLUMNS)
        .eq("profile_status", "done")
        .eq("profile_version", PROFILE_VERSION)
        .in("category", categories.length ? categories : [...MATCHED_CATEGORIES])
        .order("profiled_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(POOL_SIZE + library.length);
      if (error) throw new Error(`[eval] pool read failed: ${error.message}`);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      poolCache = rows
        .map((r) => r as unknown as MediaItem)
        .filter((item) => !inLibrary.has(candidateKey(item)))
        .slice(0, Math.max(0, limit));
      return poolCache;
    },
    async findByKeys() {
      return []; // eval does no creator expansion, so nothing needs hydrating
    },
    async loadSessions() {
      return []; // recency is off in every eval run (§D: skip step 9)
    },
    async keysForIds() {
      return new Map<string, string>();
    },
    async insertSession(): Promise<void> {
      throw new Error("[eval] the --user reader is read-only; insertSession must never be called");
    },
  };
}

export type EvalUserInput = {
  library: EntryWithContext[];
  prefs: TastePrefs;
  phases: Phase[];
  pool: MediaItem[];
  canon: MediaItem[];
};

/** Shape guard for the report the script prints; the stub test asserts against it. */
export type EvalReportShape = {
  feature_version: string;
  calibration_id: string;
  library_size: number;
  d1: unknown;
  d2: unknown;
  d3: unknown;
  d4: unknown;
  d5: unknown;
  closeness: unknown;
};
