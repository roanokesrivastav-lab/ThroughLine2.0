# Session 7A: Candidate generation and the server pipeline (handoff for GLM)

**You implement this session, debug it yourself until every Verify command passes, and do NOT commit.**
The diff goes to review; the founder authorizes the commit.

**Why Session 7 is split.** DECISIONS #66 lists Session 7 as "server integration + UI". That covers two very different risks:
- building the candidate list and the server function (testable offline), and
- switching what users see (types, routes, Home cache, explainer, rec-card, deleting the legacy scorer).

**7A** (this file) builds the first part and wires it to **nothing**. **7B** (outlined in §9) flips the switch. The live app keeps using the legacy scorer until 7B is committed.

**Outcome in one sentence:** `buildStageRecommendations(store, deps, userId, filters)` builds the six-source candidate list (SPEC §5) and runs Session 6's `rankPipeline`. It persists `results` and `answers.context` exactly as SPEC §9 describes, then returns the snapshots plus the deferred items. It is tested end to end against an in-memory store, with no network and no route calling it yet.

**Prerequisite:** Session 6 (filters.ts, rerank.ts, pipeline.ts, and the buildContext fix) must be reviewed and **committed**. `git status` should be clean apart from `CLAUDE.md`, `.codex/` and `.freebuff/`. If Session 6 is still uncommitted, **STOP**.

---

## 0. Before you start

Read these:
- `CLAUDE.md`
- `docs/PRD.md` §2, §8–§9
- `docs/STATE.md` (the last three entries)
- `docs/SPEC-STAGE3.md` **§1.7, §1.8, §5 (all), §6 steps 8–9, §9 (all), §A, §B rows 18–19, §C rows 22, 23, 43**
- `docs/DECISIONS.md` #59, #66, #78–#91

