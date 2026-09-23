# Session 3: Canon profiles + profiling/extraction QA (handoff for GLM 5.3)

**You implement this session, debug it yourself until every Verify command passes, run the live steps within the budget below, and do NOT commit.**
The diff and the QA reports go to review next. The founder hand-checks a sample and then authorizes the commit.

**Outcome in one sentence:** every canon title has a real NVIDIA-written `ItemProfile`, committed as generated code so tests stay model-free. Reports show whether those profiles, and v2 note readings, are well-distributed and stable across repeated runs.

**Founder rulings for this session (2026-09-22). These are settled; don't reopen them:**
- **Live calls are authorized.** Provider is NVIDIA (the configured `NVIDIA_MODEL`). There is a **hard cap of 500 model calls in total across every script in this session**, retries included. The cap is enforced in code, not by being careful.
- **Repeatability notes are the demo seed notes only** (`src/lib/server/demo-seeds.ts`). No live database access. No real user notes.
- **QA thresholds are the defaults in §2.1.** They are reported as PASS/FAIL. A FAIL is a finding to report, not something to fix by tuning.

---

## 0. Before you start

Read: `CLAUDE.md` · `docs/PRD.md` §8–§9 · `docs/STATE.md` (last three entries) · `docs/SPEC-STAGE3.md` §1.2, §B rows 17 and 27, §E Q8 · `docs/DECISIONS.md` #49, #50, #52, #53, #66–#72 · `docs/handoff/S2-profiler-contract.md` (what Session 2 built).

Read fully, because you will call into them:
- `src/lib/ai/profile-contract.ts`: `ProfileDraftSchema`, `ProfileDraft`, `buildItemProfile`, `ProfileValidationError`, `PROFILE_SYSTEM_PROMPT`, `profilerInput`
- `src/lib/ai/nvidia.ts`: private `complete()`/`json()`, `nvidiaProfiler()`, `nvidiaExtractor()`, `nvidiaModel()`
- `src/lib/ai/reading.ts`: `ReadingSchema`, `finalizeReading`, `READING_SYSTEM_PROMPT`
- `src/lib/catalog/canon-data.ts` (110 items: 24 movie, 20 tv, 18 anime, 23 book, 25 music; **no overviews**) and `src/lib/catalog/canon.ts` (`canonToResult`)
- `src/lib/server/demo-seeds.ts` (`SEEDS`: 35 notes, each with a canon `slug`)
- `src/lib/taste/vocabulary.ts`, `src/lib/taste/form.ts`, `src/lib/taste/vector.ts`

**Baseline:** `npm run typecheck` · `npm test` (**168/168**) · `npx eslint src` · `npm run build`. All must be green. If not, **STOP**. `git status` should show only `CLAUDE.md`, `.codex/`, `.freebuff/`. Don't touch or stage those.

**Scripts and `server-only`:** `nvidia.ts` imports `server-only`, which throws under plain Node. Every script therefore runs as:
`node --conditions=react-server --env-file=.env.local --import tsx scripts/<name>.ts`
(the `react-server` condition makes `server-only` a no-op). Put that exact form into the npm scripts in §1.

---

## 1. Scope

### Files you may create or change (nothing else)

