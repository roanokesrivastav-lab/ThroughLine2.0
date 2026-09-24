# Session 5: Pure Stage 3 scorer, snapshots, deterministic explanations (handoff for GLM 5.3)

**You implement this session, debug it yourself until every Verify command passes, and do NOT commit.**
The diff goes to review; the founder authorizes the commit.

**Outcome in one sentence:** given a `UserProfile` and a list of profiled candidates, pure functions compute the six-component score exactly as SPEC-STAGE3 §2 defines it, pick the route and anchor (§8.1–§8.2), build the full §9 snapshot, and write the deterministic sentence (§8.5). Every stored number reconstructs the displayed total.

**This session is pure and additive.** No database access, no network, no route, no UI. The live app keeps running the legacy scorer in `recommend.ts` untouched until Session 7 switches it over.

**Prerequisite:** Session 4 (profile runtime, with its review fixes) is committed. If `git status` shows Session 4 files uncommitted, **STOP**.

---

## 0. Before you start

Read: `CLAUDE.md` · `docs/PRD.md` §2, §8–§9 · `docs/STATE.md` (last three entries) · `docs/SPEC-STAGE3.md` **§1.5–§1.9, §2 (all), §4 (all), §8 (all), §9 (all), §12.1–§12.3, §12.8, §C rows 15–21 and 34–39, 46–47** · `docs/DECISIONS.md` #32, #52, #56, #59, #61, #64, #66–#79.

Read fully, because you will call into them:
- `src/lib/taste/profile.ts` (`buildUserProfile`, `UserProfile`, `Anchor`, `ActivePhase`, `FamilyProfile`)
- `src/lib/taste/vector.ts` (`simFamily`, `sharedFamily`)
- `src/lib/taste/calibration.ts` (`calStory`, `calFeeling`, `CALIBRATION.id`)
- `src/lib/taste/weights.ts` (`W0`, `COMPONENTS`, `FEATURE_VERSION`, `PROFILE_VERSION`)
- `src/lib/taste/affinity.ts` (`usableProfile`, `latestExtraction`, `hasOwnWordsV2`)
- `src/lib/taste/tags.ts` (`creatorKey`, `candidateKey`, `primaryCreator`)
- `src/lib/taste/tag-lexicon.ts` (`normaliseTags`, `tagFamily`)
- `src/lib/taste/vocabulary.ts` (`describeKey`, `familyOf`, `VOCABULARY_VERSION`)
- `src/lib/taste/recommend.ts`: **read only**. Study `fallbackExplanation`, `feelingSentence`, `sharedPhrase`, `fitsTime` and `daySeed`. You port their wording; you don't import the legacy `Recommendation`.
- `src/lib/dev/fixtures.ts` (`buildFixtureLibrary`, `fixtureProfile`), `src/lib/catalog/canon.ts` (`canonProfile`)

**Baseline:** `npm run typecheck` · `npm test` · `npx eslint src` · `npm run build`. All must be green; write down the test count. If not, **STOP**.

---

## 1. Scope

| File | Change |
|---|---|
| `src/lib/taste/snapshot.ts` (**new**, pure) | Types `RouteV3`, `ScoredCandidate`, `ImpressionSnapshot`, `SessionContext`, `RerankInfo`; `buildSnapshot`, `buildContext`, `snapshotTotal`, `trainingEligible` (§2.4–§2.5) |
| `src/lib/taste/score.ts` (**new**, pure) | `StageCandidate`, `scoreCandidate`, `scoreCandidates`, `orderScored` (§2.1–§2.2) |
| `src/lib/taste/explain.ts` (**new**, pure) | `routeOf`, `anchorOf`, `sharedFor`, `explainFields`, `explanationFromSnapshot` (§2.3) |
| `src/lib/taste/recommend.ts` | **Only** add the `export` keyword to the existing `daySeed` function. Nothing else changes. |
| `src/lib/dev/fixtures.ts` | **Additive:** `buildFixtureLibrary(now?, opts?: { profiles?: "placeholder" \| "canon" })`. The default stays `"placeholder"` (existing tests unchanged). `"canon"` attaches `canonProfile(slug) ?? fixtureProfile(item)`. |
| `src/__tests__/score.test.ts`, `src/__tests__/explain.test.ts`, `src/__tests__/snapshot.test.ts` (**new**) | §3 |
| `docs/DECISIONS.md`, `docs/STATE.md` | §4, §5 |

