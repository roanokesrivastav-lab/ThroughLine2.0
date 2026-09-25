import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// ensureProfiles materialises through upsertMediaItem; mock only that one function.
vi.mock("@/lib/server/entries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/entries")>()),
  upsertMediaItem: vi.fn(),
}));

import { jsonMode, nvidiaReadingDraft } from "@/lib/ai/nvidia";
import { ProfileValidationError } from "@/lib/ai/profile-contract";
import { mockProfile } from "@/lib/ai/profiler";
import type { ItemProfiler } from "@/lib/ai/profiler";
import { canonProfile } from "@/lib/catalog/canon";
import { CANON_PROFILES } from "@/lib/catalog/canon-profiles";
import { PROFILE_VERSION } from "@/lib/taste/weights";
import { upsertMediaItem } from "@/lib/server/entries";
import {
  PROFILE_CALL_TIMEOUT_MS,
  PROFILE_CRON_LIMIT,
  PROFILE_INLINE_LIMIT,
  PROFILE_LEASE_MS,
  PROFILE_MAX_ATTEMPTS,
  activeProfiler,
  ensureProfiles,
  type ItemProfile,
  type ProfileRow,
  type ProfileRunResult,
  type ProfileStore,
  runPendingProfiles,
} from "@/lib/server/profiles";
import type { MediaItem } from "@/lib/types";

const baseItem = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: "catalog:ext-1", category: "movie", title: "Some Film", subtitle: "A Director", source: "catalog",
  external_id: "ext-1", image_url: null, release_year: 2020,
  creators: [{ name: "A Director", role: "director" }], genre_tags: ["drama"],
  metadata: { overview: "A quiet story about grief." }, feel_prior: null, profile: null,
  ...over,
});

const rowFor = (item: MediaItem, over: Partial<ProfileRow> = {}): ProfileRow => ({
  id: item.id, category: item.category, title: item.title, subtitle: item.subtitle, source: item.source,
  external_id: item.external_id, image_url: item.image_url, release_year: item.release_year,
  creators: item.creators as unknown as ProfileRow["creators"], genre_tags: item.genre_tags,
  metadata: item.metadata as ProfileRow["metadata"],
  profile_status: "pending", profile_version: null, profile_attempts: 0, profiled_at: null,
  ...over,
});

/**
 * In-memory ProfileStore mirroring the Supabase store's contract: array order stands in
 * for `created_at` ordering (oldest first), claim is a compare-and-swap on attempts plus a
 * lease on profiled_at, and loadNeeding hides freshly claimed rows — exactly what the
 * Supabase store does, so the overlap behaviour is exercised offline.
 */
function fakeStore(rows: ProfileRow[], opts: { failClaims?: boolean } = {}) {
  const clock = { now: () => Date.now() };
  const state = {
    claimed: [] as string[],
    done: [] as { id: string; profile: ItemProfile; at: string }[],
    failed: [] as { id: string; error: string }[],
  };
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  const leaseCutoff = () => new Date(clock.now() - PROFILE_LEASE_MS).toISOString();
  const store: ProfileStore = {
    async loadNeeding({ limit, maxAttempts, version, ids }) {
      const cutoff = leaseCutoff();
      return [...byId.values()]
        // Needing: behind on status/version, with the attempts cap scoped to non-done rows.
        .filter((r) => (r.profile_status !== "done" || r.profile_version !== version) && (r.profile_status === "done" || r.profile_attempts < maxAttempts))
        // Not held by a fresh claim lease.
        .filter((r) => !r.profiled_at || r.profiled_at < cutoff)
        .filter((r) => !ids || ids.includes(r.id))
        .slice(0, limit);
    },
    async claim(id, expectedAttempts) {
      if (opts.failClaims) return false;
      const r = byId.get(id);
      if (!r || r.profile_attempts !== expectedAttempts) return false;
      if (r.profile_status === "done" && r.profile_version === PROFILE_VERSION) return false;
      if (r.profiled_at && r.profiled_at >= leaseCutoff()) return false;
      r.profile_attempts = expectedAttempts + 1;
      r.profiled_at = new Date(clock.now()).toISOString();
      state.claimed.push(id);
      return true;
    },
    async markDone(id, profile, at) {
      const r = byId.get(id);
      if (!r) return;
      r.profile_status = "done";
      r.profile_version = PROFILE_VERSION;
      r.profiled_at = at;
      state.done.push({ id, profile, at });
    },
    async markFailed(id, error) {
      const r = byId.get(id);
      if (!r) return;
      r.profile_status = "failed";
      r.profiled_at = null; // the lease is released; the row is retryable
      state.failed.push({ id, error });
    },
  };
  return { store, state, byId, clock };
}