| File | Change |
|---|---|
| `src/lib/taste/qa.ts` (**new**, pure) | QA metrics and thresholds (§2.1) |
| `src/lib/dev/profiling-run.ts` (**new**, Node-only dev tooling) | `CallLedger` budget, `withRetries`, cache read/write (§2.2) |
| `src/lib/dev/canon-profiles-render.ts` (**new**, pure) | `renderCanonProfilesModule` (§2.3) |
| `src/lib/ai/profile-contract.ts` | **Refactor only:** export `PROFILE_CAPS` and have `ProfileDraftSchema` use it (§2.1). No rule changes. |
| `src/lib/ai/nvidia.ts` | Add `nvidiaReadingDraft(input)` (the pre-`finalizeReading` parse) and make `nvidiaExtractor` call it. Behaviour must be identical. Add `nvidiaProfileDraft(item)` (the parsed `ProfileDraft` before building) and make `nvidiaProfiler` call it. |
| `src/lib/catalog/canon-profiles.ts` (**new, generated**) | Written only by `scripts/profile-canon.ts` (§2.3) |
| `src/lib/catalog/canon.ts` | Add `canonProfile(slug): ItemProfile \| null`, reading `CANON_PROFILES` |
| `scripts/profile-canon.ts` (**new**) | §2.4 |
| `scripts/profile-report.ts` (**new**) | §2.5 |
| `scripts/repeat-eval.ts` (**new**) | §2.6 |
| `package.json` | **`scripts` only:** `profile:canon`, `qa:profiles`, `qa:repeat`. No dependency changes. |
| `.gitignore` | Add `scripts/out/` |
| `docs/qa/canon-profiles-report.md` + `.json`, `docs/qa/canon-review.md`, `docs/qa/repeatability-report.md` + `.json` (**generated**) | Produced by the scripts, never hand-edited |
| `src/__tests__/qa.test.ts`, `src/__tests__/profiling-run.test.ts`, `src/__tests__/canon-profiles.test.ts` (**new**) | §3 |
| `docs/DECISIONS.md`, `docs/STATE.md` | §4, §5 |

### Out of scope. If you need any of this, STOP and report
- Any Supabase import, read or write, from any script or file in this session.
- Changing `PROFILE_SYSTEM_PROMPT`, `READING_SYSTEM_PROMPT`, `ProfileDraftSchema`, `ReadingSchema`, `buildItemProfile`, `PROFILE_VERSION`, `VOCABULARY_VERSION` or any vocabulary list (the only exception is the behaviour-identical `PROFILE_CAPS` refactor above). **This includes changing them to make a threshold pass.**
- Switching `dev/fixtures.ts` or any test fixture to the canon profiles. That happens in Session 5.
- Server runtime: `ensureProfiles`, cron, queue (Session 4), and anything in the recommender.
- Claude calls, and using the mock profiler's output in `canon-profiles.ts` (DECISIONS #72).
- Any user data. Only canon catalogue data and demo seed notes may be sent to NVIDIA.

---

## 2. What to build

### 2.1 `src/lib/taste/qa.ts` (pure, no I/O)

```ts
export const QA_THRESHOLDS = {           // founder-approved defaults, 2026-09-22
  firstPassStrict: 0.90,                 // share of canon items whose FIRST attempt validated strictly
  committedStrict: 1.00,                 // share of committed profiles that validate strictly (by construction)
  agreementStory: 0.50,                  // mean pairwise weighted Jaccard across repeat runs
  agreementFeeling: 0.50,
  scalarMae: 0.15,                       // mean absolute scalar difference across repeat runs
  prevalenceFlag: 0.50,                  // a key present in > 50% of profiles is flagged for review
} as const;

export function weightedJaccard(u: Record<string, number>, v: Record<string, number>): number | null
// Σ min / Σ max over the union of keys. Returns null when BOTH are empty (that pair is excluded from means), and 0 when exactly one is empty.
export function topKOverlap(u, v, k = 5): number | null     // |topK(u) ∩ topK(v)| / k, ties broken by key; null when both are empty
export function scalarMae(a: Record<string, number>, b: Record<string, number>, keys: readonly string[]): number | null
// mean |a−b| over keys defined on BOTH sides; null when none are
export function setJaccard(a: string[], b: string[]): number | null         // null when both are empty
export function pairwise<T>(runs: T[]): Array<[T, T]>                        // all unordered pairs, stable order

export type PrevalenceRow = { key: string; family: "story" | "feeling"; global: number; byCategory: Partial<Record<Category, number>> };
export function prevalence(profiles: Array<{ category: Category; profile: ItemProfile }>): PrevalenceRow[]
// share of profiles whose vector[F] contains the key; sorted by global desc, then key
export function categoryArtifacts(rows: PrevalenceRow[]): PrevalenceRow[]
// key with ≥ 0.60 in one category and ≤ 0.10 in every other category that has ≥ 5 profiles (report-only)
export function groupFill(profiles): Array<{ group: string; meanCount: number; cap: number; shareAtCap: number }>
export function evaluate(metrics: { firstPassStrict: number; committedStrict: number; agreementStory: number | null; agreementFeeling: number | null; scalarMae: number | null; maxPrevalence: number }):
  Array<{ name: keyof typeof QA_THRESHOLDS; value: number | null; threshold: number; pass: boolean | null }>
// agreement: pass iff value ≥ threshold. scalarMae: pass iff value ≤ threshold.
// prevalenceFlag: pass iff maxPrevalence ≤ threshold. A null value gives pass: null ("not measurable"), never a silent pass.
```
Group caps come from the §1.2 caps. Right now they exist only as `.max(n)` calls inside `ProfileDraftSchema`. Add an exported `PROFILE_CAPS` constant to `profile-contract.ts`, make the schema read its `.max()` values from it (behaviour identical; the Session 2 tests must stay green), and import it here.