**Out of scope. STOP if you need any of these:**
- Changing the legacy `scoreCandidates`, `Recommendation`, `Route`, `rec-card.tsx`, `explainer.ts`, or `server/recommend.ts`. Session 7 does the switch-over and deletes the legacy code.
- Candidate generation, the nine hard filters, re-ranking, bands, quotas, caps and bridge repair (Session 6). This session takes candidates as given, and takes `RerankInfo` as an input.
- Any change to `weights.ts`, `calibration.ts` constants, `profile.ts`, `vector.ts`, vocabulary, profiles, or `FEATURE_VERSION`.
- Editing `demo-seeds.ts`. Build extra test libraries inside the test files instead (§3).
- The AI explainer. `explanation` in the snapshot is the deterministic sentence only.

---

## 2. What to build

### 2.1 Candidate type and one-candidate scoring (`score.ts`)

```ts
export type Source = "backlog" | "canon" | "creator" | "story_neighbour" | "feeling_neighbour" | "phase";
export const SOURCE_ORDER: readonly Source[] = ["backlog", "canon", "creator", "story_neighbour", "feeling_neighbour", "phase"];
export type StageCandidate = {           // SPEC §1.7
  key: string; item: MediaItem; entryId: string | null; sources: Source[]; creatorKey: string | null;
};
export type Weights = Readonly<Record<Component, number>>;   // W0 by default (§2.8, §12.7)
```

`scoreCandidate(P: UserProfile, x: StageCandidate, weights = W0): ScoredCandidate | null`:
- If `usableProfile(x.item)` is null → return **null**. The caller counts it as deferred; an unprofiled item never gets a partial score (§6 step 8).
- **Story / feeling (§2.2–§2.3), for each family F:**
  - If `P[F] === null` → `v = 0` and the raw values are null.
  - Otherwise `rawCentroid = simFamily(F, x.vector[F], P[F].centroid)` and `rawAnchor` = the maximum over anchors of `simFamily(F, x.vector[F], a.vector)`. **Skip any anchor whose `itemId === x.item.id`.**
  - `v_F = 0.5·cal_F(rawCentroid) + 0.5·cal_F(rawAnchor)`, with no anchor meaning `rawAnchor = 0`.
  - `anchor_F` = the argmax, with ties going to the higher `affinity`, then `entryId` ascending. Record the calibrated anchor similarity (for §8.2).
- **Form (§2.4):**
  - `b = profile.form.band` and `d = P.form[category]?.dist`.
  - If either is missing → 0. Otherwise `clamp01(d[b] + 0.5·d[b−1] + 0.5·d[b+1])`, where out-of-range neighbours count as 0.
- **Creator (§2.5):** `x.creatorKey ? (P.creators.get(x.creatorKey)?.weight ?? 0) : 0`. There's no fallback for creator-sourced candidates.
- **Phase (§2.6):** exactly the three branches in the spec.
  - `feeling_cluster`: read `ph.key`/`ph.second` from the union of story and feeling vectors.
  - `genre_run`: 1 on a normalised-tag match, 0.6 when a tag's `tagFamily` parent equals `ph.key`, else 0.
  - `category_stretch`: 1 or 0.
- **Anti (§2.7):** the mean over the non-null anti families of `cal_F(simFamily(F, x.vector[F], P.anti[F]))`; 0 when both families are null. Record raw values per family, or null.
- **`has_evidence` (DECISIONS entry below):**
  - story/feeling = `P[F] !== null && Object.keys(x.vector[F]).length > 0`
  - form = band known and `P.form[category]` defined
  - creator = `x.creatorKey !== null && P.creators.has(x.creatorKey)`
  - phase = `P.activePhase !== null`
  - anti = either anti family non-null
