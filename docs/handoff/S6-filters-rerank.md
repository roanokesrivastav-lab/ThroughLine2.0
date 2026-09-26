# Session 6: Hard filters, re-ranker, and the pure pipeline (handoff for GLM 5.3)

**You implement this session, debug it yourself until every Verify command passes, and do NOT commit.**
The diff goes to review; the founder authorizes the commit.

**Outcome in one sentence:** one pure function takes a profile, a library, preferences, already-generated candidates, filters and recent impressions. It returns the displayed snapshots and the session context, after the fixed nine-step filter (§6), scoring (Session 5), and the band/quota/cap/bridge re-ranker (§7). Everything is deterministic, with no database and no network.

**Still pure and additive.** The live app keeps using the legacy scorer until Session 7. Candidate *generation* (the six sources) and every database read or write are Session 7.

**Prerequisite:** Session 5 is committed (`3074a4a` or later). `git status` should be clean apart from `CLAUDE.md`, `.codex/`, `.freebuff/`, and the reviewer's 2026-09-26 re-verification entry in `docs/STATE.md`. If anything else is uncommitted, **STOP**.

---

## 0. Before you start

Read: `CLAUDE.md` · `docs/PRD.md` §2, §8–§9 · `docs/STATE.md` (last three entries) · `docs/SPEC-STAGE3.md` **§1.7, §6 (all), §7 (all), §8.2, §9.2, §C rows 24–33, 44, 48, §D.4** · `docs/DECISIONS.md` #32, #56, #59, #66–the latest.

Read fully:
- `src/lib/taste/score.ts`: `StageCandidate`, `ScoredCandidate`, `AnchorPick` (`sim` is the *calibrated* best-anchor similarity), `scoreCandidates`, `orderScored`
- `src/lib/taste/explain.ts`: `routeOf`, `anchorOf`
- `src/lib/taste/snapshot.ts`: `buildSnapshot`, `buildContext`, `RerankInfo`, `SessionContext`
- `src/lib/taste/weights.ts`: `BAND`, `QUOTAS`, `CREATOR_CAP`, `RECENCY_DAYS`
- `src/lib/taste/recommend.ts`: **read only**. Study `fitsTime` and the legacy filter block (lines ~146–158) for the `shortRead` semantics.
- `src/lib/taste/tags.ts` (`buildTagProfile`, `isMuted`, `candidateKey`, `TastePrefs`), `src/lib/taste/form.ts` (`minutesToFinish`), `src/lib/taste/affinity.ts` (`usableProfile`)
- `src/lib/dev/fixtures.ts` (`buildFixtureLibrary(now, { profiles: "canon" })`), `src/lib/catalog/canon-data.ts`, `src/lib/catalog/canon.ts`

**Baseline:** `npm run typecheck` · `npm test` · `npx eslint src` · `npm run build`. All must be green; write down the test count. If not, **STOP**.

---

## 1. Scope

| File | Change |
|---|---|
| `src/lib/taste/filters.ts` (**new**, pure) | `PipelineFilters`, `RecentImpression`, `filterCandidates` (§2.1) |
| `src/lib/taste/rerank.ts` (**new**, pure) | `quotasFor`, `closeness`, `bandOf`, `isBridge`, `rerank` (§2.2) |
| `src/lib/taste/pipeline.ts` (**new**, pure) | `rankPipeline`, composing filter → score → order → rerank → snapshots → context (§2.3) |
| `src/lib/taste/snapshot.ts` | Fix `buildContext`: `category_cap` and `theme_cap` must be `ceil(L/2)` for the actual `L`, not a hard-coded 3; accept `limit`. Nothing else changes (§2.4). |
| `src/__tests__/filters.test.ts`, `src/__tests__/rerank.test.ts`, `src/__tests__/pipeline.test.ts` (**new**) | §3 |
| `docs/DECISIONS.md`, `docs/STATE.md` | §4, §5 |

