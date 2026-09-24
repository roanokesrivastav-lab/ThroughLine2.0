# Session 4: Profile runtime (handoff for GLM 5.3)

**You implement this session, debug it yourself until every Verify command passes, and do NOT commit.**
The diff goes to review; the founder authorizes the commit.

**Outcome in one sentence:** catalogue items get their profiles through a bounded, idempotent, retrying queue. It runs after a log, after an onboarding tap, and in the daily cron. Canon items get their committed profile for free, and nothing is ever written that isn't a real, strictly validated profile.

**Prerequisite:** Session 3 (with Amendment 1) is reviewed and committed. `src/lib/catalog/canon-profiles.ts` holds 109 profiles and `canonProfile(slug)` exists. If `git status` shows Session 3 files still uncommitted, **STOP**.

**Founder rulings for this session (2026-09-23):**
1. **Profile on log.** After a new item is saved (log or onboarding), profile it in the background. For catalogue sources, this happens *after* metadata enrichment finishes.
2. **No live database writes in this session.** The queue is built and tested offline only. The first live run, which profiles the 24 existing items, belongs to Session 9 with the founder present. Don't run the cron, `npm run dev` against live data, or any script that touches Supabase.
3. **Generic-key prevalence is a known limitation (Session 3 QA), not something to address here.** Don't touch prompts, schemas, or `PROFILE_VERSION`.

---

## 0. Before you start

Read: `CLAUDE.md` · `docs/PRD.md` §8–§9 · `docs/STATE.md` (last three entries) · `docs/SPEC-STAGE3.md` §1.2, §6 step 8, §B rows 18 and 23, §E Q7 · `docs/DECISIONS.md` #4, #6, #35, #46, #59, #66–#77.

Read fully:
- `src/lib/server/extraction.ts`: the existing queue pattern (`queueExtraction`, `runPendingExtractions`). Mirror its shape.
- `src/lib/server/entries.ts`: `upsertMediaItem`, `enrichMediaItem`, `rowToItem`, and `Db`.
- `src/lib/supabase/admin.ts`: `supabaseAdmin`, `adminConfigured`.
- `src/app/api/cron/daily/route.ts`, `src/app/api/entries/route.ts` (POST), and `src/app/api/onboarding/route.ts`.
- `src/lib/ai/item-profiler.ts` (`getProfiler`, `profilerFor`), `src/lib/ai/extractor.ts` (`aiProvider`), `src/lib/ai/nvidia.ts` (`jsonMode`, thinking toggle), `src/lib/ai/profile-contract.ts` (`ProfileValidationError`).
- `src/lib/catalog/canon.ts` (`canonProfile`) and `src/lib/db/types.ts` (`MediaItemsRow`).

**Baseline:** `npm run typecheck` · `npm test` · `npx eslint src` · `npm run build`. All must be green; write down the test count. If not, **STOP**.

---

## 1. Scope

| File | Change |
|---|---|
| `src/lib/server/profiles.ts` (**new**, `server-only`) | Queue logic, store interface, Supabase store, `ensureProfiles`, `profileItemsNow`, `runPendingProfiles` (§2.1–§2.4) |
| `src/app/api/cron/daily/route.ts` | Profile pass with a deadline, before the per-user loop; `maxDuration`; profiles counted in the JSON response (§2.5) |
| `src/app/api/entries/route.ts` | POST: chain enrich, then profile, in one `after()` (§2.6) |
| `src/app/api/onboarding/route.ts` | Profile the tapped item in the existing `after()` (§2.6) |
| `src/lib/ai/nvidia.ts` | Default the JSON mode to the probe winner (§2.7) |
| `.env.example` | Document `NVIDIA_JSON_MODE` / `NVIDIA_DISABLE_THINKING` and their defaults (§2.7) |
| `src/__tests__/profile-queue.test.ts` (**new**) | §3 |
| `src/__tests__/nvidia-drafts.test.ts` | Update **only** the assertions that pinned the old `"none"` default (§2.7) |
| `docs/DECISIONS.md`, `docs/STATE.md` | §4, §5 |

