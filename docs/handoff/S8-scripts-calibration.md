# Session 8: Evaluation harness, debugging script, and the first calibration (handoff for GLM)

**You implement this session, debug it yourself until every Verify command passes, and do NOT commit.**
The diff goes to review; the founder authorizes the commit.

**Outcome in one sentence:** the engine gets a measuring stick and its first real calibration.
- A pure evaluation module (SPEC §D) and three scripts measure and explain recommendations on the fixture library.
- `scripts/calibrate.mts` replaces the provisional calibration constants with ones computed from the committed canon profiles (§3.5), and `FEATURE_VERSION` moves from `f1` to `f2` in the same diff (§3.6).
- A golden regression test pins the result (§C 45).

**Fully offline.** Every run in this session reads committed files only: the canon profiles and the fixture library. No database, no network, no model call, no spend.
- The `--user` mode of `eval-recs` is **built and stub-tested but never run**. Running it against the live library belongs to Session 9, with the founder present.

**Prerequisite:** Session 7B is committed (`d92b474` or later). `git status` should be clean apart from `CLAUDE.md`, `.codex/` and `.freebuff/`. If anything else is uncommitted, **STOP**.

---

## 0. Before you start

Read these:
- `CLAUDE.md`
- `docs/PRD.md` §2, §8–§9
- `docs/STATE.md` (the last three entries)
- `docs/SPEC-STAGE3.md` **§1.9, §3 (all), §12.8, §B row 27, §C rows 5, 6, 45, §D (all), §E item 2**
- `docs/AUDIT-STAGE3.md` §5.1 and §5.3
- `docs/DECISIONS.md` #59, #63, #66, #76, #92–the latest