**Out of scope. STOP if you need any of these:**
- Candidate generation, title dedupe, provenance merge, `ensureProfiles` calls, loading `query_sessions`, and any server, route or UI change. All of that is Session 7.
- Changing `score.ts`, `explain.ts`, `weights.ts`, `calibration.ts`, `profile.ts`, `vector.ts`, the legacy `recommend.ts`, or any constant (bands, quotas, caps, `RECENCY_DAYS`).
- MMR or any other re-ranking variant. That's Session 10, offline only.
- Using "not for me" anywhere except the §6 step-4 `hidden` filter (DECISIONS #32).

---

## 2. What to build

### 2.1 `filters.ts`: the fixed nine steps (SPEC §6), in exactly this order
```ts
export type PipelineFilters = {
  category: Category | null; minutes: TimeBudget; listOnly: boolean; returnable: boolean;
  shortRead: boolean; surprise: boolean; limit: number;     // limit ≥ 1: 3 on Home, 5 on Recommend
};
export type RecentImpression = { key: string; shownAt: string };   // ISO. Session 7 loads these from query_sessions
export type RemovedCounts = { category: number; listOnly: number; logged: number; hidden: number; muted: number;
  known: number; time: number; unprofiled: number; recent: number };
export function filterCandidates(args: {
  candidates: StageCandidate[]; library: EntryWithContext[]; prefs: TastePrefs; filters: PipelineFilters;
  recent: RecentImpression[]; now: Date;
}): { kept: StageCandidate[]; deferred: StageCandidate[]; removed: RemovedCounts; recencyRelaxed: boolean }
```
A removed candidate never reaches scoring. The steps:
1. **category**: `item.category === "music"` → removed. If `filters.category` is set and differs → removed.
2. **listOnly**: `filters.listOnly && !entryId` → removed.
3. **logged**: no `entryId`, and `item.id` belongs to any library entry, or `key` equals any library entry's `source:external_id` → removed.
4. **hidden**: `key ∈ prefs.hidden` → removed.
5. **muted**: `isMuted(item.genre_tags, buildTagProfile(library, prefs))` → removed. Build the tag profile once, not per candidate.
6. **known**: a named no-op, reserved for Part 4. It must exist as its own step, always removing 0.
7. **time**: `fitsTime(item, filters.minutes).ok === false` → removed.
   - `shortRead`, keeping the legacy semantics: a non-book is removed; a book whose `minutesToFinish(item)` is known and > 480 is removed; an unknown-length book passes.
   - `returnable`: removed unless the usable profile has `vector.feeling["aftertaste.comforting"] ≥ 0.4` or `vector.feeling["tone.warm"] ≥ 0.4`. **An item with no usable profile passes this check and is deferred at step 8 instead**, so it still gets queued (DECISIONS below).
8. **unprofiled**: `usableProfile(item) === null` → removed from `kept` and **added to `deferred`**. `removed.unprofiled` counts them.
9. **recent**: a candidate whose `key` has a `RecentImpression` with `shownAt ≥ now − RECENCY_DAYS` (14) days is set aside.
   - If the kept list is then shorter than `filters.limit`, re-admit set-aside candidates in order of **oldest most-recent impression first** (ties by key) until it reaches `limit` or the set-aside list is empty, and set `recencyRelaxed = true`.
   - `removed.recent` = set aside minus re-admitted.

`kept` keeps its input order. Each count equals exactly the number that step removed.

### 2.2 `rerank.ts` (SPEC §7)
```ts
export function quotasFor(L: number): { familiar: number; adjacent: number; stretch: number }
// QUOTAS[L] for 1–5; for L ≥ 6: adjacent = round(0.2·L), stretch = max(1, round(0.1·L)), familiar = L − adjacent − stretch
export function closeness(s: ScoredCandidate): number
// 0.5·(s.anchors.story?.sim ?? 0) + 0.5·(s.anchors.feeling?.sim ?? 0). These are the calibrated anchor maxima Session 5 already computed; don't recompute them.
export function bandOf(c: number): "familiar" | "adjacent" | "stretch"   // ≥ BAND.familiar → familiar; ≥ BAND.adjacent → adjacent; else stretch
export function isBridge(s: ScoredCandidate, filters: Filters): boolean
// anchor = anchorOf(s, routeOf(s, filters)); true iff anchor exists and anchor.anchor.category ≠ s.candidate.item.category
export function rerank(ordered: ScoredCandidate[], filters: PipelineFilters): {
  out: Array<{ scored: ScoredCandidate; rerank: RerankInfo }>;
  policy: { quotas: ReturnType<typeof quotasFor>; quota_unfilled: Array<"familiar" | "adjacent" | "stretch">; caps_relaxed: Array<"theme" | "category"> };
}
```
The input `ordered` is already in `orderScored` order (§7 input). `L = filters.limit`.

**Caps:**
- **Creator:** at most `CREATOR_CAP` (2) results per non-null `creatorKey`. **Never relaxed.**
- **Category:** only when `filters.category === null`, at most `ceil(L/2)` per category.
- **Theme:** `themes(x)` = story keys starting `theme.` with `vector.story[k] ≥ 0.5`. At most `ceil(L/2)` results may share any one theme key.

**The passes:**
- **Pass 1:** for each x, if `quota[band] > 0` and x is admissible, add it and decrement `quota[band]`. After this pass, `quota_unfilled` = the bands whose quota is still > 0.
- **Pass 2:** for each x not yet added, while `|out| < L`, add it if admissible.
- **Pass 3, first round:** relax the theme cap, then run a full pass.
- **Pass 3, second round:** relax the category cap too, then run another full pass.
- `caps_relaxed` lists a cap **only if relaxing it actually admitted at least one candidate** (DECISIONS below).
- Every pass stops when `|out| = L`. A short list stays short; nothing is invented.

**Bridge repair:** only if no result in `out` is a bridge and some scored candidate is one.
- `b` = the first bridge candidate in `ordered` that is not in `out` and for which the creator cap holds against the current `out`.
- The victim is the last element of `out` with the same band as `b`, or else the last element of `out`.
- Replace the victim with `b`. `b` gets `pass: 3, bridge_repair: true`.
- This still applies when `L = 1`.

**Output:** re-sort `out` by `score` descending, then `key` ascending (§7.4, including in surprise mode). Each entry gets `RerankInfo { band, closeness, pass, bridge_repair }`.

### 2.3 `pipeline.ts`: the whole pure path
```ts
export function rankPipeline(args: {
  P: UserProfile; library: EntryWithContext[]; prefs: TastePrefs; candidates: StageCandidate[];
  filters: PipelineFilters; recent: RecentImpression[]; userId: string; now: Date;
  sourceCounts: Record<Source, number>; merged: number;      // from Session 7 candidate generation; tests pass fixtures
}): { snapshots: ImpressionSnapshot[]; context: SessionContext; deferred: StageCandidate[] }
```
The steps, in order:
1. `filterCandidates`.
2. `scoreCandidates(P, kept)`. Its `deferred` must be empty here, because step 8 already removed the unprofiled; if it isn't, throw.
3. `orderScored(scored, { surprise, userId })`.
4. `rerank`.
5. For each output row, in display order, compute the explanation inputs **with the Session 5 helpers**, then call `buildSnapshot` with its committed signature:
   - `route = routeOf(scored, filters)`
   - `anchor = anchorOf(scored, route)`
   - `shared = sharedFor(scored, route, anchor)`
   - `anchorEntry` = the library entry whose `entry.id === anchor?.anchor.entryId`, or null
   - `phaseLabel = route === "phase" ? P.activePhase?.label ?? null : null`
   - `fits = fitsTime(item, filters.minutes).note`
   - then `buildSnapshot({ position: i + 1, scored, library, filters, fits, rerank, route, anchor, shared, anchorEntry, phaseLabel })`

   Don't change `buildSnapshot` to compute these itself. The pipeline is its intended caller (STATE 2026-09-26 review note).
6. `buildContext`, with:
   - `limit`
   - `pools` = `{ ...sourceCounts, merged, removed, deferred: deferred.length, scored: scored.length }`
   - `policy` = `{ quotas, quota_unfilled, recency_relaxed, caps_relaxed, surprise }`

Return `deferred` so Session 7 can pass it to `ensureProfiles`.

### 2.4 `buildContext` fix (`snapshot.ts`)
Add `limit` to its args. Set `thresholds.category_cap = thresholds.theme_cap = Math.ceil(limit / 2)`. Session 5 hard-coded 3, which is wrong for Home (`L = 3` → 2). Update only the Session 5 test that pinned the old value, if one did.

---

## 3. Tests (offline, deterministic; use a fixed `NOW`, `buildFixtureLibrary(NOW, { profiles: "canon" })`, and candidates built in-test from non-music `CANON` items with `canonProfile`)

| # | Spec §C | Test |
|---|---|---|
| A | 24 | A crafted candidate set with one target per step: each of the nine steps removes exactly its target, `removed` matches exactly, `known` is always 0, and the order is fixed (a candidate that is both music and hidden is counted under `category`, not `hidden`) |
| B | 25 | Every candidate is recently shown → `limit` results are still returned, `recency_relaxed = true`, and the re-admitted ones are the oldest impressions first |
| C | 26 | No music candidate ever reaches scoring; a music backlog entry is removed at step 1 |
| D | — | `shortRead`: film removed; a 600-page book removed; an unknown-length book kept. `returnable`: a profiled item without the keys is removed; an **unprofiled** item goes to `deferred`, not `time` |
| E | 27 | `L = 5` with enough candidates in every band → 3 familiar, 1 adjacent, 1 stretch. `L = 3` → 2 / 0 / 1. `quotasFor(6..10)` follow the formula |
| F | 28 | No stretch candidate → `quota_unfilled = ["stretch"]` and the slot is filled in pass 2 |
| G | 29 | Six candidates by one creator at the top → at most 2 in `out`, even when that leaves the list short |
| H | 30 | One category only, no category filter → the category cap relaxes in pass 3 and `caps_relaxed` lists exactly the caps that admitted someone |
| I | 31 | Four top candidates sharing `theme.grief ≥ 0.5` → at most 3 in a list of 5 (`ceil(5/2) = 3`) |
| J | 32 | No bridge in `out` but one lower down → it replaces the last same-band result, and that row has `bridge_repair: true`. No bridge candidate anywhere → no repair and no error |
| K | 33 | Two runs give identical output; permuting the input candidate order gives identical output (because the order comes from `orderScored`) |
| L | 48 | `L = 1` → one result, familiar when available, and bridge repair still applies |
| M | 44 / D.4 | **Cold start:** a library of 10 canon "loved" taps with no notes; candidates = every other non-music canon item. `rankPipeline` with `limit: 5` → 5 results; every result has `has_evidence.story = true` and `indicators.own_words = 0`; every result's explanation is non-empty; each context `pools.removed` count equals what the filter reported |
| N | — | **Pipeline integrity:** for the fixture library, every snapshot's `score === snapshotTotal(s)`; positions are 1..n; the context has `thresholds.category_cap = ceil(L/2)` and `recency_days = 14`; and `deferred` holds exactly the unprofiled candidates |
| O | — | Surprise mode: scores in the snapshots are identical to the non-surprise run; only selection order may differ; `policy.surprise = true` |

All existing tests stay green and **unedited**, except the single §2.4 assertion if Session 5 pinned the cap at 3.

---

## 4. DECISIONS to append (continue from the last number)
- **`returnable` defers unprofiled items instead of removing them.** §6 step 7 reads profile keys, but step 8 is where unprofiled items are queued. Removing them at step 7 would mean they're never profiled during returnable-filtered requests.
- **`shortRead` keeps the legacy semantics** (non-books removed; books over 480 minutes removed; unknown length kept), because §6 says "existing rules, unchanged".
- **`caps_relaxed` lists a cap only if relaxing it admitted a candidate.** §C 30 says "as applicable".
- **A bridge-repaired row records `pass: 3, bridge_repair: true`.** Repair happens after the passes, and the pass field has no other value for it.
- **Home and Recommend caps come from `ceil(L/2)` at the real `L`.** This fixes Session 5's hard-coded 3 in the context.

## 5. STATE entry
`## <date> — Session 6: filters + re-rank + pure pipeline (GLM, uncommitted)`. Include:
- Built / Verified (paste the real outputs).
- "AI-verified only; no database, no network, nothing phone-verified; the live app still uses the legacy scorer".
- **Next:** Session 7 (six candidate sources with provenance and title dedupe, `recent` loaded from `query_sessions` with the legacy `id` fallback, `ensureProfiles` on `deferred`, persistence of `results`/`answers.context`, the explainer and rec-card on snapshots, and deleting the legacy scorer).

## 6. Debug loop
Tests first → `filters.ts` → `rerank.ts` → `pipeline.ts` → the `buildContext` fix → loop `npm test` → `npm run typecheck`, `npx eslint src`, `npm run build`. No `@ts-ignore`, `eslint-disable`, `any`, or weakened assertions. If an assertion and the spec disagree, the spec wins. If the spec is ambiguous, that's a STOP.

Finally:
- `git diff --stat` must list only §1 files.
- `git diff --check` must be clean.

## 7. STOP conditions
- Session 5 is uncommitted, or the baseline is red.
- An existing test needs editing (other than the §2.4 cap assertion).
- A rule needs a constant change or a Session 5 function change beyond §2.4.
- You need a file outside §1.

## 8. Acceptance (reviewer checklist)
- [ ] The nine steps run in the §6 order; `known` is a named no-op; the counts are exact.
- [ ] Unprofiled items are always deferred, never scored and never dropped silently.
- [ ] The creator cap is never relaxed; theme is relaxed before category; `caps_relaxed` is honest.
- [ ] Bridge repair follows §7.4 exactly; `L = 1` is covered.
- [ ] Output is deterministic and independent of the input order; surprise never changes a stored score.
- [ ] The context caps equal `ceil(L/2)`; recency is 14 days.
- [ ] Tests A–O pass; the previous tests are unchanged apart from §2.4.