### 2.2 `src/lib/dev/profiling-run.ts` (Node dev tooling; never imported by app code)

- `class CallLedger` over the append-only JSONL file `scripts/out/calls.jsonl`.
  - The constructor reads the existing lines, so **the 500 cap spans every script run in this session**.
  - `take(meta)` throws `BudgetExceededError` *before* a call when `used >= max`.
  - `record({ script, id, attempt, ok, ms, error? })` appends one line.
  - `max` defaults to **500**. A `--max-calls` flag may only *lower* it.
  - Never write the API key or request bodies to the ledger.
- `withRetries(fn, { retries: 2, backoffMs: [5000, 15000], ledger, meta })`: at most 3 attempts in total. Every attempt calls `ledger.take` first, so every attempt counts. `BudgetExceededError` propagates immediately and is never retried. Returns `{ value, attempts }` or throws the last error with `attempts` attached.
- The cache lives at `scripts/out/canon/<slug>.json`:
  ```json
  { "slug", "provider", "model", "profile_version", "prompt_hash", "attempts", "first_attempt_ok", "draft": <ProfileDraft|null>, "error": <string|null>, "finished_at" }
  ```
  `prompt_hash` = first 12 hex characters of the sha256 of `PROFILE_SYSTEM_PROMPT`. A cache entry is reusable only when `provider`, `model`, `profile_version` and `prompt_hash` all match the current values.
- `promptHash(text)` and `readCache`/`writeCache` helpers. JSON is written with sorted keys and a trailing newline.

### 2.3 `canon-profiles-render.ts` and the generated `canon-profiles.ts`

```ts
export function renderCanonProfilesModule(
  entries: Array<{ slug: string; profile: ItemProfile }>,
  meta: { provider: string; model: string; profileVersion: string; vocabularyVersion: string; promptHash: string; generatedAt: string; total: number; failed: string[] },
): string
```
- The output starts with `// GENERATED by scripts/profile-canon.ts — do not edit by hand.` followed by one comment line per meta field, including the failed slugs.
- Then `import type { ItemProfile } from "@/lib/types";` and `export const CANON_PROFILES: Readonly<Record<string, ItemProfile>> = <JSON>;`
- The JSON has slugs sorted, object keys sorted recursively, and array order preserved (the builder already orders arrays), with 2-space indent and a trailing newline.
- **Deterministic:** the same entries in any order give a byte-identical string.
- `generatedAt` is passed in, so tests can fix it.

Before the first live run, the script writes the module with zero entries, so `canonProfile()` and the integrity test typecheck. `canonProfile(slug)` returns `CANON_PROFILES[slug] ?? null`.

### 2.4 `scripts/profile-canon.ts`

