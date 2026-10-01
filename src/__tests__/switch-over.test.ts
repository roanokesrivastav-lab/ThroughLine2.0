import { describe, expect, it, vi } from "vitest";
// stage-recommend.ts is a server-only module; the alias is mocked away in tests.
vi.mock("server-only", () => ({}));

import { buildStageRecommendations, readHomeCache, queueDeferredProfiles, toRecommendation } from "@/lib/server/stage-recommend";
import { buildFixtureLibrary } from "@/lib/dev/fixtures";
import { CANON } from "@/lib/catalog/canon-data";
import { canonProfile, canonToResult } from "@/lib/catalog/canon";
import { EMPTY_TASTE_PREFS } from "@/lib/taste/tags";
import { explanationFromSnapshot } from "@/lib/taste/explain";
import { candidateKey } from "@/lib/taste/tags";
import type { RecommendStore } from "@/lib/server/stage-recommend";
import type { MediaItem, Phase } from "@/lib/types";
import type { ProfileRunResult } from "@/lib/server/profiles";

const NOW = new Date("2026-09-25T12:00:00Z");
const LIB = buildFixtureLibrary(NOW.getTime(), { profiles: "canon" });
const CANON_ITEMS: MediaItem[] = CANON.map((c) => {
  const r = canonToResult(c);
  return { ...r, id: `canon:${c.slug}`, feel_prior: r.feel_prior ?? null, profile: canonProfile(c.slug) };
});
const FILTERS = { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 3 };

/** An in-memory store over the fixture library; queries recorded for assertions. */
function makeStore(): RecommendStore & { inserts: Array<{ answers: unknown; results: unknown }> } {
  const inserts: Array<{ answers: unknown; results: unknown }> = [];
  return {
    inserts,
    async loadLibrary() {
      return LIB;
    },
    async loadPrefs() {
      return EMPTY_TASTE_PREFS;
    },
    async loadPhases(): Promise<Phase[]> {
      return [];
    },
    async loadPool() {
      return [];
    },
    async findByKeys() {
      return [];
    },
    async loadSessions() {
      return [];
    },
    async keysForIds() {
      return new Map();
    },
    async insertSession(row) {
      inserts.push({ answers: row.answers, results: row.results });
    },
  };
}

/** A no-op adapter: creator expansion returns nothing, so the canon deck alone is scored. */
const deps = {
  adapterFor: () => ({
    source: "stub", categories: ["movie", "tv", "anime", "book", "music"] as const, available: () => false,
    search: async () => [], byCreator: async () => [],
  }),
  now: () => NOW,
};

describe("toRecommendation (§2.1)", () => {
  it("mirrors every field from the snapshot and strips the item profile", async () => {
    const store = makeStore();
    const { snapshots } = await buildStageRecommendations(store, deps, "u1", FILTERS, { kind: "recommend" });
    expect(snapshots.length).toBeGreaterThan(0);
    for (const s of snapshots) {
      // The pipeline only shows candidates it generated; resolve each key the same way toRecommendation's caller does.
      const source = CANON_ITEMS.find((i) => candidateKey(i) === s.key)
        ?? (LIB.map((e) => e.item).find((i) => candidateKey(i) === s.key) as MediaItem | undefined);
      if (!source) throw new Error(`snapshot key ${s.key} not resolvable in fixture candidates`);
      const rec = toRecommendation(s, source);
      expect(rec.item.id).toBe(source.id);
      expect(rec.item.profile).toBeNull();
      expect(rec.score).toBe(s.score);
      expect(rec.route).toBe(s.route);
      expect(rec.snapshot).toBe(s);
      expect(rec.explanation).toBe(s.explanation);
      expect(rec.fits).toBe(s.explain.fits);
      if (s.entryId) expect(rec.entryId).toBe(s.entryId);
      else expect("entryId" in rec).toBe(false);
    }
  });
});

describe("buildStageRecommendations: explain and cache (§2.2)", () => {
  it("B: an AI string replaces the stored snapshot's explanation; nulls keep the deterministic sentence", async () => {
    const store = makeStore();
    const { snapshots, recommendations } = await buildStageRecommendations(
      store, { ...deps, explain: async (all) => all.map((_, i) => (i === 0 ? "AI one" : null)) }, "u1", FILTERS, { kind: "recommend" },
    );
    expect(snapshots[0].explanation).toBe("AI one");
    for (const s of snapshots.slice(1)) expect(s.explanation).toBe(explanationFromSnapshot(s));
    // The returned recommendations match what was stored.
    expect(store.inserts).toHaveLength(1);
    expect(store.inserts[0].results).toEqual(snapshots);
    expect(recommendations.map((r) => r.snapshot)).toEqual(snapshots);
    expect(recommendations[0].explanation).toBe("AI one");
  });

  it("C: explain absent → every stored explanation is the deterministic sentence", async () => {
    const store = makeStore();
    const { snapshots } = await buildStageRecommendations(store, deps, "u1", FILTERS, { kind: "recommend" });
    expect(snapshots.length).toBeGreaterThan(0);
    for (const s of snapshots) expect(s.explanation).toBe(explanationFromSnapshot(s));
  });

  it("D: with cache the answers are {filters, context, entryCount, full} with profiles stripped; without, exactly {filters, context}", async () => {
    const store = makeStore();
    await buildStageRecommendations(store, deps, "u1", FILTERS, { kind: "home", cache: { entryCount: LIB.length } });
    expect(store.inserts).toHaveLength(1);
    const answers = store.inserts[0].answers as { filters: unknown; context: unknown; entryCount: number; full: Array<{ item: { profile: unknown } }> };
    expect(answers.entryCount).toBe(LIB.length);
    expect(Object.keys(answers).sort()).toEqual(["context", "entryCount", "filters", "full"]);
    for (const row of answers.full) expect(row.item.profile).toBeNull();

    const store2 = makeStore();
    await buildStageRecommendations(store2, deps, "u1", FILTERS, { kind: "recommend" });
    expect(Object.keys(store2.inserts[0].answers as object).sort()).toEqual(["context", "filters"]);
  });
});

