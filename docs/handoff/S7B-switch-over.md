# Session 7B: The switch-over (handoff for GLM)

**You implement this session, debug it yourself until every Verify command passes, and do NOT commit.**
The diff goes to review; the founder authorizes the commit.

**Outcome in one sentence:** Home and Recommend are served by the Stage 3 pipeline (`buildStageRecommendations`, Session 7A). The recommendation card and the AI explainer read the impression snapshot. Unprofiled candidates are queued for profiling after the response, and the legacy scorer is deleted.

**This is the first session the founder can see.** After it, every recommendation in the app comes from the new engine. Keep the switch small and exact. Nothing in this session changes the maths.

**Prerequisite:** Session 7A must be reviewed and **committed**, including its review-round changes on top of `75aa680`. `git status` should be clean apart from `CLAUDE.md`, `.codex/` and `.freebuff/`. If anything else is uncommitted, **STOP**.

---

## 0. Before you start

Read these:
- `CLAUDE.md`
- `docs/PRD.md` §2, §8–§9. The rule "never show popularity, aggregate scores or other users' data" applies to every string you add.
- `docs/STATE.md` (the last three entries)
- `docs/SPEC-STAGE3.md` **§1.8, §6 step 8, §8 (all), §9.1, §9.3, §B rows 10, 11, 21, 24**
- `docs/DECISIONS.md` #32, #78–#82, #92–the latest
- `docs/handoff/S7A-candidates-server.md` §9 (the outline this file expands)

Read these source files fully:
- `src/lib/server/stage-recommend.ts` (7A), `src/lib/taste/pipeline.ts`, `src/lib/taste/snapshot.ts`, `src/lib/taste/explain.ts`
- The legacy path, which you're about to replace or delete:
  - `src/lib/server/recommend.ts`, `src/lib/taste/recommend.ts`
  - `src/lib/server/home.ts`, `src/app/api/recommend/route.ts`, `src/app/api/home/route.ts`
- `src/lib/ai/explainer.ts`, and the `nvidiaExplainer` in `src/lib/ai/nvidia.ts`
- `src/components/rec-card.tsx`, `src/app/(app)/home-screen.tsx`, `src/app/(app)/recommend/recommend-screen.tsx`, `src/app/dev/preview/page.tsx`
- `src/lib/types.ts` (`Route`, `Recommendation`, `ScoreComponent`, `ScoreAdjustment`)
- `src/lib/server/profiles.ts` (`ensureProfiles`, `profileItemsNow`, `PROFILE_INLINE_LIMIT`)
- The `after()` usage in `src/app/api/entries/route.ts`
- `src/__tests__/scoring.test.ts` and `src/__tests__/engines.test.ts`: the legacy tests you'll remove (§2.7)

**Baseline:** run `npm run typecheck`, `npm test`, `npx eslint src` and `npm run build`. All must be green; write down the test count. If not, **STOP**.

---

## 1. Scope

