// The server side of the Stage 3 recommend path (SPEC-STAGE3 §5–§6, §9; Session 7A).
// Nothing is wired to a route yet: 7A builds the candidate list, runs Session 6's
// rankPipeline, and persists the session exactly as §9 describes. The live app keeps
// using the legacy scorer in server/recommend.ts until 7B switches over.
import "server-only";

import type { Category, MediaItem, Phase } from "@/lib/types";
import type { CatalogAdapter, CatalogResult } from "@/lib/catalog/types";
import type { QuerySessionsRow } from "@/lib/db/types";
import { CANON } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { loadLibrary, rowToItem, type Db } from "./entries";
import { loadPhases } from "./phases";
import { loadTastePrefs } from "./recommend";
import type { EntryWithContext } from "@/lib/types";
import { creatorQueries, generateCandidates } from "@/lib/taste/candidates";
import { buildUserProfile, MATCHED_CATEGORIES, type UserProfile } from "@/lib/taste/profile";
import { rankPipeline } from "@/lib/taste/pipeline";
import type { PipelineFilters, RecentImpression } from "@/lib/taste/filters";
import type { ImpressionSnapshot, SessionContext } from "@/lib/taste/snapshot";
import type { Source, StageCandidate } from "@/lib/taste/score";
import { CREATOR_RESULTS_EACH, POOL_SIZE, PROFILE_VERSION, RECENCY_DAYS } from "@/lib/taste/weights";
import { candidateKey, type TastePrefs } from "@/lib/taste/tags";

// ---------------------------------------------------------------------------
// The store (§2.2): the only door to the database. Interface first so tests run
// against an in-memory implementation; the Supabase one uses the signed-in user's
// client the caller hands it — never supabaseAdmin (§8).
// ---------------------------------------------------------------------------

export interface RecommendStore {
  loadLibrary(userId: string): Promise<EntryWithContext[]>;
  loadPrefs(userId: string): Promise<TastePrefs>;
  loadPhases(userId: string): Promise<Phase[]>;
  /** §5 pool, before the library exclusion: profile_status 'done', profile_version current,
   *  category in `categories`, ordered by profiled_at desc then id asc, at most `limit` rows. */
  loadPool(categories: Category[], limit: number): Promise<MediaItem[]>;
  /** Existing media_items rows for these (source, external_id) keys, so a creator result
   *  that was already profiled is scored instead of deferred forever (§5). */
  findByKeys(keys: string[]): Promise<MediaItem[]>;
  /** query_sessions rows of this user, kind in `kinds`, created at or after `since`. */
  loadSessions(userId: string, kinds: QuerySessionsRow["kind"][], since: string): Promise<Array<Pick<QuerySessionsRow, "created_at" | "results">>>;
  /** For the legacy recency fallback: media_items uuid → `source:external_id`. */
  keysForIds(ids: string[]): Promise<Map<string, string>>;
  insertSession(row: { user_id: string; kind: QuerySessionsRow["kind"]; category: Category | null; answers: unknown; results: unknown }): Promise<void>;
}

const SESSION_KINDS = ["home", "recommend", "time"] as const;
const DAY = 86_400_000;

/** Every column rowToItem needs to decide usableProfile and build the MediaItem. Never select("*") (§2.2). */
const MEDIA_COLUMNS =
  "id, category, title, subtitle, source, external_id, image_url, release_year, creators, genre_tags, metadata, feel_prior, profile, profile_status, profile_version, profiled_at";