**Out of scope. STOP if you need any of these:**
- Migrations, or any change to `db/types.ts` (no schema change is needed: `pending|done|failed` plus the attempts compare-and-swap in §2.2 cover everything).
- The recommender (`recommend.ts`, `server/recommend.ts`). `ensureProfiles` is built and tested here, and wired into recommendations in Session 7.
- `demo.ts`, `fixtures.ts`, prompts, schemas, `PROFILE_VERSION`, canon profiles.
- Any live Supabase call, including "just to check".
- Persisting a mock profile (DECISIONS #72) or `feel_prior`-derived data as a profile.

---

## 2. What to build

### 2.1 Constants (top of `profiles.ts`, exported)
```ts
export const PROFILE_MAX_ATTEMPTS = 5;         // SPEC §6 step 8 ("attempts < 5")
export const PROFILE_INLINE_LIMIT = 5;         // SPEC §6 step 8 / §E Q7
export const PROFILE_CRON_LIMIT = 20;          // SPEC §6 step 8 / §E Q7
export const PROFILE_CALL_TIMEOUT_MS = 120_000; // matches nvidia.ts complete()
```
These are runtime limits, not features. They don't go in `weights.ts` and don't affect `FEATURE_VERSION`.

### 2.2 Storage behind a small interface, so the logic is testable without a database
```ts
export type ProfileRow = Pick<MediaItemsRow, "id" | "category" | "title" | "subtitle" | "source" | "external_id" | "image_url"
  | "release_year" | "creators" | "genre_tags" | "metadata" | "profile_status" | "profile_version" | "profile_attempts">;

export interface ProfileStore {
  /** Rows needing a profile: (status ≠ 'done' OR profile_version ≠ current) AND attempts < max, ids limited to `ids` when given, oldest first. */
  loadNeeding(opts: { limit: number; maxAttempts: number; version: string; ids?: string[] }): Promise<ProfileRow[]>;
  /** Compare-and-swap claim: attempts := expected + 1 only if attempts still = expected and the row still needs a profile. Returns false if another worker got there first. */
  claim(id: string, expectedAttempts: number): Promise<boolean>;
  markDone(id: string, profile: ItemProfile, at: string): Promise<void>;   // status done, profile, profile_version, profiled_at, profile_error null
  markFailed(id: string, error: string): Promise<void>;                    // status failed, profile_error ≤ 500 chars; attempts were already bumped by claim
}
export function supabaseProfileStore(db: Db): ProfileStore
```
- The Supabase store must use the **service-role** client (`supabaseAdmin()`). `media_items` has no client write policy (DECISIONS #4), and it must never be called with a user's RLS client.
- `loadNeeding` query shape: `.from("media_items").select(<ProfileRow columns>).or("profile_status.neq.done,profile_version.neq.<v>").lt("profile_attempts", max).order("created_at").limit(n)`, plus `.in("id", ids)` when ids are given. Never `select("*")` into logs.
- `claim`: `.update({ profile_attempts: expected + 1 }).eq("id", id).eq("profile_attempts", expected).select("id")` → `data.length === 1`. This is the only concurrency guard. It stops the cron and a post-log run from paying twice for the same item.

### 2.3 Resolving one row
```ts
async function resolveProfile(item: MediaItem, profiler: ItemProfiler | null): Promise<{ profile: ItemProfile; source: "canon" | "model" } | { skip: "no-provider" }>
```
1. If `item.source === "canon"` and `canonProfile(item.external_id)` exists: return it as `source: "canon"`. **No model call, and it works even when the provider is mock.**
2. Else if `profiler === null` (the provider is mock, or unconfigured): `{ skip: "no-provider" }`. The row stays untouched and isn't claimed (DECISIONS #72).
3. Else `await profiler.profile(item)`. It either returns a strictly validated profile or throws.

Export `activeProfiler(): ItemProfiler | null` = `aiProvider() === "mock" ? null : getProfiler()`. The cron and `profileItemsNow` both use it.

### 2.4 The three entry points
```ts
export async function runPendingProfiles(store: ProfileStore, profiler: ItemProfiler | null,
  opts: { limit: number; deadlineAt?: number; ids?: string[]; now?: () => number }): Promise<ProfileRunResult>
// ProfileRunResult = { considered, canon, profiled, failed, skippedNoProvider, lostClaim, stoppedAtDeadline: boolean }
```
For each row, in order:
- If `deadlineAt` is set and `now() > deadlineAt − PROFILE_CALL_TIMEOUT_MS`, stop and set `stoppedAtDeadline`. **Don't start a call that could outlive the function.**
- **The order matters, so claiming always comes before any model call:**
  1. A non-canon row with `profiler === null` → count `skippedNoProvider`, don't claim, continue.
  2. `claim`. If it's lost → count `lostClaim` and continue, with no profiler call.
  3. `resolveProfile`, then `markDone`, or `markFailed` if it throws (the error message, trimmed to 500 characters).
- One row failing never stops the loop.
- Sequential, one item at a time.

```ts
export async function profileItemsNow(ids: string[]): Promise<ProfileRunResult>
// supabaseProfileStore(supabaseAdmin()), limit = min(ids.length, PROFILE_INLINE_LIMIT), ids = ids. Swallows and logs errors; never throws into after().

export async function ensureProfiles(items: MediaItem[]): Promise<{ materialised: MediaItem[]; needing: string[] }>
// For Session 7. Materialise every item whose id contains ":" via upsertMediaItem (existing profile columns are preserved: the upsert doesn't list them).
// Return the ids whose profile isn't usable (status ≠ done or version ≠ current). No model calls here. It's tested in this session but not wired.
```

### 2.5 Cron (`/api/cron/daily`)
- `export const maxDuration = 300;`. Add a comment that it must be checked against the Vercel plan at deploy time.
- Right after the auth checks, and **before** `runPendingExtractions`:
  `const profiles = await runPendingProfiles(supabaseProfileStore(admin), activeProfiler(), { limit: PROFILE_CRON_LIMIT, deadlineAt: start + 150_000 })`
  (`start = Date.now()` at the top of the handler).
- Include `profiles` in the JSON response. Nothing else in the cron changes.

### 2.6 Profile on log (founder ruling 1)
- **`entries` POST:** replace the enrichment `after()` with one `after(async () => { if (non-manual) await enrichMediaItem(item.id, result); await profileItemsNow([mediaItemId]); })`.
  - Manual items are profiled without enrichment; they're profiled from title, creators and book kind only (SPEC §1.2).
  - When the request supplied an existing `media_item_id` instead of a result, still call `profileItemsNow([mediaItemId])`. The store only picks it if it needs a profile.
  - The existing extraction/phase `after()` stays as it is.
- **`onboarding` POST:** in the existing `after()`, and also for non-"loved" answers that created an entry, call `profileItemsNow([item.id])`. Canon items resolve from the committed file with no call.
- A save must never wait on, or fail because of, profiling.

### 2.7 JSON-mode default (fixes a Session 3 finding)
In `nvidia.ts`:
- `jsonMode()` defaults to `"response_format"` when `NVIDIA_JSON_MODE` is unset.
- Thinking is disabled for the profile and reading calls unless `NVIDIA_DISABLE_THINKING=0`.
- The env vars remain overrides; `NVIDIA_JSON_MODE=none` restores the old behaviour.

This makes a deployed server without those env vars use the constrained mode the probe proved (`docs/qa/nvidia-constrained-probe.md`).

Document both variables in `.env.example`. In `nvidia-drafts.test.ts`, change only the assertions about the unset default. Every other test stays as it is.

---

## 3. Tests (`profile-queue.test.ts`; offline, with an in-memory `ProfileStore` defined in the test file, `vi.mock("server-only", () => ({}))`, and fake profilers)

| # | Test |
|---|---|
| A | A pending non-canon row with the fake profiler returning a valid profile → `markDone` called once, `profiled: 1`, and the row is no longer returned by `loadNeeding` |
| B | A canon row whose slug has a committed profile → done with **that exact profile**, and the profiler **is not called**, even when the profiler is `null` |
| C | Profiler `null` with a non-canon row → not claimed, attempts unchanged, `skippedNoProvider: 1` |
| D | The profiler throws `ProfileValidationError` → `markFailed` with a message ≤ 500 characters, attempts +1; after 5 failing runs the row is never loaded again |
| E | A done row with `profile_version: "p0"` is re-profiled; a done row with the current version is not |
| F | Lost claim: the store's `claim` returns false → no profiler call, `lostClaim: 1` |
| G | Deadline: `now()` past `deadlineAt − 120000` before row 2 → exactly 1 processed, `stoppedAtDeadline: true` |
| H | One row throws and the next succeeds → both processed, and the loop continues |
| I | `limit` respected; `ids` filter respected; order is oldest first |
| J | `ensureProfiles`: an item with `:` in its id is materialised (use a mocked `upsertMediaItem`); ids needing profiles are returned; no profiler call |
| K | `activeProfiler()` returns `null` under `AI_PROVIDER=mock` (and with `AI_PROVIDER=nvidia` but no key), so a mock profile can't reach `markDone` |
| L | `jsonMode()` defaults to `"response_format"`; `NVIDIA_JSON_MODE=none` overrides it; thinking is off by default and on with `NVIDIA_DISABLE_THINKING=0` |

Route wiring (cron, entries, onboarding) is checked by typecheck, build, and the reviewer reading the diff. Don't try to unit-test Next's `after()`.

---

## 4. DECISIONS to append (continue from the last number; expected #78+)
- **Profile queue claims by attempts compare-and-swap.** There's no new status value and no migration; a lost claim is skipped. This prevents double spend when the cron and a post-log run overlap.
- **Canon rows resolve from the committed canon profiles with no model call, even without a provider.** Mock-provider runs leave non-canon rows untouched and unclaimed (#72).
- **Profile on log (founder, 2026-09-23).** Runs after metadata enrichment, in the same `after()`, bounded by `PROFILE_INLINE_LIMIT`. The cron profiles up to 20 per run with a 150 s start-deadline under `maxDuration = 300`. That's tighter than the spec's bare "20 per run", because NVIDIA p95 latency is ~80 s (Session 3 QA).
- **NVIDIA JSON mode defaults to `response_format` with thinking off** for profile/reading calls, per the Amendment 1 probe. Env vars override it.

## 5. STATE entry
`## <date> — Session 4: profile runtime (GLM, uncommitted)`. Include:
- Built (one line per file) and Verified (paste the real final outputs).
- "AI-verified only. No live database call; nothing phone-verified."
- **Next:** Session 5 (pure scorer + snapshots; switch fixtures to canon profiles). Session 9 performs the first live profiling run of the 24 existing items with the founder present. At that point, check that canon-source rows resolve with no model calls.

## 6. Debug loop
Write the tests → implement §2.1–§2.4 → loop `npm test` → wire §2.5–§2.7 → `npm run typecheck`, `npx eslint src`, `npm run build` → fix everything. No `@ts-ignore`, `eslint-disable`, `any`, or weakened assertions.

Finally:
- `git diff --stat` must list only §1 files.
- `git diff --check` must be clean.
- `git grep -n "supabaseAdmin" src/app` must show no new use outside the cron route and `profiles.ts`.

## 7. STOP conditions
- Session 3 isn't committed, or the baseline is red.
- An existing test needs editing, other than the §2.7 default assertions.
- A schema or migration change appears necessary.
- Anything requires a live Supabase or model call.

## 8. Acceptance (reviewer checklist)
- [ ] Only §1 files changed; no migration; `db/types.ts` untouched.
- [ ] Every write to `media_items` in `profiles.ts` goes through the service-role client; user RLS clients are never passed to the store.
- [ ] No path persists a mock profile; canon rows need zero model calls.
- [ ] A save response never awaits profiling.
- [ ] The cron can't start a model call within 120 s of its deadline.
- [ ] Tests A–L pass; the previous tests are unchanged apart from the §2.7 default assertions.