const load = (store: ProfileStore, ids?: string[]) =>
  store.loadNeeding({ limit: 10, maxAttempts: PROFILE_MAX_ATTEMPTS, version: PROFILE_VERSION, ids });

const spyProfiler = (): ItemProfiler & { profile: ReturnType<typeof vi.fn> } => ({
  name: "spy",
  profile: vi.fn(async (item: MediaItem) => mockProfile(item)),
});

const readingDraft = {
  story: { theme: [{ key: "grief", weight: 0.8 }], arc: [], conflict: [], cast: [], bond: [], world: [], setting: [], frame: [], structure: [], momentum: [], stakes: [], ending: [] },
  feeling: { tone: [{ key: "bleak", weight: 0.7 }], register: [], texture: [], aftertaste: [] },
  scalars: { intensity: 0.7 },
  absent: [],
  didnt_work: { keys: [], phrases: [] },
  valued: [],
  summary: "grief and bleakness",
  quote: null,
};

beforeEach(() => {
  vi.mocked(upsertMediaItem).mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("profile queue (Session 4, tests A–L)", () => {
  it("A: a pending non-canon row with a valid profile is marked done and leaves the queue", async () => {
    const item = baseItem();
    const { store, state } = fakeStore([rowFor(item)]);
    const profiler = spyProfiler();
    const result = await runPendingProfiles(store, profiler, { limit: 5 });

    expect(result.profiled).toBe(1);
    expect(result.failed).toBe(0);
    expect(state.done).toHaveLength(1);
    expect(state.done[0]?.id).toBe(item.id);
    expect(state.done[0]?.profile).toEqual(mockProfile(item));
    expect(profiler.profile).toHaveBeenCalledTimes(1);
    expect(await load(store)).toHaveLength(0);
  });

  it("B: a canon row resolves from the committed profile with no model call, even with a null profiler", async () => {
    const slug = Object.keys(CANON_PROFILES)[0] ?? "";
    const committed = canonProfile(slug);
    expect(committed).toBeTruthy();
    if (!committed) return;
    const canonItem = baseItem({ id: `canon:${slug}`, source: "canon", external_id: slug, subtitle: "A Creator", metadata: {} });

    const withProfiler = fakeStore([rowFor(canonItem)]);
    const profiler = spyProfiler();
    const result = await runPendingProfiles(withProfiler.store, profiler, { limit: 5 });
    expect(result.canon).toBe(1);
    expect(result.profiled).toBe(0);
    expect(profiler.profile).not.toHaveBeenCalled();
    expect(withProfiler.state.done[0]?.profile).toEqual(committed);

    const withoutProfiler = fakeStore([rowFor(canonItem)]);
    const resultNoProvider = await runPendingProfiles(withoutProfiler.store, null, { limit: 5 });
    expect(resultNoProvider.canon).toBe(1);
    expect(resultNoProvider.skippedNoProvider).toBe(0);
    expect(withoutProfiler.state.done[0]?.profile).toEqual(committed);
  });

  it("C: a non-canon row with a null profiler is not claimed and stays untouched", async () => {
    const item = baseItem();
    const { store, state, byId } = fakeStore([rowFor(item)]);
    const result = await runPendingProfiles(store, null, { limit: 5 });

    expect(result.skippedNoProvider).toBe(1);
    expect(result.profiled).toBe(0);
    expect(state.claimed).toEqual([]);
    expect(byId.get(item.id)?.profile_attempts).toBe(0);
  });

  it("D: a ProfileValidationError marks failed with a ≤500-char message; after 5 failing runs the row is never loaded again", async () => {
    const item = baseItem();
    const { store, state, byId } = fakeStore([rowFor(item)]);
    const longReason = "x".repeat(600);
    const profiler: ItemProfiler = {
      name: "always-invalid",
      profile: async () => {
        throw new ProfileValidationError([longReason]);
      },
    };

    for (let run = 1; run <= 5; run++) {
      const result = await runPendingProfiles(store, profiler, { limit: 5 });
      expect(result.failed).toBe(1);
      expect(byId.get(item.id)?.profile_attempts).toBe(run);
    }
    expect(state.failed).toHaveLength(5);
    const stored = state.failed[0]?.error ?? "";
    expect(stored.length).toBeLessThanOrEqual(500);
    expect(stored).toContain("profile validation failed");

    const sixth = await runPendingProfiles(store, profiler, { limit: 5 });
    expect(sixth.considered).toBe(0);
    expect(sixth.failed).toBe(0);
    expect(state.failed).toHaveLength(5);
  });

  it("E: a done row with an old profile_version is re-profiled; a done row at the current version is not", async () => {
    const item = baseItem();
    const { store, state } = fakeStore([
      rowFor(item, { profile_status: "done", profile_version: "p0", profile_attempts: PROFILE_MAX_ATTEMPTS }),
      rowFor(baseItem({ id: "catalog:ext-2", external_id: "ext-2", title: "Current" }), { profile_status: "done", profile_version: PROFILE_VERSION, profile_attempts: 1 }),
    ]);
    const profiler = spyProfiler();
    const result = await runPendingProfiles(store, profiler, { limit: 10 });

    expect(result.considered).toBe(1);
    expect(result.profiled).toBe(1);
    expect(state.done).toHaveLength(1);
    expect(state.done[0]?.id).toBe(item.id);
  });

  it("F: a lost claim means no profiler call", async () => {
    const item = baseItem();
    const { store, state } = fakeStore([rowFor(item)], { failClaims: true });
    const profiler = spyProfiler();
    const result = await runPendingProfiles(store, profiler, { limit: 5 });

    expect(result.lostClaim).toBe(1);
    expect(result.profiled).toBe(0);
    expect(profiler.profile).not.toHaveBeenCalled();
    expect(state.claimed).toEqual([]);
  });

  it("G: the deadline stops the loop before a call that could outlive it", async () => {
    const first = baseItem();
    const second = baseItem({ id: "catalog:ext-2", external_id: "ext-2", title: "Second" });
    const { store, state } = fakeStore([rowFor(first), rowFor(second)]);
    // First check passes (0 ≤ 300000 − 120000); from the second row on the clock is past the threshold.
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(200_000);
    const profiler = spyProfiler();
    const result = await runPendingProfiles(store, profiler, { limit: 10, deadlineAt: 300_000, now });

    expect(result.stoppedAtDeadline).toBe(true);
    expect(result.considered).toBe(1);
    expect(result.profiled).toBe(1);
    expect(state.claimed).toEqual([first.id]);
    expect(state.done[0]?.id).toBe(first.id);
  });

  it("H: one row throwing does not stop the loop", async () => {
    const first = baseItem();
    const second = baseItem({ id: "catalog:ext-2", external_id: "ext-2", title: "Second" });
    const { store, state } = fakeStore([rowFor(first), rowFor(second)]);
    let calls = 0;
    const profiler: ItemProfiler = {
      name: "flaky",
      profile: async (item) => {
        calls++;
        if (calls === 1) throw new Error("provider exploded");
        return mockProfile(item);
      },
    };
    const result = await runPendingProfiles(store, profiler, { limit: 10 });

    expect(result.considered).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.profiled).toBe(1);
    expect(state.failed[0]?.id).toBe(first.id);
    expect(state.failed[0]?.error).toContain("provider exploded");
    expect(state.done[0]?.id).toBe(second.id);
  });

  it("I: limit, ids filter and oldest-first order are respected", async () => {
    const a = baseItem({ id: "catalog:a", external_id: "a", title: "A" });
    const b = baseItem({ id: "catalog:b", external_id: "b", title: "B" });
    const c = baseItem({ id: "catalog:c", external_id: "c", title: "C" });
    const { store, state } = fakeStore([rowFor(a), rowFor(b), rowFor(c)]);

    const limited = await runPendingProfiles(store, spyProfiler(), { limit: 2 });
    expect(limited.considered).toBe(2);
    expect(state.claimed).toEqual([a.id, b.id]);

    const onlyC = await runPendingProfiles(store, spyProfiler(), { limit: 5, ids: [c.id] });
    expect(onlyC.considered).toBe(1);
    expect(state.claimed).toEqual([a.id, b.id, c.id]);
  });

  it("J: ensureProfiles materialises items with ':' in the id and reports those needing profiles", async () => {
    const materialisedItem = baseItem({ id: "uuid-1" });
    vi.mocked(upsertMediaItem).mockResolvedValueOnce(materialisedItem);
    const withProfile = baseItem({ id: "uuid-2", external_id: "ext-2" });
    vi.mocked(upsertMediaItem).mockResolvedValueOnce({ ...withProfile, profile: mockProfile(withProfile) });

    const items = [
      baseItem({ id: "catalog:ext-1", external_id: "ext-1" }),
      baseItem({ id: "catalog:ext-2", external_id: "ext-2" }),
      baseItem({ id: "uuid-3", external_id: "ext-3", profile: mockProfile(baseItem({ id: "uuid-3" })) }), // no ':' — already a DB row with a usable profile
    ];
    const { materialised, needing } = await ensureProfiles(items);

    expect(upsertMediaItem).toHaveBeenCalledTimes(2);
    expect(materialised.map((m) => m.id)).toEqual(["uuid-1", "uuid-2"]);
    expect(needing).toEqual(["uuid-1"]);
  });

  it("K: activeProfiler() is null under mock (including nvidia without a key) so no mock profile reaches markDone", () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    expect(activeProfiler()).toBeNull();

    vi.stubEnv("AI_PROVIDER", "nvidia");
    vi.stubEnv("NVIDIA_API_KEY", "");
    expect(activeProfiler()).toBeNull();
  });

  it("L: jsonMode defaults to response_format; 'none' overrides; thinking is off by default and on with =0", async () => {
    expect(jsonMode()).toBe("response_format");
    vi.stubEnv("NVIDIA_JSON_MODE", "none");
    expect(jsonMode()).toBe("none");
    vi.unstubAllEnvs();

    // A fresh Response per call: a Response body can only be read once.
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/chat/completions");
      expect(typeof init?.body).toBe("string");
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(readingDraft) } }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    const input = { note: "A bleak film.", dimensions: {}, category: "movie" as const, title: "Test Film", subtitle: null };

    await nvidiaReadingDraft(input);
    let body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as Record<string, unknown>;
    expect((body.response_format as { type: string } | undefined)?.type).toBe("json_schema");
    expect((body.chat_template_kwargs as { enable_thinking?: boolean } | undefined)?.enable_thinking).toBe(false);

    fetchMock.mockClear();
    vi.stubEnv("NVIDIA_DISABLE_THINKING", "0");
    await nvidiaReadingDraft(input);
    body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as Record<string, unknown>;
    expect(body.chat_template_kwargs).toBeUndefined();
  });

  it("M: a claimed row's lease hides it from a second worker until expiry or release (review round)", async () => {
    const item = baseItem();
    const { store, state, byId, clock } = fakeStore([rowFor(item)]);
    clock.now = () => 1_000_000;

    // Worker A loads and claims, then stalls mid-profile.
    const rowsA = await load(store);
    expect(rowsA).toHaveLength(1);
    const claimed = await store.claim(item.id, rowsA[0]!.profile_attempts);
    expect(claimed).toBe(true);

    // Worker B loads while the lease is fresh: the in-flight row is invisible.
    const rowsB = await load(store);
    expect(rowsB).toHaveLength(0);
    // And a competing claim is refused even with the right attempt count.
    expect(await store.claim(item.id, byId.get(item.id)?.profile_attempts ?? -1)).toBe(false);
    expect(state.claimed).toEqual([item.id]);

    // After PROFILE_LEASE_MS the lease is stale and the row is visible again.
    clock.now = () => 1_000_000 + PROFILE_LEASE_MS + 1;
    expect(await load(store)).toHaveLength(1);

    // markFailed releases the lease immediately (a failed row is retryable at once).
    clock.now = () => 1_000_000;
    await store.markFailed(item.id, "worker A died");
    expect(await load(store)).toHaveLength(1);
    expect(byId.get(item.id)?.profiled_at).toBeNull();
  });

  it("N: an unprofiled canon item is never claimed without a provider and stays eligible for one (review round)", async () => {
    const item = baseItem({ id: "canon:song-all-too-well-10", source: "canon", external_id: "song-all-too-well-10", metadata: {} });
    expect(canonProfile("song-all-too-well-10")).toBeNull();
    const { store, state, byId } = fakeStore([rowFor(item)]);

    // No provider: skipped before claiming, attempts untouched, however many runs.
    for (let i = 0; i < 5; i++) {
      const result = await runPendingProfiles(store, null, { limit: 5 });
      expect(result.skippedNoProvider).toBe(1);
      expect(result.lostClaim).toBe(0);
    }
    expect(state.claimed).toEqual([]);
    expect(byId.get(item.id)?.profile_attempts).toBe(0);

    // A provider configured later still finds the row eligible and profiles it.
    const profiler = spyProfiler();
    const late = await runPendingProfiles(store, profiler, { limit: 5 });
    expect(late.profiled).toBe(1);
    expect(profiler.profile).toHaveBeenCalledTimes(1);
  });

  it("runtime constants match the spec (§2.1)", () => {
    expect(PROFILE_MAX_ATTEMPTS).toBe(5);
    expect(PROFILE_INLINE_LIMIT).toBe(5);
    expect(PROFILE_CRON_LIMIT).toBe(20);
    expect(PROFILE_CALL_TIMEOUT_MS).toBe(120_000);
  });

  it("ProfileRunResult counts every row exactly once across a mixed run", async () => {
    const slug = Object.keys(CANON_PROFILES)[0] ?? "";
    const rows = [
      rowFor(baseItem({ id: `canon:${slug}`, source: "canon", external_id: slug, metadata: {} })), // canon
      rowFor(baseItem({ id: "catalog:b", external_id: "b", title: "B" })), // profiles
      rowFor(baseItem({ id: "catalog:c", external_id: "c", title: "C" })), // fails
    ];
    const { store } = fakeStore(rows);
    let calls = 0;
    const profiler: ItemProfiler = {
      name: "mixed",
      profile: async (item) => {
        calls++;
        if (item.external_id === "c") throw new Error("nope");
        return mockProfile(item);
      },
    };
    const result: ProfileRunResult = await runPendingProfiles(store, profiler, { limit: 10 });
    expect(result).toMatchObject({ considered: 3, canon: 1, profiled: 1, failed: 1, skippedNoProvider: 0, lostClaim: 0, stoppedAtDeadline: false });
    expect(calls).toBe(2);
  });
});