describe("readHomeCache (§2.3)", () => {
  const snap = {
    position: 1, key: "canon:x", item: { id: "i", title: "t", category: "movie", creator: null, profile_version: "p1" },
    entryId: null, sources: [], creatorKey: null, features: {}, raw: {}, has_evidence: {}, weights: {}, contributions: {},
    score: 0.5, route: "story", anchor: null, shared: [], explain: { summary: null, quote: null, valued: null, creator: null, phase_label: null, fits: null },
    indicators: {}, rerank: { band: "familiar", closeness: 0.9, pass: 1, bridge_repair: false }, versions: {}, explanation: "s",
  };
  const rec = { item: { id: "i", profile: null }, score: 0.5, route: "story", snapshot: snap, explanation: "s", fits: null };
  const row = { answers: { entryCount: 7, full: [rec] } };

  it("E1: a matching v3 row returns the array", () => {
    expect(readHomeCache(row.answers, 7)).toEqual([rec]);
  });

  it("E2: a wrong entryCount returns null", () => {
    expect(readHomeCache(row.answers, 8)).toBeNull();
  });

  it("E3: a legacy row (old card shape, no snapshot) returns null", () => {
    const legacy = { answers: { entryCount: 7, full: [{ item: { id: "i" }, score: 0.4, route: "tag_overlap", components: [], explanation: "e", fits: null }] } };
    expect(readHomeCache(legacy.answers, 7)).toBeNull();
  });

  it("E4: malformed shapes return null, never a throw", () => {
    for (const answers of [null, undefined, 3, "x", [], {}, { entryCount: 7 }, { entryCount: 7, full: [] }, { entryCount: 7, full: null }, { entryCount: 7, full: [null] }, { entryCount: 7, full: ["x"] }, { entryCount: 7, full: [{ snapshot: null }] }, { entryCount: 7, full: [{ snapshot: 5 }] }]) {
      expect(readHomeCache(answers, 7)).toBeNull();
    }
  });

  it("E5 (P2): rows whose key is in hiddenKeys are filtered out", () => {
    const recY = { ...rec, snapshot: { ...snap, key: "canon:y" } };
    const two = { answers: { entryCount: 7, full: [rec, recY] } };
    expect(readHomeCache(two.answers, 7, new Set(["canon:x"]))).toEqual([recY]);
    expect(readHomeCache(two.answers, 7, new Set(["canon:y"]))).toEqual([rec]);
  });

  it("E6 (P2): hiding every row returns null so Home rebuilds rather than showing nothing", () => {
    expect(readHomeCache(row.answers, 7, new Set(["canon:x"]))).toBeNull();
  });

  it("E7 (P2): no hidden keys behaves exactly as before", () => {
    expect(readHomeCache(row.answers, 7, new Set())).toEqual([rec]);
  });
});

describe("queueDeferredProfiles (§2.2)", () => {
  const items: MediaItem[] = Array.from({ length: 8 }, (_, i) => ({
    id: `tmdb:movie:${100 + i}`, category: "movie", title: `T${i}`, subtitle: null, source: "tmdb",
    external_id: String(100 + i), image_url: null, release_year: 2020, creators: [], genre_tags: [], metadata: {}, feel_prior: null, profile: null,
  }));
  const deferred = items.map((item) => ({ key: item.id, item, entryId: null, sources: ["canon" as const], creatorKey: null }));
  const run = (): ProfileRunResult => ({ considered: 0, canon: 0, profiled: 0, failed: 0, skippedNoProvider: 0, lostClaim: 0, stoppedAtDeadline: false });

  it("F1: 8 deferred → ensure once with 8 items, profileNow with at most 5 ids", async () => {
    const ensure = vi.fn(async (items: MediaItem[]) => ({ materialised: items, needing: items.map((i) => i.id) }));
    let profiledIds: string[] = [];
    const profileNow = vi.fn(async (ids: string[]): Promise<ProfileRunResult> => {
      profiledIds = ids;
      return run();
    });
    await queueDeferredProfiles(deferred, { ensure, profileNow });
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure.mock.calls[0]?.[0]).toHaveLength(8);
    expect(profileNow).toHaveBeenCalledTimes(1);
    expect(profiledIds.length).toBeLessThanOrEqual(5);
  });

  it("F2: ensure throwing is caught and never rethrown", async () => {
    const ensure = vi.fn(async () => { throw new Error("boom"); });
    const profileNow = vi.fn(async (): Promise<ProfileRunResult> => run());
    await expect(queueDeferredProfiles(deferred, { ensure, profileNow })).resolves.toBeUndefined();
    expect(profileNow).not.toHaveBeenCalled();
  });

  it("F3: an empty deferred list makes zero calls", async () => {
    const ensure = vi.fn(async (items: MediaItem[]) => ({ materialised: items, needing: [] }));
    const profileNow = vi.fn(async (): Promise<ProfileRunResult> => run());
    await queueDeferredProfiles([], { ensure, profileNow });
    expect(ensure).not.toHaveBeenCalled();
    expect(profileNow).not.toHaveBeenCalled();
  });
});