Flags:
- `--dry-run`: print `profilerInput()` for the first 3 canon items. No calls, no ledger lines.
- `--only a,b`: slugs to profile.
- `--max-calls N`: can only lower the cap.
- `--no-resume`: ignore the cache.
- `--write-only`: rebuild `canon-profiles.ts` from the cache and make no calls.

Steps:
1. Refuse to run unless `aiProvider() === "nvidia"`. Print the provider and the model, never the key.
2. For each `CanonItem` in `CANON` order: `item = { ...canonToResult(c), id: "canon:" + slug, feel_prior: null }`. `feel_prior` is nulled so it can't reach the model even by accident; `profilerInput` already omits it.
3. If the cache is reusable, skip the item. Otherwise `withRetries(() => nvidiaProfileDraft(item))`, then check it with `buildItemProfile(item, draft, { attributeSource: "ai", completeness: "strict" })`.
   - A `ProfileValidationError` counts as a failed attempt and is retried.
   - Record `first_attempt_ok`.
   - Write the cache entry after **every** item, successful or not, so a crash loses nothing.
4. Go sequentially, one call at a time. Print one line per item: `slug · attempts · ok|FAILED · ms`.
5. At the end, and also on `BudgetExceededError`: rebuild every reusable cache entry that has a draft with `buildItemProfile(..., strict)`, then write `src/lib/catalog/canon-profiles.ts` through the renderer. Failed and unreached slugs go in `meta.failed`. Profiles are always rebuilt from drafts, so the committed file reflects the current builder exactly.
6. Exit non-zero if the budget stopped the run. The report script still works on partial data.

### 2.5 `scripts/profile-report.ts` (no model calls)

This reads `CANON_PROFILES`, `CANON` and the cache, and writes three files.

**`docs/qa/canon-profiles-report.md` + `.json`**
- Header: model, `PROFILE_VERSION`, prompt hash, and the date.
- Counts per category: profiled / failed / unreached.
- `firstPassStrict` and `committedStrict`.
- Failure reasons, grouped and counted, from cache errors.
- Prevalence: the top 30 keys globally with per-category shares, every key above `prevalenceFlag` marked **REVIEW**, the `categoryArtifacts` rows, and the number of singleton keys (present in exactly 1 profile).
- `groupFill`.
- Mean confidence per family.
- Premise: the share that is null, and the praise-guard drop count (draft premise non-null but profile premise null on a non-manual item).
- Music reported separately, because music isn't matched.
- A note that canon profiles come from title, creator, year and genres only (canon has no overviews), so they rely on the model's knowledge of the work.

**`docs/qa/canon-review.md`**, the founder's hand-review sheet. The sample is the **first 4 canon items of each category in `CANON` order** (20 items). For each item, show:
- title, category, creator, year
- premise
- story keys with vector values: top 8, but **omit every `ending.*` key** because they're spoilers (DECISIONS #52)
- feeling keys: top 6
- band and craft
- then: `Verdict: ☐ right ☐ partly ☐ wrong` and `Notes:` lines, left blank

The `.json` report also carries the `evaluate()` rows that can be computed here (the agreement rows are null until `repeat-eval` runs).

### 2.6 `scripts/repeat-eval.ts` (live, budgeted)

**A. Profiles.** Use the same 20 review-sample slugs. Run 1 is the **committed** canon draft from the cache, reused and free. Runs 2 and 3 are fresh `nvidiaProfileDraft` calls through `withRetries` with `retries: 0`, so a failed run is recorded as a validity failure rather than retried. That's 40 calls.

For each item and each successful pair of runs, compute:
- `weightedJaccard` per family
- `topKOverlap` per family
- `scalarMae` over all five scalars

Report per-item rows plus means. Also report per-run strict validity.

**B. Readings.** For each of the 35 demo seed notes, build `ExtractionInput` from the seed's canon item (category, title, subtitle; dimensions `{}`). Make 3 runs of `nvidiaReadingDraft` → `finalizeReading`. That's 105 calls, with no retries.