| File | Change |
|---|---|
| `src/lib/types.ts` | `Route` becomes the six Stage 3 routes. `Recommendation` per §2.1. Delete `ScoreComponent` and `ScoreAdjustment`. **Keep `TagMatch`**, because `tags.ts` uses it. |
| `src/lib/taste/snapshot.ts`, `src/lib/taste/explain.ts` | Replace `RouteV3` with `Route` from `types.ts` (rename only). `explain.ts` gains `checkAiExplanation` (§2.4). Nothing else changes. |
| `src/lib/taste/labels.ts` (**new**, client-safe, no imports beyond types) | `ROUTE_LABEL`, `BAND_LABEL` (§2.5) |
| `src/lib/taste/form.ts`, `src/lib/taste/score.ts` | Move `TimeBudget`, `estimatedMinutes` and `fitsTime` into `form.ts`, and `daySeed` into `score.ts`, **byte-identical** (§B row 10) |
| `src/lib/taste/filters.ts`, `src/lib/taste/pipeline.ts`, `src/lib/taste/candidates.ts`, and any file importing the moved names | Import-path updates only |
| `src/lib/taste/recommend.ts` | **Delete** |
| `src/lib/server/recommend.ts` | Keep only `loadTastePrefs`. Delete `buildCandidates`, `buildRecommendations` and `materialise` (unused). |
| `src/lib/server/stage-recommend.ts` | `StageDeps.explain`, `opts.cache`, `recommendations` in the return value, `toRecommendation`, `queueDeferredProfiles` (§2.2, §2.3) |
| `src/lib/server/home.ts`, `src/app/api/recommend/route.ts` | Switch to `buildStageRecommendations` (§2.3) |
| `src/lib/ai/explainer.ts`, `src/lib/ai/nvidia.ts` (explainer only) | Snapshot-based explainer (§2.4) |
| `src/components/rec-card.tsx` | Render from the snapshot (§2.5) |
| `src/app/dev/preview/page.tsx` | Build its recommendations with the pure Stage 3 path (§2.6) |
| `src/app/(app)/home-screen.tsx`, `src/app/(app)/recommend/recommend-screen.tsx` | Only what the new types force (for example `key={r.snapshot.key}`) |
| `src/__tests__/scoring.test.ts`, `src/__tests__/engines.test.ts`, `src/__tests__/form.test.ts` | §2.7: the only existing tests you may edit |
| `src/__tests__/switch-over.test.ts`, `src/__tests__/explainer.test.ts` (**new**) | §3 |
| `docs/DECISIONS.md`, `docs/STATE.md` | §5, §6 |