- **`features`**: an object with exactly the six keys in `COMPONENTS` order, each value in [0, 1]. **`contributions[k] = weights[k] · features[k]`**. **`score = Σ contributions`**, with no denominator, no re-normalisation and nothing added afterwards (§2.8).

`ScoredCandidate` carries `candidate`, `features`, `raw` (§9.1 shape), `has_evidence`, `weights`, `contributions`, `score`, `anchors: { story: AnchorPick | null; feeling: AnchorPick | null }` (the anchor, its calibrated similarity and its family).

`scoreCandidates(P, candidates, weights = W0): { scored: ScoredCandidate[]; deferred: StageCandidate[] }`. It preserves input order; ordering is the next function.

### 2.2 Ordering (`orderScored`)
```ts
export function orderScored(scored: ScoredCandidate[], opts: { surprise: boolean; userId: string }): ScoredCandidate[]
```
- Sort by `sortKey` descending, then `candidate.key` ascending (DECISIONS #56).
- `sortKey = score` normally.
- With `surprise`, `sortKey = 0.5·score + 0.5·daySeed(userId + key)` (§2.8). The stored `score` is **never** changed by surprise mode.

### 2.3 Route, anchor, shared attributes, sentence (`explain.ts`)
- **`routeOf(s, { listOnly, surprise })`** exactly per §8.1:
  - backlog when `(listOnly || surprise) && entryId`
  - else the argmax of the five non-anti contributions, with ties (|Δ| ≤ 1e-9) in the order story, feeling, creator, phase, form
  - if that maximum is 0 → `entryId ? "backlog" : "story"`
  - `anti` is never a route.
- **`anchorOf(s, route)`** per §8.2:
  - story route → the story anchor; feeling → the feeling anchor
  - otherwise the anchor with the higher calibrated similarity, story on ties
  - null when neither exists.
- **`sharedFor(s, route, anchor)`** per §8.3: `sharedFamily(F, x.vector[F], anchor.vector)`, where F is the route's family (for non-family routes, the anchor's family). **Drop every `ending.*` key.** Keep the first 3.
- **`explainFields(...)`** → the §9.1 `explain` block:
  - `summary` and `quote`: from the anchor entry's newest v2 reading
  - `valued`: only on story/feeling routes when the anchor has `ownWords`, the first `valued` phrase (verbatim) of that newest v2 reading
  - `creator`: the name, on the creator route
  - `phase_label`: on the phase route
  - `fits`: passed in from the caller

  The anchor's entry comes from the library passed in. **Only these fields may reach a sentence.**
- **`explanationFromSnapshot(snap: ImpressionSnapshot): string`**. This is the §8.5 deterministic sentence per route, and it reads **only** the snapshot:
  - `story`: `This connects to {anchor.title}: the same {describeKey(shared[0])} and {describeKey(shared[1])}.`, then the valued phrase in curly quotes, or else the quote (existing "You wrote “…”" wording). If `indicators.is_cross_media`, use the prefix `This connects to something you loved in another medium: `. With fewer than 2 shared keys, degrade gracefully by naming one, or none, without leaving placeholder text.
  - `feeling`: port the legacy `feelingSentence` wording, driven by snapshot fields.
  - `creator`: `Same hands as something you loved: {creator}.`, plus ` It is also {describeKey(shared[0])}.` when one exists.
  - `phase`: `Fits {phase_label}.`, plus the story or feeling sentence for the anchor when one exists.
  - `form`: `{fits}. It sits close to what you tend to love.`, or just the second sentence when there's no `fits`.
  - `backlog`: the legacy backlog wording (`From your own list.` plus fits plus feeling).
  - **Never** include an `ending` word, a number or score, the premise, provenance names, the private score or affinity, "popular", "critics", "acclaimed" or "rated" (§8.6).

