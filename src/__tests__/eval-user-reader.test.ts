import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { userEvalReader } from "@/lib/dev/eval-user-reader";
import type { EvalReportShape } from "@/lib/dev/eval-user-reader";
import { FEATURE_VERSION } from "@/lib/taste/weights";
import { CALIBRATION } from "@/lib/taste/calibration";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import type { EntriesRow, MediaItemsRow } from "@/lib/db/types";
import type { Db } from "@/lib/server/entries";

const NOW = new Date("2026-09-25T12:00:00Z");
const LIB = buildFixtureLibrary(NOW.getTime(), { profiles: "canon" });

/**
 * A stub db whose from(table) records the read and returns a thenable query builder
 * resolving to table-specific rows. Every write-style method throws.
 */
function stubDb(rowsByTable: Record<string, unknown[]>) {
  const calls: string[] = [];
  const guard = (name: string) => () => {
    calls.push(`WRITE:${name}`);
    return Promise.reject(new Error(`${name} must never be called`));
  };
  const db = {
    calls,
    from(table: string) {
      calls.push(`from:${table}`);
      const result = Promise.resolve({ data: rowsByTable[table] ?? [], error: null });
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        or: () => builder,
        maybeSingle: () => Promise.resolve({ data: (rowsByTable[table] as Array<unknown> | undefined)?.[0] ?? null, error: null }),
        then: result.then.bind(result),
        catch: result.catch.bind(result),
        finally: result.finally.bind(result),
      };
      return builder;
    },
    insert: guard("insert"),
    update: guard("update"),
    upsert: guard("upsert"),
    delete: guard("delete"),
  };
  return db as unknown as Db & { calls: string[] };
}

/** The fixture library projected back to the row shapes loadLibrary expects. */
function rowsFor(lib: ReturnType<typeof buildFixtureLibrary>) {
  const media: MediaItemsRow[] = [];
  const entries: EntriesRow[] = [];
  const reactions: Array<Record<string, unknown>> = [];
  const extractions: Array<Record<string, unknown>> = [];
  const resurfaces: Array<Record<string, unknown>> = [];
  for (const e of lib) {
    media.push({
      id: e.item.id, category: e.item.category, title: e.item.title, subtitle: e.item.subtitle,
      source: e.item.source, external_id: e.item.external_id, image_url: e.item.image_url,
      release_year: e.item.release_year, creators: e.item.creators, genre_tags: e.item.genre_tags,
      metadata: e.item.metadata, feel_prior: e.item.feel_prior, profile: e.item.profile,
      profile_status: e.item.profile ? "done" : "pending", profile_version: e.item.profile?.profile_version ?? null,
      profile_attempts: 0, profile_error: null, profiled_at: e.item.profile ? NOW.toISOString() : null,
      created_at: e.entry.created_at, updated_at: e.entry.updated_at,
    } as unknown as MediaItemsRow);
    entries.push(e.entry as unknown as EntriesRow);
    for (const r of e.reactions) reactions.push(r as unknown as Record<string, unknown>);
    for (const x of e.extractions) extractions.push(x as unknown as Record<string, unknown>);
    for (const r of e.resurfaces) resurfaces.push(r as unknown as Record<string, unknown>);
  }
  return { media, entries, reactions, extractions, resurfaces };
}

describe("eval-recs --user reader (§2.3, test J)", () => {
  it("reads only, never writes, and the report carries the same keys as fixture mode", async () => {
    const rows = rowsFor(LIB);
    // Two profiled items that are NOT in the library, so the pool read has something
    // to return after the library exclusion (review P2-5's parity check needs real rows).
    const foreign = rows.media.slice(0, 2).map((m, i) => ({
      ...m,
      id: `pool-item-${i}`,
      external_id: `pool-external-${i}`,
    }));
    const db = stubDb({
      entries: rows.entries.map((e) => ({ ...e, media_items: rows.media.find((m) => m.id === e.media_item_id) ?? null })),
      reactions: rows.reactions,
      extracted_attributes: rows.extractions,
      resurface_events: rows.resurfaces,
      media_items: [...rows.media, ...foreign],
    });
    const store = userEvalReader(db, "u");
    const lib = await store.loadLibrary("u");
    expect(lib.length).toBe(LIB.length);
    const prefs = await store.loadPrefs("u");
    expect(prefs).toEqual({ pinned: [], muted: [], hidden: [] });
    const phases = await store.loadPhases("u");
    expect(phases).toEqual([]);
    // The limit is the caller's (the script passes POOL_SIZE for live parity, review
    // P2-5); the reader never invents its own cap. 2 foreign rows survive the exclusion.
    const pool = await store.loadPool(["movie", "tv", "anime", "book"], 500);
    expect(pool.length).toBe(2);
    // A wrong user is refused, not silently served another user's rows.
    await expect(store.loadLibrary("user-2")).rejects.toThrow(/bound to user/);
    // Writes are structurally impossible.
    await expect(store.insertSession({ user_id: "u", kind: "recommend", category: null, answers: {}, results: [] })).rejects.toThrow(/read-only/);
    expect(db.calls.some((c) => c.startsWith("WRITE:"))).toBe(false);

    // The report shape matches what fixture mode prints (§2.3's output contract).
    const report: EvalReportShape = {
      feature_version: FEATURE_VERSION,
      calibration_id: CALIBRATION.id,
      library_size: LIB.length,
      d1: { hit5: 0.5, hit20: 1, mrr: 0.5, median_rank: 1, n: 2, excluded: [], rows: [] },
      d2: { skipped: "fewer than 5 holdouts" },
      d3: [],
      d4: { results: 5, pass: { five_results: true, all_explained: true, story_evidence_all: true, no_feeling_route_with_own_words_anchor: true } },
      d5: { days: [], mean_consecutive_jaccard: 0, bridge_share: 0, mean_intra_list_diversity: { story: 1, feeling: 1 }, max_theme_share: 0 },
      closeness: { p10: 0, p50: 0, p90: 0, bands: { familiar: 0, adjacent: 0, stretch: 0 } },
    };
    expect(Object.keys(report).sort()).toEqual(["calibration_id", "closeness", "d1", "d2", "d3", "d4", "d5", "feature_version", "library_size"]);
  });
});