/** One signed-in user's read path. RLS already covers every query here and the one insert. */
export function supabaseRecommendStore(db: Db): RecommendStore {
  return {
    async loadLibrary(userId) {
      return loadLibrary(db, userId);
    },
    async loadPrefs(userId) {
      return loadTastePrefs(db, userId);
    },
    async loadPhases(userId) {
      // loadPhases adds entryIds (phase_members); buildUserProfile reads the Phase shape,
      // which has no entryIds, so drop it.
      const rows = await loadPhases(db, userId);
      return rows.map(({ entryIds: _entryIds, ...phase }) => phase);
    },
    async loadPool(categories, limit) {
      const { data, error } = await db
        .from("media_items")
        .select(MEDIA_COLUMNS)
        .eq("profile_status", "done")
        .eq("profile_version", PROFILE_VERSION)
        .in("category", categories)
        .order("profiled_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`[stage] loadPool failed: ${error.message}`);
      return (data ?? []).map((r) => rowToItem(r as never));
    },
    async findByKeys(keys) {
      if (keys.length === 0) return [];
      const or = keys.map((k) => {
        const i = k.indexOf(":");
        return `and(source.eq.${k.slice(0, i)},external_id.eq.${k.slice(i + 1)})`;
      });
      const { data, error } = await db
        .from("media_items")
        .select(MEDIA_COLUMNS)
        .or(or.join(","));
      if (error) throw new Error(`[stage] findByKeys failed: ${error.message}`);
      return (data ?? []).map((r) => rowToItem(r as never));
    },
    async loadSessions(userId, kinds, since) {
      const { data, error } = await db
        .from("query_sessions")
        .select("created_at, results")
        .eq("user_id", userId)
        .in("kind", kinds)
        .gte("created_at", since);
      if (error) throw new Error(`[stage] loadSessions failed: ${error.message}`);
      return data ?? [];
    },
    async keysForIds(ids) {
      const out = new Map<string, string>();
      if (ids.length === 0) return out;
      const { data, error } = await db.from("media_items").select("id, source, external_id").in("id", ids);
      if (error) throw new Error(`[stage] keysForIds failed: ${error.message}`);
      for (const r of data ?? []) out.set(r.id, `${r.source}:${r.external_id}`);
      return out;
    },
    async insertSession(row) {
      // The store interface takes unknown; the column is jsonb. Cast at this one boundary,
      // exactly as the legacy insert does.
      const { error } = await db.from("query_sessions").insert({
        ...row,
        answers: row.answers as QuerySessionsRow["answers"],
        results: row.results as QuerySessionsRow["results"],
      });
      if (error) throw new Error(`[stage] insertSession failed: ${error.message}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Recency (§2.3, §6 step 9): the keys shown within the window, from the three
// session kinds a user actually saw — never surprise sessions (§12.8 keeps
// surprise out of every signal, and DECISIONS #59 fixes the window at 14 days).
// ---------------------------------------------------------------------------

/**
 * v3 rows carry a string `key`; legacy rows carry a string `id` that is either the
 * `source:external_id` key (it contains ':') or a media_items uuid (resolved in one
 * batched read). Anything else is skipped without throwing. Duplicates are fine —
 * filterCandidates keeps the newest impression.
 */
export async function loadRecentImpressions(store: RecommendStore, userId: string, now: Date): Promise<RecentImpression[]> {
  const since = new Date(now.getTime() - RECENCY_DAYS * DAY).toISOString();
  const rows = await store.loadSessions(userId, [...SESSION_KINDS], since);

  // Pass 1: v3 keys and legacy keys in hand; collect the uuids needing one lookup.
  const out: RecentImpression[] = [];
  const uuids = new Set<string>();
  for (const row of rows) {
    const shownAt = row.created_at;
    const results = Array.isArray(row.results) ? row.results : [];
    for (const el of results) {
      if (el && typeof el === "object" && typeof (el as { key?: unknown }).key === "string") {
        out.push({ key: (el as { key: string }).key, shownAt });
        continue;
      }
      const id = el && typeof el === "object" ? (el as { id?: unknown }).id : el;
      if (typeof id !== "string" || id.length === 0) continue;
      if (id.includes(":")) out.push({ key: id, shownAt });
      else uuids.add(id);
    }
  }

  // Pass 2: one batched read for every legacy uuid, resolvable or not.
  if (uuids.size > 0) {
    let resolved: Map<string, string>;
    try {
      resolved = await store.keysForIds([...uuids]);
    } catch {
      return out; // the fallback exists to help, never to fail a request
    }
    for (const row of rows) {
      const shownAt = row.created_at;
      const results = Array.isArray(row.results) ? row.results : [];
      for (const el of results) {
        if (el && typeof el === "object" && typeof (el as { key?: unknown }).key === "string") continue;
        const id = el && typeof el === "object" ? (el as { id?: unknown }).id : el;
        if (typeof id !== "string" || id.length === 0 || id.includes(":")) continue;
        const key = resolved.get(id);
        if (key) out.push({ key, shownAt });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// buildStageRecommendations (§2.4): the six-source candidate list, Session 6's
// rankPipeline, and one insertSession. No ensureProfiles, no model calls — 7A
// returns deferred for 7B to queue.
// ---------------------------------------------------------------------------

export type StageDeps = { adapterFor: (c: Category) => CatalogAdapter; now: () => Date };

/** CANON as profiled items (§2.4 step 2): id `canon:<slug>`, committed profile stamped exactly as rowToItem would. */
function canonItems(): MediaItem[] {
  return CANON.map((c) => {
    const r = canonToResult(c);
    return { ...r, id: `canon:${c.slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(c.slug) };
  });
}

/** An adapter hit becomes a MediaItem with its key as id; the store swap then gives it the row's uuid and profile. */
function resultToItem(r: CatalogResult): MediaItem {
  return {
    id: `${r.source}:${r.external_id}`,
    category: r.category,
    title: r.title,
    subtitle: r.subtitle,
    source: r.source,
    external_id: r.external_id,
    image_url: r.image_url,
    release_year: r.release_year,
    creators: r.creators,
    genre_tags: r.genre_tags,
    metadata: r.metadata,
    feel_prior: r.feel_prior ?? null,
    profile: null,
  };
}

export async function buildStageRecommendations(
  store: RecommendStore,
  deps: StageDeps,
  userId: string,
  filters: PipelineFilters,
  opts: { kind: QuerySessionsRow["kind"] },
): Promise<{ snapshots: ImpressionSnapshot[]; context: SessionContext; deferred: StageCandidate[] }> {
  const now = deps.now();

  // 1. Library, prefs, phases → the Stage 3 user profile.
  const [library, prefs, phases] = await Promise.all([
    store.loadLibrary(userId),
    store.loadPrefs(userId),
    store.loadPhases(userId),
  ]);
  const P: UserProfile = buildUserProfile(library, phases, prefs, now);

  // 2. The canon deck, profiled from the committed file.
  const canon = canonItems();

  // 3. Pool + creator expansion, unless the request is list- or surprise-only.
  const queries = creatorQueries(P, filters);
  const creatorResults = new Map<string, MediaItem[]>();
  let pool: MediaItem[] = [];
  if (!filters.listOnly && !filters.surprise) {
    const categories: Category[] = filters.category !== null ? [filters.category] : [...MATCHED_CATEGORIES];
    // Load past POOL_SIZE so the library exclusion happens before the cut (§2.2).
    pool = await store.loadPool(categories, POOL_SIZE + library.length);
    const inLibrary = new Set(library.map((e) => candidateKey(e.item)));
    pool = pool.filter((item) => !inLibrary.has(candidateKey(item))).slice(0, POOL_SIZE);

    await Promise.all(
      queries.map(async (q) => {
        const adapter = deps.adapterFor(q.category);
        try {
          const results = await adapter.byCreator?.(q.name, q.category);
          // Keep more than CREATOR_RESULTS_EACH before key hydration: an adapter hit that
          // swaps into an existing profiled row must survive the slice on merit of the
          // row, not the raw arrival order (§2.4 step 4; generateCandidates re-slices).
          const hydrated = (results ?? []).slice(0, CREATOR_RESULTS_EACH * 2).map(resultToItem);
          creatorResults.set(q.creatorKey, hydrated);
        } catch (err) {
          console.warn(`[stage] creator expansion skipped for ${q.name}:`, (err as Error).message);
        }
      }),
    );

    // 4. Hydrate: swap in existing rows by key — one batched read.
    const raw = [...creatorResults.values()].flat();
    if (raw.length > 0) {
      const rows = await store.findByKeys(raw.map((i) => i.id));
      const byKey = new Map(rows.map((r) => [candidateKey(r), r]));
      for (const [ck, items] of creatorResults) {
        creatorResults.set(
          ck,
          items.map((i) => byKey.get(candidateKey(i)) ?? i),
        );
      }
    }
  }

  // 5. Candidates.
  const { candidates, sourceCounts, merged } = generateCandidates({ library, P, filters, canon, creatorResults, pool });

  // 6. Recency.
  const recent = await loadRecentImpressions(store, userId, now);

  // 7. The pure pipeline.
  const { snapshots, context, deferred } = rankPipeline({
    P,
    library,
    prefs,
    candidates,
    filters,
    recent,
    userId,
    now,
    sourceCounts,
    merged,
  });

  // 8. Persist exactly the SPEC §9.1/§9.2 arrays; §9.3 lists what never goes in.
  await store.insertSession({
    user_id: userId,
    kind: opts.kind,
    category: filters.category,
    answers: { filters, context },
    results: snapshots,
  });

  // 9.
  return { snapshots, context, deferred };
}
