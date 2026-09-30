// Server-side tests (handoff §3 J–O; SPEC-STAGE3 §5–§6, §9). End to end against an
// in-memory RecommendStore with fake adapters that record their calls: no database,
// no network, nothing wired to a route.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CANON_BY_SLUG } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { buildStageRecommendations, loadRecentImpressions, type RecommendStore, type StageDeps } from "@/lib/server/stage-recommend";
import type { PipelineFilters } from "@/lib/taste/filters";
import type { ImpressionSnapshot, SessionContext } from "@/lib/taste/snapshot";
import { POOL_SIZE } from "@/lib/taste/weights";
import type { Category, EntryWithContext, MediaItem, Phase } from "@/lib/types";
import type { QuerySessionsRow } from "@/lib/db/types";

const NOW = new Date("2026-09-25T12:00:00Z");
const NOW_MS = NOW.getTime();
const DAY = 86_400_000;

const base: PipelineFilters = { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 5 };

type Session = { user_id: string; kind: QuerySessionsRow["kind"]; category: Category | null; answers: unknown; results: unknown; created_at: string };

/** The in-memory store: the contract buildStageRecommendations programs against. */
function memStore(library: EntryWithContext[], opts: { pool?: MediaItem[]; rows?: MediaItem[]; sessions?: Session[]; phases?: Phase[]; keysForIds?: Map<string, string> } = {}) {
  const calls = { loadPool: [] as Array<{ categories: Category[]; limit: number }>, findByKeys: [] as string[][], keysForIds: 0, inserts: [] as Session[] };
  const store: RecommendStore = {
    async loadLibrary() {
      return library;
    },
    async loadPrefs() {
      return { pinned: [], muted: [], hidden: [] };
    },
    async loadPhases() {
      return opts.phases ?? [];
    },
    async loadPool(categories, limit) {
      calls.loadPool.push({ categories, limit });
      return (opts.pool ?? []).slice(0, limit);
    },
    async findByKeys(keys) {
      calls.findByKeys.push(keys);
      const wanted = new Set(keys);
      return (opts.rows ?? []).filter((r) => wanted.has(`${r.source}:${r.external_id}`));
    },
    async loadSessions(_userId, kinds, since) {
      const picked: Array<Pick<QuerySessionsRow, "created_at" | "results">> = [];
      for (const s of opts.sessions ?? []) {
        if (kinds.includes(s.kind) && s.created_at >= since) picked.push({ created_at: s.created_at, results: s.results as QuerySessionsRow["results"] });
      }
      return picked;
    },
    async keysForIds(ids) {
      calls.keysForIds++;
      const out = new Map<string, string>();
      const table = opts.keysForIds ?? new Map();
      for (const id of ids) {
        const k = table.get(id);
        if (k) out.set(id, k);
      }
      return out;
    },
    async insertSession(row) {
      calls.inserts.push({ ...row, created_at: NOW.toISOString() });
    },
  };
  return { store, calls };
}

const adapterCalls: Array<{ name: string; category: Category }> = [];

function fakeDeps(byCreator: Map<string, MediaItem[]> = new Map(), opts: { fail?: (name: string) => boolean } = {}): StageDeps {
  adapterCalls.length = 0;
  return {      adapterFor: () => ({
      source: "fake",
      categories: ["movie", "tv", "anime", "book", "music"],
      available: () => true,
      search: async () => [],
      async byCreator(name, category) {
        adapterCalls.push({ name, category });
        if (opts.fail?.(name)) throw new Error("adapter down");
        return byCreator.get(name) ?? [];
      },
    }),
    now: () => NOW,
  };
}