Read these source files fully:
- `src/lib/server/recommend.ts`: the legacy `buildCandidates` and `buildRecommendations`. **Read only.** Your code sits beside them.
- `src/lib/taste/pipeline.ts` (`rankPipeline`), `src/lib/taste/filters.ts` (`PipelineFilters`, `RecentImpression`)
- `src/lib/taste/score.ts` (`StageCandidate`, `Source`, `SOURCE_ORDER`), `src/lib/taste/snapshot.ts`
- `src/lib/taste/profile.ts` (`buildUserProfile`, `UserProfile`, `usableProfile`, `MATCHED_CATEGORIES`)
- `src/lib/taste/vector.ts` (`similarity`)
- `src/lib/taste/weights.ts` (`POOL_SIZE`, `NEIGHBOUR_TOP`, `PHASE_TOP`, `CREATOR_TOP`)
- `src/lib/taste/tags.ts` (`candidateKey`, `primaryCreator`, `loadTastePrefs`'s shape)
- `src/lib/server/profiles.ts`: especially `ProfileStore` and `supabaseProfileStore`. **Copy that store pattern.**
- `src/lib/server/entries.ts` (`loadLibrary`, `rowToItem`), `src/lib/server/phases.ts` (`loadPhases`)
- `src/lib/catalog/canon.ts`, `canon-data.ts`, `types.ts` (`CatalogAdapter.byCreator`), `index.ts` (`adapterFor`)
- `src/lib/db/types.ts` (`QuerySessionsRow`, `MediaItemsRow`)
- `supabase/migrations/0001_init.sql` (the query_sessions and media_items RLS) and `0003_item_profiles.sql`

**Baseline:** run `npm run typecheck`, `npm test`, `npx eslint src` and `npm run build`. All must be green; write down the test count (290 at Session 6's end). If not, **STOP**.

---

## 1. Scope

| File | Change |
|---|---|
| `src/lib/taste/candidates.ts` (**new**, pure) | `creatorQueries`, `generateCandidates` (§2.1) |
| `src/lib/server/stage-recommend.ts` (**new**, `server-only`) | `RecommendStore`, `supabaseRecommendStore`, `loadRecentImpressions`, `buildStageRecommendations` (§2.2–§2.4) |
| `src/lib/catalog/canon.ts` | `export` the existing `norm`. Nothing else changes. |
| `src/__tests__/candidates.test.ts`, `src/__tests__/stage-recommend.test.ts` (**new**) | §3 |
| `docs/DECISIONS.md`, `docs/STATE.md` | §5, §6 |

**Out of scope. STOP if you need any of these:**
- Any route, `home.ts`, `types.ts`'s `Recommendation`/`Route`, the explainer, `rec-card.tsx`, `api.ts`, or the dev preview. All of that is 7B.
- Deleting or editing the legacy `taste/recommend.ts` or `server/recommend.ts`.
- Calling `ensureProfiles`, `profileItemsNow`, `after()`, or any model. 7A **returns** `deferred`; 7B queues it.
- A migration, or any change to RLS, constants, or Session 5/6 functions.
- A real network call or a real database in tests.

---

## 2. What to build

### 2.1 `candidates.ts`: pure, SPEC §5

```ts
export type CreatorQuery = { creatorKey: string; name: string; category: Category };
export function creatorQueries(P: UserProfile, filters: PipelineFilters): CreatorQuery[]
export function generateCandidates(args: {
  library: EntryWithContext[]; P: UserProfile; filters: PipelineFilters;
  canon: MediaItem[];                                   // CANON as items with id `canon:<slug>` and canonProfile attached
  creatorResults: Map<string, MediaItem[]>;             // creatorKey → results, already hydrated (§2.2)
  pool: MediaItem[];                                    // already loaded and hydrated (§2.2)
}): { candidates: StageCandidate[]; sourceCounts: Record<Source, number>; merged: number }
```

**`creatorQueries`:**
- Take `P.creators` with `weight ≥ 0.4`, in `filters.category` when one is set, and never music.
- Sort by weight desc, then key asc. Keep the top `CREATOR_TOP` (3).
- Return `[]` when `filters.listOnly || filters.surprise`.

**The sources, per §5.** Every source skips music.
- **`backlog`:** every library entry with status `want`. `entryId` = entry id.
- **`canon`:** every `canon` item in `MATCHED_CATEGORIES` (and in `filters.category` when set). Skip it if it's in the library by `canon:slug` or by `norm(title)`.
- **`creator`:** the first 5 of each `creatorResults` list. Skip library matches by `source:external_id` or by `norm(title)`.
- **`story_neighbour`** and **`feeling_neighbour`:**
  - Take pool items ranked by `similarity(profile.vector.<family>, P.<family>.centroid, family)`, descending, ties by key ascending. Keep the top `NEIGHBOUR_TOP` (30).
  - Use the *raw* similarity: calibration is monotone, so it doesn't change the ranking.
  - Skip the source when `P.<family>` is null.
- **`phase`** (from `P.activePhase`; skip it when null):
  - `feeling_cluster`: pool items with `vector.feeling[ph.key] ≥ 0.5`, ranked by feeling similarity to the centroid, top `PHASE_TOP` (20).
  - `genre_run`: pool items whose normalised tags contain `ph.key`, ranked by story similarity, top 20. Use the same tag normalisation `phases.ts` uses to detect genre runs; if you can't find one to reuse, **STOP**.
  - `category_stretch`: adds nothing.
- **`listOnly` or `surprise`:** only `backlog` runs.
- **`creatorKey`** = `${category}:${primaryCreator(item).name.toLowerCase()}`, or null.
- **`key`** = `candidateKey(item)`.

**Deduplication (§5), in order:**
1. **Merge by `key`.** `sources` becomes the union, ordered by `SOURCE_ORDER` with no duplicates. `entryId` is kept if any copy had one. The item kept is the backlog copy if there is one, otherwise the first by `SOURCE_ORDER`.
2. **Merge by `(category, norm(title))`.**
   - Keep the copy whose sources don't include `canon`. If both are live, keep the lower `key`.
   - The winner inherits the union of `sources` (and `entryId` if either copy had one).
   - A backlog entry always wins over a non-backlog copy; a list entry must not disappear. Log this as a decision (§5).

**Output:** sort by `key` ascending. `sourceCounts[s]` counts what each source produced *before* merging. `merged` is the count after both merges.

### 2.2 `RecommendStore`: the only door to the database

Copy the `ProfileStore` pattern (DECISIONS #78). Keep an interface plus a Supabase implementation, so tests can use an in-memory store.

```ts
export interface RecommendStore {
  loadLibrary(userId: string): Promise<EntryWithContext[]>;
  loadPrefs(userId: string): Promise<TastePrefs>;
  loadPhases(userId: string): Promise<Phase[]>;
  /** §5 pool, before the library exclusion: profile_status 'done', profile_version current,
   *  category in `categories`, ordered by profiled_at desc then id asc, at most `limit` rows. */
  loadPool(categories: Category[], limit: number): Promise<MediaItem[]>;
  /** Existing media_items rows for these (source, external_id) pairs, so a creator result
   *  that was already profiled is scored instead of deferred forever (§5). */
  findByKeys(keys: string[]): Promise<MediaItem[]>;
  /** query_sessions rows of this user, kind in `kinds`, created at or after `since`. */
  loadSessions(userId: string, kinds: QuerySessionsRow["kind"][], since: string): Promise<Array<Pick<QuerySessionsRow, "created_at" | "results">>>;
  /** For the legacy recency fallback: media_items uuid → `source:external_id`. */
  keysForIds(ids: string[]): Promise<Map<string, string>>;
  insertSession(row: { user_id: string; kind: QuerySessionsRow["kind"]; category: Category | null; answers: unknown; results: unknown }): Promise<void>;
}
export function supabaseRecommendStore(db: Db): RecommendStore
```

- The Supabase implementation uses the **signed-in user's client** passed in by the caller, **never** `supabaseAdmin()`. RLS already allows reading media_items when signed in and reading or inserting your own query_sessions.
- Every `select` names its columns. The pool select must include the profile columns that `rowToItem` needs to decide `usableProfile`.
- Reuse `loadLibrary`, `loadTastePrefs` and `loadPhases`; don't re-implement them.
- **Pool exclusion:** load `POOL_SIZE + library.length` rows, drop the ones that are in the library by `source:external_id`, then keep the first `POOL_SIZE`.

### 2.3 `loadRecentImpressions` (SPEC §6 step 9, DECISIONS #59)

```ts
export async function loadRecentImpressions(store: RecommendStore, userId: string, now: Date): Promise<RecentImpression[]>
```

It reads sessions of kind `home`, `recommend` and `time` from the last `RECENCY_DAYS` days. `shownAt` is the row's `created_at`. For each element of `results`:
- If the element has a string `key`, it's a Stage 3 snapshot; use it.
- Otherwise it's a legacy row with a string `id`:
  - if `id` contains `:`, it is already the key;
  - otherwise it's a media_items uuid, so resolve it with **one** batched `keysForIds` call. Drop ids that don't resolve.
- Skip anything else without throwing.
- Return every impression. Duplicates are fine, because `filterCandidates` keeps the newest.

### 2.4 `buildStageRecommendations`

```ts
export type StageDeps = { adapterFor: (c: Category) => CatalogAdapter; now: () => Date };
export async function buildStageRecommendations(
  store: RecommendStore, deps: StageDeps, userId: string, filters: PipelineFilters,
  opts: { kind: QuerySessionsRow["kind"] },
): Promise<{ snapshots: ImpressionSnapshot[]; context: SessionContext; deferred: StageCandidate[] }>
```

The steps, in order:
1. Load the library, prefs and phases. Build `P = buildUserProfile(library, phases, prefs, now)`.
2. Build `canon` items from `CANON`: `canonToResult`, id `canon:<slug>`, and `profile: canonProfile(slug)`, stamped exactly as `rowToItem` would.
3. **Unless `listOnly || surprise`:**
   - load the pool (the categories are `[filters.category]` if set, else `MATCHED_CATEGORIES`);
   - run the `creatorQueries` and call `deps.adapterFor(category).byCreator(name, category)` for each, in parallel.
   - One creator failing is logged with `console.warn` and skipped. It never fails the request, which matches legacy behaviour. Don't add a timeout; that is noted for 7B.
4. **Hydrate:**
   - Turn each creator result into a `MediaItem` with id `source:external_id`.
   - Then call `findByKeys` for all of them at once and swap in the existing row wherever one exists. That gives the row's uuid id, its profile, and the same key.
5. `generateCandidates(...)`.
6. `recent = loadRecentImpressions(...)`.
7. `rankPipeline({ P, library, prefs, candidates, filters, recent, userId, now, sourceCounts, merged })`.
8. `insertSession`:
   - `kind: opts.kind`, `category: filters.category`
   - `results: snapshots`, the SPEC §9.1 array itself in display order
   - `answers: { filters, context }`, per SPEC §9.2
   - Nothing from §9.3 is stored: no raw notes, no full profiles, no unshown candidates.
9. Return `{ snapshots, context, deferred }`.

The explanation is the deterministic `snapshot.explanation`. The AI rewrite is 7B.

---

## 3. Tests (offline and deterministic)

Use a fixed `NOW`, `buildFixtureLibrary(NOW, { profiles: "canon" })`, an in-memory `RecommendStore`, and fake adapters that record their calls.

| # | Spec | Test |
|---|---|---|
| A | §C 22 | The same item from `canon` and `story_neighbour` → one candidate, `sources = ["canon", "story_neighbour"]`, and a score identical to the single-source run |
| B | §C 23 | A canon film and a TMDB row with the same normalised title → one candidate, the TMDB key kept, sources unioned |
| C | §5 | A backlog entry is never lost to a title merge; `entryId` survives both merges |
| D | §5 | Music never appears: there are no music creator queries, no music pool items reach the candidate list, and a music creator's adapter is never called |
| E | §5 | `listOnly`, and separately `surprise` → only backlog candidates, zero adapter calls, and the pool is not loaded |
| F | §5 | Neighbours: at most 30 each, in similarity order with ties by key; skipped when `P.story` / `P.feeling` is null |
| G | §5 | Phase source: a `feeling_cluster` phase admits only items with the key ≥ 0.5, at most 20; `category_stretch` adds nothing; no active phase → 0 |
| H | §5 | Creator: the top 3 creators by weight then key, ≥ 0.4 only, first 5 results each; library matches by key and by title are skipped |
| I | §5 | Determinism: permuting the canon, pool and adapter result orders gives identical `candidates` |
| J | §5 | Hydration: a creator result whose key already has a profiled row is scored (it's not in `deferred`); an unknown one is deferred |
| K | §6 s9 | Recency: v3 `key` rows, legacy `id`-with-colon rows, and legacy uuid rows all resolve; `keysForIds` is called once; rows older than 14 days and `surprise` rows are ignored; unresolvable ids are dropped without an error |
| L | §C 43 | End to end: exactly one `insertSession`; `results` deep-equals the returned snapshots; `answers` is `{ filters, context }`; `context.pools` matches `sourceCounts`/`merged` and the filter's removed counts; `L` results for the fixture library |
| M | §9.3 | The stored JSON never contains any `raw_note` text from the fixture library, the key `premise`, `feel_prior`, or any candidate that wasn't shown |
| N | — | One adapter throwing → the request still succeeds, and that creator contributes 0 |
| O | — | Pool: library items are excluded before the 500 cut; the store is asked for `POOL_SIZE + library.length` |

All existing tests stay green and **unedited**.

---

## 4. Verify

1. Loop on `npm test` until green.
2. Run `npm run typecheck`, `npx eslint src` and `npm run build`.
3. `git diff --stat` must list only §1 files; `git diff --check` must be clean.
4. `grep -rn "stage-recommend\|buildStageRecommendations" src/app` must print **nothing**. Nothing is wired in 7A.

No `@ts-ignore`, `eslint-disable`, `any`, or weakened assertions. If the spec and a test disagree, the spec wins. If the spec is ambiguous, that's a STOP.

## 5. DECISIONS to append (continue from the last number)

- **Session 7 is split into 7A (candidates + server function, unwired) and 7B (switch-over).** Delivering both at once would put the switch-over and the pipeline's first real use in the same diff.
- **Creator results are hydrated from existing media_items rows by key before filtering.** Otherwise an item profiled by a previous request would be deferred on every later request, because the adapter never returns a profile.
- **Neighbour and phase ranking use raw family similarity.** Calibration is monotone, so the order is identical and there's no false precision.
- **A backlog copy always wins a title merge.** §5's "prefer the live row" rule was written for canon vs adapter rows; dropping a list entry would break `listOnly` and the backlog route.
- **The recency loader reads v3 `key` and legacy `id` rows.** Legacy rows hold either a `source:external_id` key or a media_items uuid, and the uuids are resolved in one batched read.
- **The stage store uses the signed-in client, never the service role.** Existing RLS covers every read and the one insert.

## 6. STATE entry

`## <date> — Session 7A: candidate generation + server pipeline (GLM, uncommitted)`. Include:
- Built / Verified (paste the real outputs).
- "AI-verified only; no database, no network, nothing phone-verified; nothing is wired to a route; the live app still uses the legacy scorer".
- **Next:** 7B.

## 7. STOP conditions

- Session 6 is uncommitted, or the baseline is red.
- An existing test needs editing.
- A rule needs a constant change, a migration, an RLS change, or a change to a Session 5/6 function.
- You need a file outside §1, or the spec doesn't say how to handle something (for example, the genre-tag normalisation for the phase source).

## 8. Acceptance (reviewer checklist)

- [ ] The six sources follow §5 exactly, including limits, skips, music exclusion, and the listOnly/surprise short-circuit.
- [ ] Both merges keep the union of sources, keep `entryId`, and never lose a backlog entry. The output is sorted by key and doesn't depend on input order.
- [ ] Creator results are hydrated, so profiled items are scored and unknown ones are deferred.
- [ ] Recency reads v3 and legacy rows, over 14 days and the three kinds, with one batched uuid lookup.
- [ ] Persistence matches §9.1/§9.2 and stores nothing from §9.3.
- [ ] The service role key is never used; every select names its columns.
- [ ] Nothing in `src/app` imports the new code; the legacy path is untouched.

---

## 9. Session 7B outline (planned after 7A is committed; not for this session)

7B is the switch-over the founder can see. It'll get its own handoff, but its scope is:

1. **Types:**
   - `Recommendation` per SPEC §1.8 (`score`, `route`, `snapshot`, `explanation`, `fits`, `entryId`), and `Route` as the six routes.
   - Delete `breakdown`/`bridge`. `RouteV3` is renamed away (DECISIONS #82).
2. **Server:**
   - `/api/recommend` and `home.ts` call `buildStageRecommendations`.
   - Home's day cache reads `results` rather than `answers.full` (§9.3 allows removing it).
   - `after()` runs `ensureProfiles(deferred)`, then `profileItemsNow(needing.slice(0, 5))`.
3. **Explainer (Claude and NVIDIA):**
   - The payload is built from the snapshot: `explain`, `shared`, `route`, `anchor`, `rerank.band` (§B row 21).
   - Prompt rules cover the six routes.
   - Any failure or refusal falls back to `snapshot.explanation`.
   - The forbidden-evidence rules (§8.6) are checked on the AI text too.
4. **`rec-card.tsx`:** it renders from the snapshot: the route pill, band label, shared keys, "connects to" the anchor, and the contributions table under "Why this". Still no popularity or external score.
5. **Delete the legacy scorer:**
   - `fitsTime`, `estimatedMinutes` and `daySeed` move to `form.ts`/`score.ts` (§B row 10).
   - `taste/recommend.ts`'s scorer and the legacy `buildCandidates`/`buildRecommendations` go.
   - The dev preview is switched over.
   - The legacy parts of `scoring.test.ts`/`engines.test.ts` are removed; that is the one place 7B may edit existing tests.
6. **Founder checks after 7B:** open Home and Recommend in dev with the real library, then on a phone. Session 9 (controlled live rollout) owns the first profiling run over live items.