### 2.4 Snapshot (`snapshot.ts`)
```ts
export type RouteV3 = "story" | "feeling" | "form" | "creator" | "phase" | "backlog";
export type RerankInfo = { band: "familiar" | "adjacent" | "stretch"; closeness: number; pass: 1 | 2 | 3; bridge_repair: boolean };
export function buildSnapshot(args: {
  position: number; scored: ScoredCandidate; library: EntryWithContext[];
  filters: { listOnly: boolean; surprise: boolean }; fits: string | null; rerank: RerankInfo;
}): ImpressionSnapshot
```
- It produces **every field in §9.1, in that shape and that key order**: `position`, `key`, `item {id, title, category, creator, profile_version}`, `entryId`, `sources`, `creatorKey`, `features`, `raw`, `has_evidence`, `weights`, `contributions`, `score`, `route`, `anchor {entryId, itemId, title, category, affinity, ownWords, family}` or null, `shared`, `explain`, `indicators`, `rerank`, `versions`, `explanation`.
- `indicators`:
  - `is_cross_media` = anchor present and `anchor.category !== item.category`
  - `is_backlog` = `entryId ? 1 : 0`
  - `band_adjacent` / `band_stretch` come from `rerank.band`
  - `own_words` = `anchor?.ownWords ? 1 : 0`

  All are 0 or 1 (§12.1).
- `versions` = `{ feature_version: FEATURE_VERSION, profile_version: item profile's version, vocabulary_version: VOCABULARY_VERSION, calibration_id: CALIBRATION.id }`.
- `explanation` = `explanationFromSnapshot(snapshotWithoutExplanation)`. Build everything else first, then the sentence from it, so the reconstruction test is honest.
- **Never stored (§9.3):** raw notes (the only note text allowed is the verbatim quote or valued phrase in `explain`), full profiles, full centroids, private score, email, popularity or external scores, prompts.

`buildContext(args)` → the §9.2 `SessionContext`:
- `filters`
- `weights_source: "w0"`
- `learned: null`
- `versions`
- `calibration` (the ranges in use)
- `thresholds`, taken from `weights.ts` constants, with **`recency_days: RECENCY_DAYS` (14)**
- the `profile` summary: top 20 centroid keys per family, `n_loved`, anchors as `{entryId, affinity}` (≤ 40), form, creators with weight ≥ 0.4, active phase, and anti tops ≤ 10 per family plus evidence
- `pools` and `policy`, passed in from the caller (Session 6/7 fill them; tests pass fixtures)

`snapshotTotal(s) = Σ contributions`. `trainingEligible(s, ctx) = s.versions.feature_version === FEATURE_VERSION && !ctx.policy.surprise` (§12.2, §12.8).

---

## 3. Tests (offline, deterministic; use `buildFixtureLibrary(NOW, { profiles: "canon" })` with a fixed `NOW`, plus small synthetic libraries built in the test files from canon items and `canonProfile`)