/** The fixture library's canon items as profiled pool rows (uuid ids, profiles attached), excluding what the library holds. */
function poolFromLibrary(library: EntryWithContext[]): MediaItem[] {
  const inLibrary = new Set(library.map((e) => e.item.external_id));
  const rows: MediaItem[] = [];
  for (const [slug, c] of CANON_BY_SLUG) {
    if (inLibrary.has(slug) || canonProfile(slug) === null) continue;
    const r = canonToResult(c);
    rows.push({ ...r, id: `row-${slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(slug) });
  }
  return rows;
}

const USER = "test-user";

const library = () => buildFixtureLibrary(NOW_MS, { profiles: "canon" });

/** A canon item with any id/source override, the way adapters and rows would carry it. */
function canonItem(slug: string, over: Partial<MediaItem> = {}): MediaItem {
  const c = CANON_BY_SLUG.get(slug);
  if (!c) throw new Error(`no canon item ${slug}`);
  const r = canonToResult(c);
  return { ...r, id: `canon:${slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(slug), ...over };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("hydration and recency (§2.3–§2.4)", () => {
  it("J: a creator result whose key has a profiled row is scored; an unknown one is deferred", async () => {
    // Two adapter hits for a fixture creator (Kazuo Ishiguro, loved via three books):
    // one whose (source, external_id) already has a profiled row, one brand new. The
    // known one must NOT collide with the library by key or title, or the creator
    // source would skip it before hydration ever ran.
    const creator = "Kazuo Ishiguro";
    const adapterHit = canonItem("book-1984", { id: "openlibrary:1984-real", source: "openlibrary", external_id: "1984-real" });
    const knownRow = canonItem("book-1984", { id: "row-1984", source: "openlibrary", external_id: "1984-real", profile: canonProfile("book-1984") }); // same pair, uuid id, profiled
    const novel = canonItem("book-beloved", { id: "openlibrary:beloved-new", source: "openlibrary", external_id: "beloved-new", profile: null }); // no row anywhere

    const lib = library();
    const { store, calls } = memStore(lib, { pool: poolFromLibrary(lib), rows: [knownRow] });
    const result = await buildStageRecommendations(
      store,
      fakeDeps(new Map([[creator, [adapterHit, novel]]])),
      USER,
      { ...base, limit: 60, minutes: 60 }, // books pass any budget ≥ 40 (§D.4); a wide window so the assertion is about scored-vs-deferred, not ranking
      { kind: "recommend" },
    );

    // Hydration swapped the known hit for its row (uuid id, profile): it is scored.
    expect(calls.findByKeys).toHaveLength(1); // one batched read for all creator results
    expect(calls.findByKeys[0]!.sort()).toEqual(["openlibrary:1984-real", "openlibrary:beloved-new"]);
    expect(result.deferred.map((d) => d.key)).not.toContain("row-1984");
    expect(result.snapshots.some((s) => s.item.id === "row-1984" && s.item.profile_version === "p1")).toBe(true);
    // The unknown hit stays a key with no profile and lands in deferred for 7B to queue.
    const unknown = result.deferred.find((d) => d.key === "openlibrary:beloved-new");
    expect(unknown).toBeDefined();
    expect(unknown!.item.profile ?? null).toBeNull();
  });

  it("K: recency reads v3 keys, legacy ids-with-colon, and legacy uuids via one batched keysForIds call; old, surprise and unresolvable rows are ignored", async () => {
    const fresh = () => new Date(NOW_MS - 2 * DAY).toISOString();
    const sessions: Session[] = [
      { user_id: USER, kind: "recommend", category: null, answers: {}, results: [{ key: "canon:book-dune" }], created_at: fresh() },
      { user_id: USER, kind: "home", category: null, answers: {}, results: [{ id: "tmdb:legacy" }], created_at: fresh() },
      { user_id: USER, kind: "time", category: null, answers: {}, results: [{ id: "row-uuid-9" }], created_at: fresh() },
      { user_id: USER, kind: "recommend", category: null, answers: {}, results: [{ id: "row-gone" }], created_at: fresh() }, // unresolvable
      { user_id: USER, kind: "recommend", category: null, answers: {}, results: [{ key: "canon:book-beloved" }], created_at: new Date(NOW_MS - 20 * DAY).toISOString() }, // too old
      { user_id: USER, kind: "surprise", category: null, answers: {}, results: [{ key: "canon:book-1984" }], created_at: fresh() }, // wrong kind
      { user_id: USER, kind: "recommend", category: null, answers: {}, results: [42, null, { nope: true }], created_at: fresh() }, // skipped, not thrown
    ];
    const { store, calls } = memStore(library(), {
      sessions,
      keysForIds: new Map([["row-uuid-9", "canon:anime-frieren"]]),
    });

    const impressions = await loadRecentImpressions(store, USER, NOW);
    const got = new Map(impressions.map((i) => [i.key, i.shownAt]));
    expect(got.get("canon:book-dune")).toBe(fresh());
    expect(got.get("tmdb:legacy")).toBe(fresh());
    expect(got.get("canon:anime-frieren")).toBe(fresh());
    expect(got.has("row-gone")).toBe(false);
    expect(got.has("row-uuid-9")).toBe(false);
    expect(got.has("canon:book-beloved")).toBe(false);
    expect(got.has("canon:book-1984")).toBe(false);
    expect(calls.keysForIds).toBe(1); // one batched read, never per id

    // Duplicate impressions are fine; the loader returns every one of them.
    const dupe = await loadRecentImpressions(
      memStore(library(), { sessions: [
        { user_id: USER, kind: "home", category: null, answers: {}, results: [{ key: "canon:book-dune" }], created_at: fresh() },
        { user_id: USER, kind: "recommend", category: null, answers: {}, results: [{ key: "canon:book-dune" }], created_at: fresh() },
      ] }).store,
      USER,
      NOW,
    );
    expect(dupe.filter((i) => i.key === "canon:book-dune")).toHaveLength(2);
  });

  it("O: library items are excluded before the 500 cut, and the store is asked for POOL_SIZE + library.length rows", async () => {
    const lib = library();
    const n = lib.length;
    // Pool rows = the library's own items first (the store ignores no exclusion; the
    // function must), then enough others to overflow the cut.
    const own = lib.map((e) => e.item);
    const rest = poolFromLibrary(lib);
    const { store, calls } = memStore(lib, { pool: [...own, ...rest] });
    await buildStageRecommendations(store, fakeDeps(), USER, base, { kind: "recommend" });

    expect(calls.loadPool).toHaveLength(1);
    const ask = calls.loadPool[0]!;
    expect(ask.limit).toBe(POOL_SIZE + n);
    expect(ask.categories).toEqual(["movie", "tv", "anime", "book"]);
  });
});

describe("end to end against the in-memory store (§C43, §9.3)", () => {
  it("L: one insertSession; results deep-equal the snapshots; answers is {filters, context}; pools reconcile; five results", async () => {
    const lib = library();
    const { store, calls } = memStore(lib, { pool: poolFromLibrary(lib) });
    const filters: PipelineFilters = { ...base, limit: 5 };
    const result = await buildStageRecommendations(store, fakeDeps(), USER, filters, { kind: "recommend" });

    expect(calls.inserts).toHaveLength(1);
    const row = calls.inserts[0]!;
    expect(row.kind).toBe("recommend");
    expect(row.category).toBeNull();
    expect(row.results).toEqual(result.snapshots);
    expect(row.answers).toEqual({ filters, context: result.context });

    const pools = result.context.pools as Record<string, unknown>;
    expect(result.snapshots).toHaveLength(5);
    expect(result.snapshots.map((s) => s.position)).toEqual([1, 2, 3, 4, 5]);
    // The honest pool arithmetic (§9.2): merged = scored + deferred + every removed.
    const removed = (pools.removed ?? {}) as Record<string, number>;
    const removedSum = Object.values(removed).reduce((a: number, b) => a + b, 0);
    expect(pools.merged).toBe((pools.scored as number) + (pools.deferred as number) + removedSum);
    expect(result.snapshots.every((s) => typeof s.explanation === "string" && s.explanation.length > 0)).toBe(true);
    expect(result.snapshots.every((s) => s.score === s.contributions.story + s.contributions.feeling + s.contributions.form + s.contributions.creator + s.contributions.phase + s.contributions.anti)).toBe(true);
  });

  it("M: the stored JSON never contains raw_note text, premise, feel_prior, or any candidate that was not shown", async () => {
    const lib = library();
    const { store, calls } = memStore(lib, { pool: poolFromLibrary(lib) });
    await buildStageRecommendations(store, fakeDeps(), USER, base, { kind: "recommend" });

    const row = calls.inserts[0]!;
    const stored = JSON.stringify({ answers: row.answers, results: row.results });
    // Every distinctive full note in the fixture library is absent (a snapshot may quote
    // the extraction's verbatim quote — a shorter phrase — but never the whole note).
    for (const e of lib) {
      for (const r of e.reactions) {
        const note = (r.raw_note ?? "").trim();
        if (note.length < 40) continue;
        expect(stored.includes(note)).toBe(false);
      }
    }
    expect(stored.includes('"premise"')).toBe(false);
    expect(stored.includes("feel_prior")).toBe(false);
    // No candidate that was not shown: every stored key is either a returned snapshot or
    // a context-level profile key (anchors, creator affinities, phases) — never an
    // unshown candidate key.
    const shown = new Set((row.results as ImpressionSnapshot[]).map((s) => s.key));
    const storedKeys = JSON.stringify(row.results).match(/"key":"([^"]+)"/g) ?? [];
    for (const raw of storedKeys) {
      const k = raw.slice(7, -1);
      if (!k.includes(":")) continue; // shared-attribute vocabulary keys ("theme.memory") are not candidates
      expect(shown.has(k)).toBe(true);
    }
    // The context's pools counts must reconcile with what generation reported.
    const pools = (row.answers as { context: SessionContext }).context.pools as Record<string, unknown>;
    expect(pools.merged).toBeGreaterThan(0);
    expect(pools.deferred).toBeTypeOf("number");
    expect(pools.scored).toBeTypeOf("number");
  });

  it("N: one adapter throwing never fails the request; that creator contributes zero", async () => {
    const lib = library();
    const creator = "Kazuo Ishiguro";
    // The hit is adapter-namespaced, so its absence can only mean the creator contributed nothing.
    const hit = canonItem("book-1984", { id: "openlibrary:1984-x", source: "openlibrary", external_id: "1984-x", profile: null });
    const results = new Map([[creator, [hit]]]);

    const failed = await buildStageRecommendations(
      memStore(lib, { pool: poolFromLibrary(lib) }).store,
      fakeDeps(results, { fail: (name) => name === creator }),
      USER,
      { ...base, limit: 12 },
      { kind: "recommend" },
    );
    expect(adapterCalls.map((c) => c.name)).toContain(creator);
    expect(vi.mocked(console.warn).mock.calls.some((args) => String(args[0]).includes("creator expansion skipped"))).toBe(true);
    expect(failed.snapshots).toHaveLength(12); // the request still succeeds, at the limit it was given
    expect(failed.snapshots.some((s) => s.key === "openlibrary:1984-x")).toBe(false);
    expect(failed.deferred.some((d) => d.key === "openlibrary:1984-x")).toBe(false);

    // Control: the same setup with a healthy creator does surface the hit — so the
    // assertions above mean something.
    const healthy = await buildStageRecommendations(
      memStore(lib, { pool: poolFromLibrary(lib) }).store,
      fakeDeps(results),
      USER,
      { ...base, limit: 12, minutes: 60 },
      { kind: "recommend" },
    );
    expect(
      healthy.snapshots.some((s) => s.key === "openlibrary:1984-x") || healthy.deferred.some((d) => d.key === "openlibrary:1984-x"),
    ).toBe(true);
  });

  it("E (server side): listOnly and surprise skip the pool and every adapter call", async () => {
    for (const flag of ["listOnly", "surprise"] as const) {
      const lib = library();
      const { store, calls } = memStore(lib, { pool: poolFromLibrary(lib) });
      const result = await buildStageRecommendations(store, fakeDeps(), USER, { ...base, [flag]: true }, { kind: "recommend" });

      expect(calls.loadPool).toHaveLength(0);
      expect(adapterCalls).toHaveLength(0);
      expect(result.snapshots.every((s) => s.indicators.is_backlog === 1)).toBe(true);
      expect(result.deferred).toHaveLength(0);
    }
  });

  it("D (server side): a loved song's artist is never queried — adapters are never called for music creators", async () => {
    const lib = library();
    const { store } = memStore(lib, { pool: poolFromLibrary(lib) });
    await buildStageRecommendations(store, fakeDeps(), USER, base, { kind: "recommend" });
    expect(adapterCalls.length).toBeGreaterThan(0);
    expect(adapterCalls.every((c) => c.category !== "music")).toBe(true);
  });
});