For each note and pair, compute:
- `weightedJaccard` per family on `readingToVector` output (pairs where both are empty are excluded, and their count is reported)
- `scalarMae`
- `setJaccard` on `absent`
- `setJaccard` on `didnt_work.keys` keys
- **verbatim guard drops**: count the `valued` / `didnt_work.phrases` / `quote` items in the raw draft that `finalizeReading` removed, as a share of all such items
- schema-failure rate

**Output.** Write `docs/qa/repeatability-report.md` + `.json`, including the `evaluate()` PASS/FAIL table. That table combines this run's agreement and MAE values with `firstPassStrict`, `committedStrict` and `maxPrevalence` read from `canon-profiles-report.json`. `agreementStory`/`agreementFeeling`/`scalarMae` use the **profile** means (A). The reading means (B) are reported alongside, and are diagnostic only. Latency p50/p95 and the timeout count come from the ledger.

Budget arithmetic: 110 canon + retries (~20–60) + 40 + 105 ≈ 275–315. The cap of 500 leaves headroom. If the ledger runs out mid-repeat, the report is still written from what completed, marked **PARTIAL**.

---

## 3. Tests (offline; any network access is a bug)

| # | File | Test |
|---|---|---|
| A | qa | `weightedJaccard`: identical → 1; disjoint → 0; both empty → null; one empty → 0; a worked example computed by hand |
| B | qa | `topKOverlap` ties broken by key; `scalarMae` ignores one-sided keys and returns null when none are shared; `setJaccard` both empty → null |
| C | qa | `prevalence` on 3 hand-built profiles gives the exact shares and ordering; `categoryArtifacts` flags the constructed artifact and ignores categories with < 5 profiles |
| D | qa | `evaluate`: boundary values (0.50 passes agreement; 0.15 passes MAE; 0.50 prevalence passes, 0.51 fails); null → `pass: null` |
| E | profiling-run | `CallLedger` on a temp file: it stops at max *before* the call, persists across two instances (the second sees the first's count), and `--max-calls` above 500 is clamped to 500 |
| F | profiling-run | `withRetries`: succeeds on attempt 3; gives up after 3 with `attempts: 3`; every attempt is recorded; `BudgetExceededError` is not retried |
| G | profiling-run | Cache reuse only when provider/model/profile_version/prompt_hash all match; `promptHash` is stable |
| H | render | Byte-identical output for shuffled input; the header lists the failed slugs; the embedded JSON parses back deep-equal to the input |
| I | canon-profiles | **Integrity of the committed file** (this runs over the real generated file, so it passes with 0 entries too). Every slug exists in `CANON`; `profile_version === PROFILE_VERSION` and `vocabulary_version === "v2"`; every story/feeling key has the right `familyOf`; the vector is non-negative and each value is ≤ 1; each vector entry equals `round4(w×c)` of its attribute and is ≥ 0.05; exactly 1 `stakes.*` and 1 `ending.*`; all five scalars present; `form.band === band(category, minutesToFinish(item))`; music AI confidences ≤ 0.5; craft keys pass `isCraftKey`; premise ≤ 400 characters |
| J | nvidia (existing `profiler.test.ts` or new) | `nvidiaReadingDraft` + `finalizeReading` equals the old `nvidiaExtractor` result on a stubbed response; `nvidiaProfileDraft` feeds `nvidiaProfiler` identically. Use a stubbed `fetch` and `vi.mock("server-only", () => ({}))` |

All 168 existing tests must stay green and **unedited**.

---

## 4. DECISIONS to append (numbers continue from #72)

- **73.** QA thresholds for Stage 3 profiling are the founder-approved defaults in `qa.ts` `QA_THRESHOLDS`. They are reported, not enforced. A FAIL goes to the founder rather than being tuned away inside a session, because prompt and schema changes would need a `PROFILE_VERSION` decision.
- **74.** The canon profiles in `canon-profiles.ts` are generated by NVIDIA `<model>` under `p1`/`v2` from catalogue data only (no overviews exist in canon). Items that still fail strict validation after 2 retries are left out and listed in the file header. They are rebuilt from cached drafts through `buildItemProfile`, so the file always matches the current builder.
- **75.** Repeatability run 1 reuses the committed canon draft, and runs 2 and 3 are fresh with no retries. Pairs where both sides are empty are excluded from agreement means and counted. The readings repeatability is diagnostic only; the PASS/FAIL agreement rows use profiles.
- **76.** Dev scripts that reach AI adapters run with `node --conditions=react-server` so `server-only` is a no-op outside Next. They're never imported by app code.

Fill in the real model name in #74.

---

## 5. STATE entry to append

Title: `## <date> — Session 3: canon profiles + QA (GLM, uncommitted)`. Include:
- **Built:** one line per file.
- **Live runs:** the exact commands, calls used out of 500 (from the ledger), wall time, profiled/failed per category.
- **QA:** paste the `evaluate()` PASS/FAIL table, the top 10 prevalence rows, and every **REVIEW** flag.
- **Verified:** the real final output of the four commands. Say "AI-verified only; no database access; nothing phone-verified".
- **Founder gate:** "Hand-review `docs/qa/canon-review.md` (20 items) and accept or reject the QA results before commit."
- **Deviations / STOPs.**
- **Next:** Session 4 (profile runtime) and Session 5 (switch fixtures to canon profiles; pure scorer).

---

## 6. Run order and debug loop

1. Write the §3 tests. Implement §2.1 → §2.2 → §2.3 → the `nvidia.ts` refactor → the scripts. Loop until `npm test`, `npm run typecheck`, `npx eslint src` and `npm run build` are all green. Never use `@ts-ignore`, `eslint-disable`, `any`, or weakened assertions.
2. `npm run profile:canon -- --dry-run`: read the 3 inputs and confirm there's no `feel_prior`, encounter weight or image in them.
3. **Smoke run:** `npm run profile:canon -- --only movie-spirited-away,book-the-hobbit` (2–6 calls). Open both cache files and the generated module. If both failed, or the output looks structurally wrong, **STOP** and report with the errors. Don't start the full run.
4. **Full run:** `npm run profile:canon`. If NVIDIA stalls or errors, re-running resumes from the cache. Don't raise the cap.
5. `npm run qa:profiles`, then `npm run qa:repeat`, then `npm run qa:profiles` again (so its JSON has final numbers).
6. Re-run all four Verify commands. Test I now checks the real file. `git diff --check` must be clean, and `git status` must show only §1 files (the ignored `scripts/out/` is not listed).
7. Write the DECISIONS and STATE entries with the real numbers.

## 7. STOP conditions (report; do not improvise)
- The baseline wasn't green, or an existing test needs editing.
- The smoke run fails on both items, or more than 30% of the first 20 full-run items fail validation. Stop the run and report the reasons.
- A threshold FAILs. Finish all the reports, then report. Don't edit prompts or schemas.
- Something requires touching a file outside §1, the database, or any user data.
- The ledger shows more than 500 calls. That's a bug; stop immediately.

## 8. Acceptance (what the reviewer will check)
- [ ] Only §1 files changed; `package.json` differs only in `scripts`; no Supabase import anywhere new.
- [ ] `scripts/out/calls.jsonl` line count ≤ 500, and every line is free of keys and request bodies.
- [ ] `canon-profiles.ts` is byte-identical when regenerated with `--write-only` (determinism).
- [ ] Test I passes over the real file, and all 168 existing tests are untouched and green.
- [ ] The review sheet omits every `ending.*` key.
- [ ] The reports exist, match the JSON, and show the PASS/FAIL table honestly (null = not measurable, not pass).
- [ ] DECISIONS #73–#76 and the STATE entry are present; nothing is marked phone-verified.
