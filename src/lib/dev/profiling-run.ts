// Dev tooling for the profiling/QA scripts (Session 3 §2.2). Node-only: never imported by
// app code, never shipped to the client. Holds the session-wide call budget, the retry
// wrapper, and the on-disk draft cache.
//
// The ledger never stores API keys or request bodies — only script/id/attempt/ok/ms/error.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const HARD_CALL_CAP = 500;
export const LEDGER_PATH = "scripts/out/calls.jsonl";
export const CACHE_DIR = "scripts/out/canon";

export class BudgetExceededError extends Error {
  constructor(public used: number, public max: number) {
    super(`Call budget exhausted: ${used} calls used of ${max}`);
    this.name = "BudgetExceededError";
  }
}

export type LedgerMeta = { script: string; id: string };
export type LedgerEntry = LedgerMeta & { attempt: number; ok: boolean; ms: number; error?: string };

export class CallLedger {
  #used: number;
  readonly file: string;
  readonly max: number;

  constructor(file = LEDGER_PATH, requestedMax = HARD_CALL_CAP) {
    this.file = file;
    // The 500-call cap is a hard ceiling; a --max-calls flag may only lower it.
    this.max = Math.min(requestedMax, HARD_CALL_CAP);
    this.#used = 0;
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (line.trim()) this.#used++;
      }
    } else {
      mkdirSync(dirname(file), { recursive: true });
    }
  }

  get used(): number {
    return this.#used;
  }

  /** Count one upcoming call. Throws before the call happens when the budget is spent. */
  take(): number {
    if (this.#used >= this.max) throw new BudgetExceededError(this.#used, this.max);
    const attemptNumber = this.#used + 1;
    this.#used++;
    return attemptNumber;
  }

  /** Append one completed-call line. Never store keys or request bodies here. */
  record(entry: LedgerEntry): void {
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
  }
}

export type RetryOptions = {
  retries: number;
  backoffMs: number[];
  ledger: CallLedger;
  meta: LedgerMeta;
};

/**
 * At most retries + 1 attempts in total. Every attempt calls ledger.take first, so every
 * attempt counts against the budget. BudgetExceededError propagates immediately and is
 * never retried. Returns { value, attempts } or throws the last error with attempts attached.
 */
export async function withRetries<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<{ value: T; attempts: number }> {
  const total = opts.retries + 1;
  let lastError: (Error & { attempts?: number }) | undefined;
  for (let attempt = 1; attempt <= total; attempt++) {
    opts.ledger.take();
    const started = Date.now();
    try {
      const value = await fn();
      opts.ledger.record({ ...opts.meta, attempt, ok: true, ms: Date.now() - started });
      return { value, attempts: attempt };
    } catch (error) {
      const ms = Date.now() - started;
      if (error instanceof BudgetExceededError) throw error;
      lastError = error as Error & { attempts?: number };
      opts.ledger.record({ ...opts.meta, attempt, ok: false, ms, error: (error as Error).message?.slice(0, 300) });
      if (attempt < total) {
        const backoff = opts.backoffMs[attempt - 1] ?? 0;
        if (backoff > 0) await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  lastError!.attempts = total;
  throw lastError!;
}

// ---------------------------------------------------------------------------
// Draft cache: scripts/out/canon/<slug>.json
// ---------------------------------------------------------------------------

export type CacheEntry = {
  slug: string;
  provider: string;
  model: string;
  profile_version: string;
  prompt_hash: string;
  attempts: number;
  first_attempt_ok: boolean;
  draft: unknown | null;
  error: string | null;
  finished_at: string;
};

export type CacheIdentity = { provider: string; model: string; profileVersion: string; promptHash: string };

/** First 12 hex characters of the sha256 of the prompt. */
export function promptHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
};

/** Sorted keys, 2-space indent, trailing newline — so cache and generated files are diff-stable. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

export function readCache(cacheDir: string, slug: string, identity: CacheIdentity): CacheEntry | null {
  const file = join(cacheDir, `${slug}.json`);
  if (!existsSync(file)) return null;
  let entry: CacheEntry;
  try {
    entry = JSON.parse(readFileSync(file, "utf8")) as CacheEntry;
  } catch {
    return null;
  }
  const reusable =
    entry.provider === identity.provider &&
    entry.model === identity.model &&
    entry.profile_version === identity.profileVersion &&
    entry.prompt_hash === identity.promptHash &&
    entry.draft != null;
  return reusable ? entry : null;
}

export function writeCache(cacheDir: string, entry: CacheEntry): void {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, `${entry.slug}.json`), stableJson(entry));
}