Read these source files fully:
- `src/lib/taste/calibration.ts`: `calibrate`, `pairIndexes` and the guards are already built and tested. **Reuse them; don't rewrite them.**
- `src/lib/taste/weights.ts`, `src/lib/taste/vector.ts` (`similarity`)
- `src/lib/taste/candidates.ts`, `filters.ts`, `score.ts`, `rerank.ts`, `pipeline.ts`, `explain.ts`, `snapshot.ts`, `profile.ts`, `affinity.ts` (`entryDate`, `isDated`, `affinity`)
- `src/lib/server/stage-recommend.ts` (`RecommendStore`; the canon-items construction)
- `src/lib/catalog/canon-profiles.ts` (the header and the shape only), `src/lib/catalog/canon.ts`
- `src/lib/dev/fixtures.ts` (`buildFixtureLibrary(now, { profiles: "canon" })`)
- `scripts/profile-canon.mts`, and the `package.json` scripts. **Copy the `.mts` + `node --conditions=react-server --import tsx` pattern (DECISIONS #76).**
- `src/__tests__/calibration.test.ts`, `src/__tests__/pipeline.test.ts` (the cold-start construction)

**Baseline:** run `npm run typecheck`, `npm test`, `npx eslint src` and `npm run build`. All must be green; write down the test count (323 at 7B's end). If not, **STOP**.

---

## 1. Scope

| File | Change |
|---|---|
| `src/lib/taste/eval.ts` (**new**, pure) | `explainScore`, `leaveOneLovedOut`, `temporalHoldout`, `componentSpread`, `coldStart`, `diversityRun`, `closenessDistribution` (§2.1) |
| `scripts/calibrate.mts` (**new**) | §2.2 |
| `scripts/eval-recs.mts` (**new**) | §2.3 |
| `scripts/explain-rec.mts` (**new**) | §2.4 |
| `package.json` | Add the npm scripts `calibrate`, `eval:recs` and `explain:rec`, in the existing pattern. Nothing else changes. |
| `src/lib/taste/calibration.ts` | **Only** the `CALIBRATION` constant, rewritten by the script (§2.2). Its type widens to `CalibrationTable`. |
| `src/lib/taste/weights.ts` | `FEATURE_VERSION = "f2"`. Nothing else changes. |
| `src/lib/taste/explain.ts` | A carry-over from the 7B review (§2.5). Nothing else changes. |
| `src/__tests__/eval.test.ts`, `src/__tests__/regression.test.ts`, `src/__tests__/golden/top5.json` (**new**) | §3 |
| Existing tests | Only the edits allowed in §2.6 |
| `docs/qa/eval-cal-provisional.json`, `docs/qa/eval-<new calibration id>.json` (**new**) | Script output, committed as the baseline record |
| `docs/DECISIONS.md`, `docs/STATE.md` | §5, §6 |

**Out of scope. STOP if you need any of these:**
- Changing `W0`, `BAND`, quotas, caps, `RECENCY_DAYS`, `LOVED` or any other constant except `FEATURE_VERSION`. **The band thresholds stay at 0.60 / 0.35;** you only *report* the distribution for the founder (§E item 2).
- Changing scoring, filtering, re-ranking, candidate generation or snapshot fields.
- Running anything against the live database, any network call, or any model call.
- Learned weights or §12 training. Not in Stage 3.
- MMR or any re-ranking variant. That's Session 10.

---

## 2. What to build

### 2.1 `eval.ts`: pure functions (SPEC §D; AUDIT §5.3)

Everything is deterministic for a fixed `now`, and every function takes its inputs explicitly (the library, phases, prefs, canon items, pool and `now`). Re-use the Stage 3 functions; never re-implement scoring.

- **`explainScore(P, candidate)`** (AUDIT §5.3). Per component it returns:
  - the raw value and, for story/feeling, both raw halves (`raw.story.centroid`/`anchor`) and the calibrated value;
  - the weight and the contribution;
  - the winning anchor, and the shared keys with **both sides'** weights;
  - the candidate's provenance and the calibration table in use.
  - It's built from `scoreCandidate` and the Session 5 helpers.
- **`leaveOneLovedOut(...)`** (D.1). For each loved entry `h` (`affinity ≥ LOVED`) with a usable profile:
  1. `lib' = library − h`; `P' = buildUserProfile(lib', phases, prefs, now)`.
  2. Candidates = `generateCandidates` over `lib'` with default filters (`limit: 5`), canon items, no creators, and the given pool.
  3. If `h`'s key isn't among them, inject `h.item` with `sources: []`. This is eval-only and never persisted.
  4. Run `filterCandidates` with `recent: []` (that is §D's "skip step 9"), then `scoreCandidates`, then `orderScored` (not surprise). **No re-rank.**
  5. `rank_h` = the 1-based position of `h`'s key.
  6. If `h` was removed by a filter or deferred, count it under `excluded` with the reason; it gets no rank.
  - **Report:** per-h rows (`key, rank, score, features, band, route`), plus `hit@5`, `hit@20`, MRR, the median rank, `n` and `excluded`.
- **`temporalHoldout(...)`** (D.2).
  - Dated loved entries are sorted by `entryDate`; only `isDated` entries count as dated.
  - `T` splits them 70/30. If fewer than 5 fall after `T`, return `{ skipped: "fewer than 5 holdouts" }`.
  - `lib_train` = entries before `T` plus all undated entries. Inject every holdout at once, then follow the D.1 procedure.
  - **Report:** `hit@5`, `hit@20`, MRR, and the share of holdouts that were unprofiled.
- **`componentSpread(scored, P)`** (D.3).
  - Per component: mean, sd, min, max and the share of exact zeros.
  - The `dead` flag: `sd < 0.02` and the component has evidence for the user.
  - The `dominant` flag: `W0[k]·sd_k > 2 ×` the next largest `W0[j]·sd_j`.
- **`coldStart(...)`** (D.4). Use the 10-canon-taps construction from `pipeline.test.ts` (move it into a shared test helper only if that doesn't edit the existing test file; otherwise duplicate it in `eval.ts`).
  - Run the full `rankPipeline` at `L = 5` with no filter, then once for each of the four categories.
  - **Report:** results returned, categories covered, routes, the `own_words = 0` share, whether quotas were met, and the mean closeness.
  - **Pass conditions** (structural, absolute): 5 results with no filter; every result explained; `has_evidence.story` true for all; no `feeling` route whose anchor has `ownWords: true`.
- **`diversityRun(...)`** (D.5). Seven simulated days.
  - Day `d` runs `rankPipeline` with `now + d` days, `limit: 5`, and `recent` = every earlier day's shown keys stamped with that day.
  - **Report:** the mean Jaccard between consecutive days, the share of days with a bridge (any result with `indicators.is_cross_media = 1`), the mean intra-list `1 − similarity` per family, and the max theme share. Logged, not thresholded.
- **`closenessDistribution(scored)`**: P10/P50/P90 of `closeness`, and the share of candidates in each band at the current thresholds. This is the input to the founder's band-threshold decision (§E item 2).

### 2.2 `scripts/calibrate.mts` (SPEC §3)

- **Population (§3.5's mandated first run).** Every committed canon profile whose category is in `MATCHED_CATEGORIES` and that passes `usableProfile` at the current `PROFILE_VERSION`, ordered by `canon:<slug>` ascending. That's 85 today; music is excluded.
  - §3.2's database population is the future re-run source and is **not** implemented here (DECISIONS in §5).
- **Similarities.** `sim.story = similarity(a.vector.story, b.vector.story, "story")` and the same for feeling, using the vector.ts function the scorer uses.
- Call the existing `calibrate()`. On `ok: false`, print the error, exit non-zero, and **write nothing**.
- **On success:**
  - Rewrite **only** the `CALIBRATION` constant in `src/lib/taste/calibration.ts` as a `CalibrationTable`: `{ id: "cal-" + YYYYMMDD + "-" + n_items, computed_at, n_items, n_pairs, method, story, feeling }`.
  - Round `lo`/`hi` to 4 decimal places.
  - Print the table and the line "bump FEATURE_VERSION".
- The script **never** edits `weights.ts`. You make the f1 → f2 edit by hand in the same diff.
- `--dry-run` prints the table and writes nothing.
- The script is deterministic. Running it twice on the same date writes byte-identical output; check that.

### 2.3 `scripts/eval-recs.mts` (SPEC §D)

- **`--fixture`** (the default):
  - fixed `NOW = 2026-09-25T12:00:00Z`;
  - the library is `buildFixtureLibrary(NOW, { profiles: "canon" })`, with canon items as in `stage-recommend.ts` and an empty pool;
  - it runs D.1–D.5 and `closenessDistribution`.
- **Output:** one JSON object on stdout: `{ feature_version, calibration_id, library_size, d1, d2, d3, d4, d5, closeness }`. Write it with `> docs/qa/eval-<calibration_id>.json`.
- **`--user <uuid>`:**
  - It reads, read-only, through a `RecommendStore`-shaped reader: the library, prefs, phases and pool. It uses a service-role client built inside the script from `.env.local`, like `seed-demo.ts`. The script is never imported by app code.
  - It must never call `insertSession` or any write.
  - **Build it and cover it with a stub test only. Do NOT run it.** Session 9 runs it with the founder.

### 2.4 `scripts/explain-rec.mts` (AUDIT §5.3)

`npm run explain:rec -- [--fixture] [title]` prints the `explainScore` table (from §2.1) for the fixture-library candidate whose title matches. With no title, it prints the top 5 of the default request.

Fixture mode only; a `--user` mode is Session 9's to add if wanted.

### 2.5 Carry-over from the 7B review (`explain.ts`)

`checkAiExplanation`'s digit guard leaves the **recommended item's own title** in the text before checking for digits. So a correct AI sentence naming "Blade Runner 2049" or "1984" is wrongly rejected.
- **Fix:** add `snapshot.item.title` to the allowed strings.
- Add one test to `explainer.test.ts`'s `checkAiExplanation` block: a sentence naming a digit-titled item passes, and the same sentence with an extra invented number still fails.
- Nothing else in `checkAiExplanation` changes.

### 2.6 The calibration change and existing tests

**Order of work:**
1. Build `eval.ts` and the tests while the **provisional** constants are still in place.
2. Run `npm run eval:recs > docs/qa/eval-cal-provisional.json`.
3. Run `npm run calibrate`, then set `FEATURE_VERSION = "f2"`.
4. Run `npm run eval:recs > docs/qa/eval-<id>.json`.

**Acceptance gate (D.1):** if the new `d1.hit@5` is **lower** than the provisional run's, **STOP**. Report both tables and don't keep the calibration. SPEC §D.1 says a calibration change "MUST not lower hit@5 on the fixture library".

**Existing tests:** after the constants change, some existing tests may fail.
- You may edit **only**:
  - `calibration.test.ts`'s `CALIBRATION.id === "cal-provisional"` assertion (assert the new id's format, `cal-YYYYMMDD-85`, and that `story`/`feeling` spans are ≥ 0.05);
  - `profile.test.ts`'s `FEATURE_VERSION === "f1"` assertion (→ `"f2"`);
  - assertions that pin a **number derived from the calibration constants** (a calibrated feature value, a band, a closeness, a score).
- For each of those numeric edits, record in STATE: the file, the test name, the old value and the new value, and one line on why it's calibration-derived.
- **Structural assertions never change:** counts, ordering rules, caps, determinism, forbidden evidence, and reconstruction. If one fails, that's a STOP.

---

## 3. Tests (offline and deterministic)

| # | Spec | Test |
|---|---|---|
| A | AUDIT §5.3 | `explainScore` contributions sum to the candidate's `score` to 1e-9; the calibrated values equal `cal(raw)` under the committed table; the shared keys carry both sides' weights |
| B | D.1 | On a hand-built library where the holdout is a near-duplicate of two other loved items, its rank is ≤ 5; on the fixture library the function returns a finite MRR and `n + excluded` = the loved-with-profile count |
| C | D.1 | A holdout that a filter would remove (for example a hidden key) lands in `excluded` with the reason, and is not ranked |
| D | D.2 | Fewer than 5 holdouts → `skipped`; with a synthetic dated library, the split is 70/30 and undated entries stay in training |
| E | D.3 | A component with identical values on every candidate and evidence → `dead`; a hand-built spread that triggers `dominant` |
| F | D.4 | The cold-start pass conditions hold under the committed calibration |
| G | D.5 | Seven days are deterministic; the Jaccard is in [0, 1]; with recency on, day 2 differs from day 1 when enough candidates exist |
| H | §3 | Running the calibrate core twice on the canon population gives identical tables; the population is 85 non-music items, ordered by key; a population of 59 → error, nothing written (call the pure part, not the file write) |
| I | §C 45 | **Golden:** the top-5 keys of the default fixture request at the fixed NOW equal `golden/top5.json.keys`, **and** `golden/top5.json.feature_version === FEATURE_VERSION`. Any change to the keys therefore forces a deliberate golden update that names the new version. |
| J | — | The `eval-recs --user` reader with a stub store makes no write call and returns the same report shape as fixture mode |
| K | §2.5 | The carry-over test in `explainer.test.ts` |

Write the golden file **after** calibration, under `f2`.

---

## 4. Verify

1. Loop on `npm test`, then run `npm run typecheck`, `npx eslint src` and `npm run build`.
2. Run `npm run calibrate -- --dry-run` twice: identical output.
3. Run `npm run eval:recs` and `npm run explain:rec -- "Aftersun"`; paste the outputs into STATE, trimmed to the summary numbers.
4. `git diff --stat` lists only §1 files; `git diff --check` is clean.
5. `grep -rn "eval-recs\|explain-rec\|scripts/" src/app src/lib` prints nothing (no app code imports a script).

No `@ts-ignore`, `eslint-disable`, `any`, or weakened assertions. If the spec is ambiguous, that's a STOP.

## 5. DECISIONS to append (continue from the last number)

- **The first calibration uses the committed canon profiles, not the database.** §3.5 mandates the canon run. The live database has too few profiled items (and none profiled live yet), and a re-run from the database follows §3.6's triggers once Session 9 has profiled the live items.
- **The calibration moves FEATURE_VERSION from f1 to f2** (§3.6). Snapshots stored since the 7B switch-over carry f1; they stay valid history and are excluded from learning (§12.8).
- **The band thresholds are unchanged.** The new closeness distribution is reported in `docs/qa/eval-<id>.json` for the founder's §E item 2 decision. Any change would be a separate founder-approved diff, with its own `FEATURE_VERSION` bump.
- **Eval holdouts that generation didn't produce are injected with empty provenance.** Provenance never affects the score (§1.7), and the injected candidate is never persisted.
- **The AI-explanation digit guard allows the recommended item's own title** (the 7B review carry-over).
- **`eval-recs --user` is read-only and built but unrun until Session 9.** Live reads with the service role happen only with the founder present.

## 6. STATE entry

`## <date> — Session 8: eval harness + first calibration (GLM, uncommitted)`. Include:
- Built / Verified (paste the real outputs).
- The calibration table, and the before/after D.1 `hit@5`/MRR.
- The closeness distribution and band shares.
- Every calibration-derived test edit (§2.6).
- "AI-verified only; no database, no network, nothing phone-verified".
- **Next:**
  1. Review, then the founder authorizes the commit.
  2. **The founder:** decide whether the band thresholds stay (§E item 2), using the reported distribution.
  3. Session 9: controlled live rollout. That means the first live profiling run over the live items with the founder present; `eval-recs --user` on the founder's library; the founder's Home/Recommend walk in dev and on a phone; and watching creator-adapter latency (DECISIONS, 7B).

## 7. STOP conditions

- 7B is uncommitted, or the baseline is red.
- The calibrated `hit@5` is lower than the provisional `hit@5` (§2.6).
- A calibration guard fails (`N < 60`, or a span under 0.05).
- A structural assertion fails after the calibration.
- Any constant other than `CALIBRATION` and `FEATURE_VERSION` seems to need changing.
- You need a file outside §1, the network, the database, or a model.

## 8. Acceptance (reviewer checklist)

- [ ] `CALIBRATION` was written by the script, from 85 canon items, exhaustively, and reproducibly. `FEATURE_VERSION` is `f2` in the same diff.
- [ ] The D.1 `hit@5` did not drop; both eval JSONs are committed.
- [ ] The band thresholds and every other constant are untouched; the distribution is reported.
- [ ] The golden test pins the keys together with the feature version.
- [ ] Every edited existing test is calibration-derived and listed with its old and new values.
- [ ] The `--user` path is read-only, stub-tested and unrun; nothing in the app imports a script.
- [ ] The digit-guard carry-over is fixed and tested.