**Out of scope. STOP if you need any of these:**
- Any change to scoring, filters, re-ranking, candidates, snapshots' fields, constants, the calibration, or `FEATURE_VERSION`.
- A migration or an RLS change. Using the service role anywhere except the existing `profileItemsNow`/`ensureProfiles` path.
- Anything "not for me" beyond the existing hide button (DECISIONS #32).
- Showing any score, percentage, popularity, external score, or other users' data on the card outside the existing "Why this" debug panel.
- The golden regression test (§C 45), scripts, or calibration. Those are Session 8.
- A live profiling run, a real model call, or a real database in tests.

---

## 2. What to build

### 2.1 Types (§1.8)

```ts
export type Route = "story" | "feeling" | "form" | "creator" | "phase" | "backlog";
export type Recommendation = {
  item: MediaItem;          // with `profile: null`: the client never receives item profiles (§9.3)
  entryId?: string;
  score: number;            // = snapshot.score
  route: Route;             // = snapshot.route
  snapshot: ImpressionSnapshot;
  explanation: string;      // = snapshot.explanation (the sentence shown, deterministic or AI)
  fits: string | null;      // = snapshot.explain.fits
};
```

`types.ts` may `import type { ImpressionSnapshot }` from `snapshot.ts`, since type-only cycles are fine. Delete `breakdown`, `bridge`, `ScoreComponent` and `ScoreAdjustment`.

### 2.2 `stage-recommend.ts` additions

**The deps and options:**
```ts
export type StageDeps = {
  adapterFor: (c: Category) => CatalogAdapter; now: () => Date;
  /** Optional AI rewrite. Returns one string per snapshot, or null to keep the deterministic sentence. Never throws (§2.4). */
  explain?: (snapshots: ImpressionSnapshot[]) => Promise<Array<string | null>>;
};
// opts gains: cache?: { entryCount: number }
// return gains: recommendations: Recommendation[]   (display order, one per snapshot)
```

**The new steps inside `buildStageRecommendations`**, between `rankPipeline` and `insertSession`:
1. **Explain.** If `deps.explain` is set, call it once with all the snapshots.
   - A non-null string replaces `snapshot.explanation`, so the **stored** snapshot holds the sentence actually shown (§9.1).
   - A null keeps the deterministic sentence.
2. **Build the recommendations.** Call `toRecommendation(snapshot, item)` for each snapshot.
   - `item` is the shown candidate's `MediaItem`, found by `snapshot.key` in the generated candidates. Every shown key must resolve, or **throw**.
   - `toRecommendation` is pure and exported. It copies the fields in §2.1 and sets `item.profile = null`.
3. **Insert.** `answers` is `{ filters, context }`. When `opts.cache` is set, it's `{ filters, context, entryCount, full: recommendations }` instead. `full` is the Home day cache that §9.3 explicitly allows, and it holds no profiles because `toRecommendation` stripped them.

**The profiling queue:**
```ts
export async function queueDeferredProfiles(
  deferred: StageCandidate[],
  deps?: { ensure?: typeof ensureProfiles; profileNow?: typeof profileItemsNow },
): Promise<void>
```
- It calls `ensure(deferred.map((c) => c.item))`, then `profileNow(needing.slice(0, PROFILE_INLINE_LIMIT))`.
- It catches and `console.error`s everything and **never throws**.
- An empty `deferred` makes zero calls.

### 2.3 The server switch

**`/api/recommend`:**
- Keep the zod schema and the filter mapping exactly as they are.
- Call `buildStageRecommendations(supabaseRecommendStore(supabase), { adapterFor, now: () => new Date(), explain: (s) => getExplainer().explain(s) }, user.id, filters, { kind })`.
- Then `after(() => queueDeferredProfiles(deferred))`.
- Respond with `{ recommendations, filters }`, the same response shape the client already reads.

**`home.ts`:**
- Keep the `logged ≥ 3` gate and the 24-hour cache.
- A cached row is reused only if `readHomeCache(answers, library.length)` returns an array. `readHomeCache` is pure and exported from `home.ts` or `stage-recommend.ts`.
  - It returns `full` only when `entryCount` matches and **every** element has a `snapshot` object.
  - A legacy cache row (whose items have a `breakdown` and no `snapshot`) returns null, which forces a rebuild. **This matters:** without it, the first Home load after deploy would send old-shape data to the new card, and the card would crash.
- On a miss:
  - call `buildStageRecommendations(..., filters, { kind: "home", cache: { entryCount: library.length } })` with `filters = { category: null, minutes: null, listOnly: false, returnable: false, shortRead: false, surprise: false, limit: 3 }`;
  - then `after(() => queueDeferredProfiles(deferred))`.
- **Delete** the follow-up `update(...).order().limit()` call; the cache is now written by the insert.

### 2.4 The explainer (§8, §B row 21)

**The interface:**
```ts
export interface Explainer { readonly name: "mock" | "claude" | "nvidia"; explain(snapshots: ImpressionSnapshot[]): Promise<Array<string | null>> }
```
- **The mock** returns all nulls, meaning "keep the deterministic sentence".
- **Claude and NVIDIA** both use the same pure `explainerPayload(snapshot)`: `{ index, title, category, creator: item.creator, route, band: rerank.band, anchor: anchor && { title, category, ownWords }, shared: shared.map(s => describeKey(s.key)), summary, quote, valued, creator_they_return_to: explain.creator, phase_label, fits, draft: snapshot.explanation }`.
  - Nothing else goes to the model: no scores, no weights, no features, no raw notes beyond `quote`/`valued`, no keys, no ids.
- **One prompt for both providers,** exported as a constant.
  - It covers the six routes: a first clause that matches the route; `ownWords: false` means "sits close to what you tend to love", never "you loved" or "you wrote".
  - It carries the existing rules from the legacy prompt about hype, other people, invention, tone, and curly quotes.
  - `draft` is the safe sentence to improve, never to contradict.
- **Every AI string goes through `checkAiExplanation(text, snapshot): boolean`** (exported from `explain.ts`). Anything that fails becomes null for that item only. A string passes only if all of these hold:
  - it's non-empty and at most 320 characters;
  - after the allowed strings (anchor title, creator, phase label, valued, quote, fits) are removed, it has no digit;
  - no `ENDINGS` word appears as a whole word;
  - none of `popular`, `critics`, `acclaimed`, `rated`, `fans`, `everyone` or `classic` appears as a whole word;
  - any text inside “curly” or "straight" double quotes is a verbatim substring of `explain.quote` or `explain.valued`.
- **Failures:** any thrown error, refusal, parse failure or wrong-length answer returns all nulls. The explainer **never throws**. The legacy NVIDIA explainer can throw today; fix that.
- `getExplainer()` keeps its current provider selection.

### 2.5 `rec-card.tsx`

The card renders from `rec.snapshot`:
- **The pill:** `ROUTE_LABEL[rec.route]`, then `fits` (as today), then "On your list" when `entryId` is set.
- **The explanation:** `rec.explanation`.
- **The link:** "Connects to {anchor.title}" pointing to `/entry/{anchor.entryId}` when `snapshot.anchor` is set, followed by up to three `describeKey(shared.key)`.
- **"Why this" (debug, collapsed by default):**
  - a table of the six components in `COMPONENTS` order: `features[k]` × `weights[k]` = `contributions[k]`, or "no evidence" when `!has_evidence[k]`;
  - the total, `rec.score`;
  - a line with `BAND_LABEL[rerank.band]`, plus "added to include a cross-media pick" when `rerank.bridge_repair`.
- **"Not for me"** hides by `rec.snapshot.key`, with the same undo as today.
- **The labels** live in `labels.ts`. The founder may change the wording later; see DECISIONS in §5:
  - `ROUTE_LABEL`: story "Same kind of story", feeling "Connection in feeling", form "The length you tend to love", creator "Same hands", phase "Your current phase", backlog "From your list".
  - `BAND_LABEL`: familiar "Close to what you love", adjacent "A step sideways", stretch "A stretch".

### 2.6 The dev preview

Build candidates with `generateCandidates` over `buildFixtureLibrary(now, { profiles: "canon" })` and canon items, with no pool and no creators. Run `rankPipeline` with `limit: 3` and render `toRecommendation` rows. There are no network or database calls and no explainer, so the page shows deterministic sentences.

### 2.7 Deleting the legacy scorer

- Delete `src/lib/taste/recommend.ts`, plus the `buildCandidates`, `buildRecommendations` and `materialise` functions in `server/recommend.ts`.
- **In `scoring.test.ts`:**
  - Move the regression "treats an anime feature as a film for time budgets" into `form.test.ts` against the moved `fitsTime`, unchanged apart from the import.
  - Delete every other test in the file (they test the legacy scorer), and delete the file once it's empty.
- **In `engines.test.ts`:** delete only the `describe("recommendations", …)` block and the imports only it used. Every other block stays byte-identical.
- In STATE, list each deleted legacy test by name, next to the Stage 3 test that now covers the same behaviour (for example "never more than two by one maker" → rerank G, "is deterministic" → rerank K / pipeline).

---

## 3. Tests (offline and deterministic; no real model, database or network)

| # | Test |
|---|---|
| A | `toRecommendation`: every §2.1 field is equal to the snapshot's; `item.profile === null`; `explanation === snapshot.explanation` |
| B | `buildStageRecommendations` with an `explain` dep returning `["AI one", null, …]` → the stored snapshot 0 has "AI one", and the others keep `explanationFromSnapshot(snapshot)`. The returned recommendations match what was stored. |
| C | `explain` dep absent → every stored explanation equals `explanationFromSnapshot(s)` (§C 37 still holds) |
| D | `opts.cache` → the inserted answers are `{ filters, context, entryCount, full }`, and no `full[i].item.profile` is non-null. Without `cache`, the answers are exactly `{ filters, context }`. |
| E | `readHomeCache`: a matching v3 row → the array; a wrong `entryCount` → null; a legacy row with `breakdown` and no `snapshot` → null; malformed JSON shapes → null, never a throw |
| F | `queueDeferredProfiles`: 8 deferred → `ensure` called once with 8 items, `profileNow` with at most 5 ids; `ensure` throwing → no throw; an empty list → zero calls |
| G | `explainerPayload`: exactly the §2.4 keys; the serialized payload for the fixture library contains no `raw_note` text other than the snapshot's own `quote`/`valued`, no digits from scores, and no `features`/`weights`/`contributions` keys |
| H | `checkAiExplanation`: accepts the deterministic sentence of every fixture snapshot; rejects "Critics loved it", "Rated 9", a whole-word ending ("It ends bittersweet"), an invented quotation, and 321 characters |
| I | Claude explainer with a stubbed client: success maps by index; refusal → all null; throw → all null; one guard-failing item → null for that item only |
| J | NVIDIA explainer with stubbed `fetch`/`complete`: success, a malformed JSON answer → all null, a network error → all null (never throws) |
| K | Mock explainer → all null |
| L | Legacy removal: `grep -rn "taste/recommend\"\|buildRecommendations\|breakdown\|RouteV3" src` prints nothing (run in Verify, not as a vitest test) |

All other existing tests stay green and **unedited**, apart from §2.7.

---

## 4. Verify

1. Loop on `npm test` until green, then run `npm run typecheck`, `npx eslint src` and `npm run build`.
2. **§3 L grep:** it must print nothing.
3. **Dev preview check (desktop browser, AI-verified only):**
   - Run `npm run dev` and open `/dev/preview` at a phone width (375 px).
   - Screenshot the three cards, closed and with "Why this" open.
   - Confirm there are no console errors, and that no card shows a score outside the debug panel.
4. `git diff --stat` lists only §1 files; `git diff --check` is clean.

Do **not** sign in or open the real Home or Recommend screens against the live database. That walk is the founder's.

No `@ts-ignore`, `eslint-disable`, `any`, or weakened assertions. If the spec is ambiguous, that's a STOP.

## 5. DECISIONS to append (continue from the last number)

- **The stored snapshot's explanation is the sentence shown, AI or deterministic (§9.1).** A deterministic row is one where `explanationFromSnapshot(s) === s.explanation`, so no extra field is needed to tell them apart.
- **Every AI explanation must pass `checkAiExplanation` or fall back per item.** It enforces §8.6 on model text, including that quotations must be verbatim, because the model can't be trusted to follow the rules unaided.
- **The explainer never throws, and the NVIDIA explainer is fixed to match.** A model failure must not fail a recommendation request.
- **Recommendations sent to the client and the Home cache carry `item.profile = null`** (§9.3: full item profiles are not stored).
- **Legacy Home cache rows are ignored, not migrated.** Their shape can't be rendered by the new card; one rebuild per user is the cost.
- **Route and band labels are placeholder copy** in `labels.ts`, for the founder to change freely. They don't affect scoring or snapshots.
- **Creator adapter calls still have no timeout, matching legacy behaviour.** Session 9 watches real latency before choosing one.

## 6. STATE entry

`## <date> — Session 7B: switch-over to the Stage 3 pipeline (GLM, uncommitted)`. Include:
- Built / Verified (paste the real outputs, with the dev preview screenshots described).
- The deleted-tests mapping from §2.7.
- "AI-verified only; the real Home and Recommend screens have not been opened against the live database; nothing phone-verified".
- **Next:**
  1. Review, then the founder authorizes the commit.
  2. **The founder's walk:** open Home and Recommend in dev against the real library (the categories, time budgets, list only, surprise, "Why this", Not for me with undo, and Add to list), then the same on a phone.
  3. Session 8 (scripts + baseline calibration), then Session 9 (controlled live rollout, including the first live profiling run).

## 7. STOP conditions

- Session 7A is uncommitted, or the baseline is red.
- An existing test outside §2.7 needs editing.
- Any scoring, filter, rerank, candidate, snapshot-field, constant or version change seems necessary.
- You need a file outside §1, a migration, or the service role in new code.
- A card would need to show a number or a popularity signal outside the debug panel.

## 8. Acceptance (reviewer checklist)

- [ ] `/api/recommend` and Home both use `buildStageRecommendations`; the response shape the client reads is unchanged apart from the `Recommendation` type.
- [ ] Unprofiled candidates are queued after the response, with at most 5 profiled inline, and it never throws.
- [ ] The stored snapshot's explanation equals the one shown; AI text is guarded per item; the explainer never throws.
- [ ] Legacy Home cache rows force a rebuild and never reach the card.
- [ ] The client never receives an item profile; the card shows no score outside "Why this".
- [ ] The legacy scorer and its tests are gone, and each deleted test is mapped to its Stage 3 replacement.
- [ ] Moved functions are byte-identical; the other Session 5–7A files are unchanged apart from import paths and the `RouteV3` rename.