| # | Spec §C | Test |
|---|---|---|
| A | 15 | For several fixture candidates, `score === Σ contributions` to within 1e-9; and a candidate with `creator = 0.5` beats an otherwise-identical `creator = 0` one by exactly `0.10 × 0.5 = 0.05` |
| B | 16 | An unprofiled candidate (no profile, or a `p0` profile) is returned in `deferred`, never in `scored` |
| C | 17 | With `P.feeling = null`: every result has `features.feeling = 0` and `has_evidence.feeling = false`, and the order equals scoring with `weights.feeling = 0` |
| D | 18 | No creator → `features.creator = 0`. A synthetic library with two loved Ishiguro books (canon) and a third Ishiguro candidate → `features.creator ≥ 0.5`, and route `creator` whenever its story contribution is lower than its creator contribution |
| E | 19 | No active phase → `features.phase = 0` everywhere. An injected `genre_run` phase with key `sci-fi` → a candidate tagged `sci-fi` gets 1, and one tagged only with a child tag gets 0.6 |
| F | 20 | Injecting anti vectors that raise `v_anti` by Δ lowers `S` by exactly `0.15 × Δ` |
| G | 21 | A book whose best anchor is a film → `indicators.is_cross_media = 1`, and the story sentence carries the cross-media prefix |
| H | 34 | Equal story and feeling contributions → `story`. All-zero contributions → `backlog` for a backlog candidate, `story` otherwise. `anti` is never a route |
| I | 35 | Over every scored fixture candidate, the explanation contains no `ending` value (compare against every `ENDINGS` word used as a key), no digit once the allowed text is removed (anchor title, creator name, `fits` note and phase label, since titles like *1984* and time notes legitimately contain digits), and none of "popular", "critics", "acclaimed", "rated" |
| J | 36 | Whenever `explain.valued` is non-null, it's a verbatim substring of the anchor entry's raw note |
| K | 37 | `explanationFromSnapshot(snapshot) === snapshot.explanation` for every result |
| L | 38 | Completeness: every §9.1 key is present in order; `features` has exactly the six keys in `COMPONENTS` order; `score === snapshotTotal` to 1e-9; `recency_days === 14` in the context |
| M | 39 | `trainingEligible` is false for `feature_version: "f0"` and for a surprise context; a `p0` item profile is treated as unprofiled (B) |
| N | 46 | Empty library → `P` has null families; scoring a candidate list returns results with story/feeling 0 and doesn't throw; an empty candidate list returns empty |
| O | 47 | A single loved entry → the centroid equals that entry's vector, there's exactly one anchor, and results are still produced |
| P | — | Anchor self-skip: a candidate whose item is itself an anchor never picks itself |
| Q | — | Determinism: shuffled input gives an identical `orderScored` output; surprise changes the order but never `score` |
| R | — | Ending keys never appear in `shared` (a synthetic anchor sharing an `ending.*` key with the candidate) |

All existing tests stay green and **unedited**.

---

## 4. DECISIONS to append (continue from the last number)
- **The Stage 3 scorer is additive** (`score.ts`, `explain.ts`, `snapshot.ts`) while the legacy scorer keeps serving the live app. Session 7 switches over and deletes the legacy path. That's why the route type is named `RouteV3` for now.
- **`has_evidence` definitions** (the spec names the flags but not their exact rule): story/feeling need both a user family profile and a non-empty candidate family vector; form needs a known band and a form distribution for that category; creator needs a creator key the profile knows; phase needs an active phase; anti needs a non-null anti family.
- **Fixtures gain an opt-in canon-profile mode.** The default stays the placeholder, so existing tests are unaffected. Scorer tests build extra cases (two Ishiguro books, drops, negation) inside the test files instead of changing `demo-seeds.ts`, which also feeds the live demo library.

## 5. STATE entry
`## <date> — Session 5: pure scorer + snapshots (GLM, uncommitted)`. Include:
- Built / Verified (paste the real outputs).
- "AI-verified only; no database, no network, nothing phone-verified; the live app still uses the legacy scorer".
- **Next:** Session 6 (nine filters + band/quota/cap/bridge re-ranker, which produces `RerankInfo`).

## 6. Debug loop
Tests first → `score.ts` → `explain.ts` → `snapshot.ts` → loop `npm test` → `npm run typecheck`, `npx eslint src`, `npm run build`. No `@ts-ignore`, `eslint-disable`, `any`, or weakened assertions.

If an assertion and the spec disagree, the spec wins. If the spec is ambiguous, that's a STOP, not a guess.

Finally:
- `git diff --stat` must list only §1 files.
- `git diff src/lib/taste/recommend.ts` must show only the `export` keyword.
- `git diff --check` must be clean.

## 7. STOP conditions
- Session 4 is uncommitted, or the baseline is red.
- An existing test needs editing.
- A spec formula can't be implemented with the existing `simFamily` / `calStory` / `buildUserProfile` without changing them.
- You need a file outside §1.

## 8. Acceptance (reviewer checklist)
- [ ] Only §1 files changed; the legacy scorer and live routes are byte-identical (apart from `export daySeed`).
- [ ] `score` is literally `Σ weights[k]·features[k]`; no other term exists anywhere.
- [ ] The snapshot matches §9.1 key by key; the context says `recency_days: 14`.
- [ ] Explanations are rebuilt from the snapshot alone and contain no forbidden evidence.
- [ ] Tests A–R pass; the previous tests are unchanged and green.
