import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BudgetExceededError, CallLedger, promptHash, readCache, withRetries, writeCache } from "@/lib/dev/profiling-run";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "profiling-run-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("CallLedger (test E)", () => {
  it("stops before the call when the budget is spent, and persists across instances", () => {
    const file = join(dir, "calls.jsonl");
    const first = new CallLedger(file, 2);
    first.take();
    first.record({ script: "test", id: "a", attempt: 1, ok: true, ms: 5 });
    first.take();
    first.record({ script: "test", id: "b", attempt: 1, ok: true, ms: 5 });

    // A new instance sees the first's two calls.
    const second = new CallLedger(file, 2);
    expect(() => second.take()).toThrow(BudgetExceededError);

    // And the file really holds two lines.
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
    expect(existsSync(file)).toBe(true);
  });

  it("a --max-calls value above 500 is clamped to 500; below 500 is honoured", () => {
    const file = join(dir, "calls.jsonl");
    const clamped = new CallLedger(file, 900);
    expect(clamped.max).toBe(500);
    const lowered = new CallLedger(file, 3);
    expect(lowered.max).toBe(3);
  });

  it("records ok and error lines without keys or request bodies", () => {
    const file = join(dir, "calls.jsonl");
    const ledger = new CallLedger(file, 10);
    ledger.take();
    ledger.record({ script: "s", id: "x", attempt: 1, ok: false, ms: 12, error: "NVIDIA API 500" });
    const line = JSON.parse(readFileSync(file, "utf8").trim());
    expect(line).toMatchObject({ script: "s", id: "x", attempt: 1, ok: false, ms: 12, error: "NVIDIA API 500" });
    expect(JSON.stringify(line)).not.toContain("sk-");
    expect(JSON.stringify(line)).not.toContain("messages");
  });
});

describe("withRetries (test F)", () => {
  it("succeeds on attempt 3 and records every attempt", async () => {
    const ledger = new CallLedger(join(dir, "calls.jsonl"), 10);
    let calls = 0;
    const { value, attempts } = await withRetries(
      async () => {
        calls++;
        if (calls < 3) throw new Error("flaky");
        return 42;
      },
      { retries: 2, backoffMs: [0, 0], ledger, meta: { script: "t", id: "j1" } },
    );
    expect(value).toBe(42);
    expect(attempts).toBe(3);
    expect(calls).toBe(3);
    // take+record per attempt: 3 budget entries consumed.
    const ledger2 = new CallLedger(join(dir, "calls.jsonl"), 10);
    expect(ledger2.used).toBe(3);
  });

  it("gives up after 3 attempts with attempts attached", async () => {
    const ledger = new CallLedger(join(dir, "calls.jsonl"), 10);
    const error = await withRetries(
      async () => { throw new Error("always fails"); },
      { retries: 2, backoffMs: [0, 0], ledger, meta: { script: "t", id: "j2" } },
    ).catch((e: Error & { attempts?: number }) => e);
    expect((error as Error).message).toContain("always fails");
    expect((error as { attempts?: number }).attempts).toBe(3);
  });

  it("BudgetExceededError propagates immediately and is never retried", async () => {
    const ledger = new CallLedger(join(dir, "calls.jsonl"), 1);
    ledger.take(); // budget now exhausted
    let calls = 0;
    await expect(
      withRetries(
        async () => { calls++; return 1; },
        { retries: 2, backoffMs: [0, 0], ledger, meta: { script: "t", id: "j3" } },
      ),
    ).rejects.toThrow(BudgetExceededError);
    expect(calls).toBe(0); // take() threw before fn ran
  });
});

describe("cache (test G)", () => {
  const base = {
    slug: "movie-test",
    provider: "nvidia",
    model: "m1",
    profile_version: "p1",
    prompt_hash: "abcdef012345",
  };

  it("reuses an entry only when provider, model, profile_version and prompt_hash all match", () => {
    writeCache(dir, { ...base, attempts: 1, first_attempt_ok: true, draft: { premise: null }, error: null, finished_at: "2026-09-22T00:00:00Z" });
    expect(readCache(dir, "movie-test", { provider: "nvidia", model: "m1", profileVersion: "p1", promptHash: "abcdef012345" })).not.toBeNull();
    expect(readCache(dir, "movie-test", { provider: "nvidia", model: "m2", profileVersion: "p1", promptHash: "abcdef012345" })).toBeNull();
    expect(readCache(dir, "movie-test", { provider: "nvidia", model: "m1", profileVersion: "p2", promptHash: "abcdef012345" })).toBeNull();
    expect(readCache(dir, "movie-test", { provider: "nvidia", model: "m1", profileVersion: "p1", promptHash: "ffffffffffff" })).toBeNull();
  });

  it("returns null for a missing or draft-less entry", () => {
    expect(readCache(dir, "nope", { provider: "nvidia", model: "m1", profileVersion: "p1", promptHash: "abcdef012345" })).toBeNull();
    writeCache(dir, { ...base, slug: "empty", attempts: 3, first_attempt_ok: false, draft: null, error: "bad", finished_at: "x" });
    expect(existsSync(join(dir, "empty.json"))).toBe(true);
    expect(readCache(dir, "empty", { provider: "nvidia", model: "m1", profileVersion: "p1", promptHash: "abcdef012345" })).toBeNull();
  });

  it("promptHash is stable and 12 hex characters", () => {
    expect(promptHash("hello")).toBe(promptHash("hello"));
    expect(promptHash("hello")).not.toBe(promptHash("goodbye"));
    expect(promptHash("hello")).toMatch(/^[0-9a-f]{12}$/);
  });
});
