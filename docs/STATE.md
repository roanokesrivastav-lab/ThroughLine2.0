# STATE

Living session log. Distinguish **phone-verified** (opened on a real phone) from **AI-verified** (type check, unit tests, build, or a desktop browser driven by the assistant). Never claim the former for the latter.

## 2026-09-10 — first build session

### Built
- Repo bootstrap: `.gitignore`, MIT `LICENSE`, `README.md`, `.env.example`, `CLAUDE.md`, docs.
- Next.js 16 App Router app with Tailwind v4, shadcn/ui (Base UI), Serwist PWA (manifest, generated icons, offline fallback, push handlers in `src/app/sw.ts`).
- Supabase schema `supabase/migrations/0001_init.sql`: 11 tables, RLS on every user-writable table, indexes, `updated_at` triggers, auth-user → `users` trigger.
- Auth: email/password, magic link, `/auth/callback`, session-refreshing `proxy.ts` that gates app routes and returns 401 JSON for API routes.
- Catalog adapters: TMDB (movie/tv/anime + creator expansion + hidden score), Open Library, MusicBrainz (throttled), built-in canon (~100 titles with feel priors). Graceful degradation to canon when a remote fails or has no key.
- Engines (`src/lib/taste`): vocabulary v1, vector similarity with debuggable shared keys, affinity, connections (Engine A), phase detection (Engine B: creator runs, album rollups, category stretches, genre runs, feeling clusters), portrait, evolution, resurfacing selection, recommendation scoring with hard time filters and surprise mode.
- AI layer: `Extractor` and `Explainer` interfaces; deterministic lexicon mock; Claude implementations using structured outputs; selected by presence of `ANTHROPIC_API_KEY`.
- Server services and 20 route handlers (search, entries CRUD + reactions, home, connections, resurface + respond, recommend, taste, phases + rename/dismiss, settings, push subscribe, onboarding canon + react, cron daily, demo seed, external score).
- Screens: Mirror (home), onboarding (3 stages), add/log sheet, history, browse-by-era (`/history/[period]` incl. `phase-<id>`), entry detail, connections, taste evolution, recommend (+ per category), resurface, settings, sign-in, setup, offline, not-found, error.
- Demo seeder (Settings → Load demo library, and `scripts/seed-demo.ts`).
- Tests: `src/__tests__` (18 tests) covering extraction, similarity, connections, phases, portrait/evolution, resurfacing, recommendations.

### Verified
- **AI-verified:** `tsc --noEmit` clean; `eslint` clean; `vitest` 18/18 passing; `next build --webpack` succeeds and bundles `public/sw.js`; engine output on the demo library reviewed by hand (portrait sentences, five cross-media connections with explanations, recommendations with bridges, time filters).
- **AI-verified (headless browser, no database):** `/dev/preview` (development-only page that renders the Mirror from in-memory fixtures) screenshotted with Playwright at a 390×844 viewport in light and dark themes, and at 1280px: no horizontal overflow, bottom nav on mobile, side rail on desktop, portrait / resurface card / connection cards / recommendation cards / phase chips / history rows all render. `/auth/sign-in` and `/setup` also checked at phone width.
- **Not verified:** any flow against a live Supabase project (no Docker or project credentials were available in the build environment). Sign-up, logging, extraction queue, phase sync, resurfacing responses and the cron were exercised only through types and unit tests of the pure logic.
- **Phone-verified:** nothing yet.

### Known gaps / next
1. Run the migration on a real Supabase project, sign up, load the demo library, and walk onboarding → log → entry → mirror → resurface → recommend on a phone. Fix whatever the live path reveals.
2. Onboarding canon cards have no artwork (canon items are key-free); optional enrichment via TMDB/Open Library at reaction time is wired for search results, not canon cards.
3. Push has not been sent end-to-end (needs VAPID keys + HTTPS origin).
4. Claude extractor/explainer are implemented but untested against the live API in this session.
5. Deferred by design: imports, sharing, availability filtering, Wrapped (schema seat only for imports).

## 2026-09-11 — rule-based tag recommender

### Built
- `src/lib/taste/tag-lexicon.ts`: normalisation across four providers' vocabularies (synonyms, stoplist, 0..1 specificity, single-level tag families). Phase detection now shares its too-broad rule from here instead of a hardcoded list.
- `src/lib/taste/tags.ts`: the derived tag and creator profile. Weights come from `affinity()` over logged entries, so onboarding "loved it" taps outweigh "seen it" with no special case. Dropped entries count against at 0.6 damping. Pinned tags get a floor, muted tags are removed. Also `tagOverlap` (coverage × confidence), `creatorMatch`, `candidateKey`, `availableTags`.
- `src/lib/taste/recommend.ts` rewritten: four named components (tag_overlap, creator, feeling, anchor) blended by `feelingWeight(notes)`, re-normalised over components with evidence, additive adjustments applied after normalisation so the ±0.05 score cap is literal, four routes derived from the dominant component, and route-specific explanations.
- `src/lib/types.ts`: `Recommendation` gains `route` and a data-driven `breakdown` (components, adjustments, matchedTags, tagCoverage, creator) with the original five keys kept as a legacy mirror.
- `src/lib/server/recommend.ts`: loads taste prefs, builds the profile once, shares it with candidate generation so creator expansion and scoring agree.
- `POST /api/recommend/hide` and `GET|PATCH /api/recommend/tags`, both storing to `users.onboarding_prefs.taste`. No migration.
- `src/components/rec-card.tsx`: route pill, matched-tags line, "Not for me" with undo, and a breakdown panel rendered from the component array rather than six hardcoded rows.
- `src/components/taste-tags-editor.tsx` in Settings: optional pin/mute over the user's own vocabulary with derived weights shown.
- `src/lib/ai/explainer.ts`: payload carries the route, matched tags and whether the evidence is the user's own words or a catalogue prior; prompt rules bind the first clause to the route.
- Tests: `src/__tests__/tags.test.ts` (24) and `src/__tests__/scoring.test.ts` (13).

### Verified
- **AI-verified:** `tsc --noEmit` clean, `eslint` clean, `vitest` 55/55, `next build --webpack` succeeds.
- **AI-verified by reading real output:** engine output printed for the demo library and for a synthetic cold-start library (10 canon taps, zero notes). Cold start produces five explained picks routed through tags; the full library routes through feeling, as the evidence blend intends. This is how the overlap mis-calibration in decision 27 was found.
- **AI-verified (headless browser):** `/dev/preview` at 390×844 with the breakdown expanded. Route pill, matched tags, three-column breakdown grid and totals all fit a phone without horizontal overflow.
- **Not verified:** anything against a live Supabase project. The two new API routes, the Settings picker, the hide round trip and the prefs merge have never run against a real database.
- **Phone-verified:** still nothing.

### Next
1. Run migration 0001 on a real Supabase project and walk the whole flow on a phone. This is now the blocking item for judging whether any of this is any good.
2. Watch the breakdowns in real use and decide what the tag layer gets right before starting Stage 1.5.
3. Music tag coverage is the known weak spot: MusicBrainz returns sparse folksonomy tags, so overlap outside the hand-written canon stays coarse. Stage 1.5's medium-specific attributes are the answer, not more tag plumbing.

## 2026-09-11 — temporary dev bypass for email confirmation

### Built
- `src/app/api/dev/confirm/route.ts`: dev-only POST that creates the account with `email_confirm: true` via the service role client, or confirms an existing account of that address without touching its password. Returns 404 in production, 500 if `SUPABASE_SERVICE_ROLE_KEY` is unset.
- `src/app/auth/sign-in/sign-in-screen.tsx`: in development, "Create account" confirms then signs straight in to `/onboarding`; password sign-in that fails with a confirmation error confirms and retries once. A one-line note on the form says the bypass is on. Production behaviour is unchanged.
- `src/proxy.ts`: `/api/dev/` added to `PUBLIC_PREFIXES` so the route is reachable while signed out.

### Verified
- **AI-verified:** `tsc --noEmit` clean; `eslint` unchanged (its 1 error / 86 warnings are all in the generated `public/sw.js`, pre-existing).
- **Not verified:** the route has not been run against the live Supabase project — nothing in this session touched a real database or browser.
- **Phone-verified:** still nothing.

### Next
1. Sign up in dev, confirm the bypass works, and continue the blocked live walkthrough.
2. When confirmation email delivery is fixed (or "Confirm email" is turned off in the dashboard for good), delete `src/app/api/dev/confirm/` and the two `devBypass` branches in the sign-in screen.

## 2026-09-12 — onboarding fixes, approximate dates, Timeline (plan Stages 1 and 2)

Founder testing found: popular titles missing from onboarding search, no way to say what kind of thing you are searching for, no "heard of it, haven't seen it" answer, no way to say when something was consumed, and notes misread ("quiet lingering" for Hunter x Hunter). The founder added TMDB and Spotify keys (Stage 0). The plan has four stages. This session built Stages 1 and 2. Stage 3, the feeling-engine rebuild that fixes the misread notes, is planned but not started.

### Found in live data (read-only query against the founder's project)
- Every canon "Loved it" *had* become a finished entry. History rows never labelled finished items, so it did not look like it. Rows now always show status.
- Songs and a film had been saved as **books** (Spider-Man, Bittersweet Symphony, a Beethoven sonata, all from Open Library) and a song as a cover version from MusicBrainz, because onboarding always searched everything and showed 8 interleaved results.
- Onboarding picks carried duplicate `{loved: true}` reactions.
- `ANTHROPIC_API_KEY` is still not set, so extraction is still the offline lexicon. That is the direct cause of the "quiet lingering" misreads and is Stage 3's territory.

### Built
- **Search:** category tabs on onboarding (shared `CategoryTabs`, also used by Add); text-relevance ranking and de-duplication for "Everything" (`src/lib/catalog/match.ts`); adapters fall through in order; 12 results in onboarding.
- **Spotify adapter** (`src/lib/catalog/spotify.ts`), first for music, then MusicBrainz, then canon.
- **Descriptions:** TMDB overviews shown on search rows, the log sheet, canon cards and entry detail; Open Library descriptions fetched on enrich.
- **Add it yourself** (`src/components/manual-add.tsx`) on onboarding and Add, with a book kind (novel, web novel, light novel, manga, comic, non-fiction, poetry). Server keys manual items per user.
- **Canon answers:** Loved it · Seen it · Want to · Not sure · Never heard (keys 1–5). Cards already added from a live catalogue (matched by title) are skipped.
- **Approximate dates:** `supabase/migrations/0002_consumed_precision.sql`; pure helpers in `src/lib/taste/when.ts`; `WhenPicker` (just now, this year, last year, pick a year and optional season, over a few years, as a kid, as a teen, don't remember) in the log sheet, entry detail, and after each onboarding pick. EntryDTO carries a `when` with an honest label ("~2019", "Summer 2021").
- **Engines:** `entryDate` is the middle of the span; `isDated`; phases use only season-or-finer dates; evolution and date filters skip undated entries.
- **History** groups by the precision each date has (months, seasons, "Sometime in 2019", "Across 2012–2016", Not dated yet, Want to). Period pages accept `2021-summer` style keys.
- **Timeline tab** (`src/app/(app)/timeline/`), with the undated shelf.
- Tests: `src/__tests__/when.test.ts` (10), covering spans, seasons incl. December and leap years, ranges, life stages, undated rules, phases/evolution skipping vague dates, ranking and song-title cleanup.

### Verified
- **AI-verified:** `tsc --noEmit` clean; `eslint` on `src` clean (the project-wide 1 error / 86 warnings remain, all in generated `public/sw.js`); `vitest` 65/65; `next build --webpack` succeeds and includes `/timeline`.
- **AI-verified against live providers (server code run from a script, not the browser):** "across the spider" under Everything now returns the film first; under Film, the film is first. "lord of the mysteries" returns the 2025 TMDB series first and drops unrelated books. "hunter x hunter" returns both anime series first. Spotify credentials work; song results collapse remasters.
- **Not verified:** migration 0002 has **not** been run on the live project (no CLI or database password on this machine). Until it is, saving any entry fails, because the API now writes `consumed_precision`. No screen from this session has been opened in a browser against the live database. Nothing phone-verified.

### Known gaps
- "bittersweet symphony" under Everything misses The Verve's track because Spotify spells it "Bitter Sweet"; the Song tab finds it first.
- TMDB returns behind-the-scenes featurettes alongside films; they rank below the film but still appear.
- Canon cards still have no artwork or description (key-free canon).
- Spotify tracks carry no genre tags, so tag overlap for music added through Spotify is empty until Stage 3.
- NVIDIA provider is wired but not live-tested; it requires `NVIDIA_API_KEY` and `AI_PROVIDER=nvidia`.

### Next
1. Founder: run `supabase/migrations/0002_consumed_precision.sql` in the Supabase SQL editor, restart `npm run dev`, then walk: onboarding search with a category tab, add a web novel by hand, date a pick, answer "Want to" and "Not sure" on canon cards, open `/timeline`, and place something from the undated shelf. Then the same on a phone.
2. Add `ANTHROPIC_API_KEY` before Stage 3.
3. Stage 3 (feeling engine rebuild: vocabulary v2, negation, Claude item profiles, re-extraction) as written in the approved plan.

## 2026-09-13 — NVIDIA provider tested and fixed

Codex had wired an NVIDIA (OpenAI-compatible) provider behind `AI_PROVIDER=nvidia`, defaulting to `openai/gpt-oss-20b`. The founder added a key.

### Found
- The key works (`/models` lists 82 models; a one-word chat call returns in ~1.3 s).
- **The configured model did not work for extraction.** On the founder's Hunter x Hunter note gpt-oss-20b returned no text after 67 s: its reasoning consumed the 2,048-token allowance. With room and `reasoning_effort: low` it answered, but two runs on the same note disagreed badly (second run: warm, comforting, intimate, meditative; love and memory).
- **Nemotron 3 Super read the note well and consistently** across runs: "immersive action epic"; epic, propulsive, cerebral; dense, gritty; power, survival, violence, identity; intensity 0.9, pace 0.85; no "quiet". 15–20 s per note, one of three calls stalled past 60 s.
- The request had no timeout; DeepSeek V4 Flash hung for five minutes.
- Vocabulary v1 still cannot say "ensemble cast", "lived-in world", "power system" or "suspense". Nemotron approximated them with epic/dense/power. That gap is Stage 3.
- Migration 0002 is **still not applied** on the live project, so saving entries still fails.
- Every existing note was read by the lexicon and marked done, so nothing would ever re-read them.

### Built
- `src/lib/ai/nvidia.ts`: 120 s timeout, `reasoning_effort: low` for gpt-oss, 8,192 max tokens, JSON pulled from surrounding prose, clear errors for truncated reasoning; default model `nvidia/nemotron-3-super-120b-a12b`, exported as `nvidiaModel()`.
- `.env.local` and `.env.example`: `NVIDIA_MODEL` set to Nemotron 3 Super (the key line was not touched).
- `POST /api/extractions/reread` and a "Re-read my notes" button in Settings (DECISIONS #48).
- Settings shows the model name, says notes are sent to NVIDIA, and shows Spotify for music when configured.
- DECISIONS: Codex's NVIDIA entry had a duplicate number 32; moved to #45. New #46–48.

### Verified
- **AI-verified:** `tsc` clean, `eslint src` clean, `vitest` 65/65. The NVIDIA extractor code path was run from a script against the live API for three models, as recorded above.
- **Not verified:** the re-read route and Settings button have not run against the database or in a browser. Nothing phone-verified.

### Next
1. Founder: run migration 0002 in the Supabase SQL editor, restart `npm run dev`, then Settings → Re-read my notes.
2. Walk Stages 1–2 in the browser (onboarding tabs, manual add, dating, canon answers, Timeline).
3. Founder writes a small set of contrasting reviews to become the Stage 3 test set, and decides what the algorithm should prioritise before Stage 3 starts.

## 2026-09-15 — attribute spec and model choice (documents only)

No code changed this session.

### Written
- **New `docs/ATTRIBUTES.md`,** the full list of what gets tracked:
  - item facts, premise, story & themes (primary), feeling & mood (secondary), and form & craft for all five media
  - the reading of a note, with negative weights and "what I valued" / "what didn't work" phrases
  - behaviour and time
  - answers to recommendations (planned)
  - the taste profiles derived from all of the above
- **`docs/RECOMMENDATIONS.md`:** a status note (story-first; music profiled, not matched) and a new §14 with the weights and the model choice.
- **`docs/DECISIONS.md`:** #49–55.

### Verified
- Nothing to run: documents only. No attribute reads reception, ratings or popularity. The ATTRIBUTES word lists and RECOMMENDATIONS §14 match each other.

### Next
1. Founder: run migration 0002 in the Supabase SQL editor, restart `npm run dev`, then Settings → Re-read my notes.
2. Founder: write a small set of contrasting reviews as the Stage 3 test set.
3. Stage 3, now scoped by `docs/ATTRIBUTES.md`:
   - vocabulary v2, split into story and feeling groups
   - extraction with negatives and valued phrases
   - item profiles for every catalogue item, probably in a new `media_items.profile` column (migration 0003)
   - a `story` component in `recommend.ts` with the §14 weights

   The feedback table and weight learning are not part of Stage 3.

## 2026-09-15 — Stage 3 recommender audit (documents only)

No code changed this session.

### Written
- **New `docs/AUDIT-STAGE3.md`:** a senior-recommender review of the planned Stage 3 scorer and the
  later per-user logistic regression, at five levels (features, ranking function, candidate
  generation vs ranking, future learning, evaluation), with must-change / deferrable / sound lists,
  a recommended architecture and the exact files, functions, schemas and tests to change.
- Headline findings: themes and several other concepts are scored in both story and feeling, so
  the 40/20 split is not what it claims; per-candidate re-normalisation and negative reading
  weights would block the regression; novelty belongs at re-rank, not in the score; the feature
  snapshot per shown item must be stored in Stage 3 even though the feedback table is later.

### Verified
- Nothing to run: documents only.

### Next
1. Founder reads `docs/AUDIT-STAGE3.md` §6A and decides which of the nine must-change items to
   accept; each touches an unlocked decision (#12, #30, #51) or the attribute spec.
2. Update `docs/ATTRIBUTES.md` and `docs/RECOMMENDATIONS.md` §14 to match the accepted items,
   then start Stage 3.
3. Migration 0002 is still not applied on the live project.

## 2026-09-15 — Stage 3 implementation specification (documents only)

No code changed this session.

### Written
- **New `docs/SPEC-STAGE3.md`:** the normative Stage 3 specification. Exact data model (item profile,
  reading v2, user profile, active phase, anti-profile, candidate provenance, snapshot), the scoring
  formulas and fixed weights, the calibration method (population, pairs, nearest-rank P10/P90, guards,
  provisional constants, versioning), profile construction, candidate sources with caps and dedupe, the
  nine-step filter order, the re-rank algorithm (bands, quotas, caps, bridge repair), explanation rules,
  the impression snapshot contract, the learning contract (x, y, w0, κ = 25, bounds, invalidation), a
  48-case test matrix, the evaluation harness, and eleven open decisions for the founder.
- Five audit proposals revised in §0 of the spec (no request-wide component dropping; form = length only;
  calibrate each half; the left turn is the stretch slot; "not for me" stays out of the anti-profile).

### Verified
- Nothing to run: documents only.

### Next
1. Founder answers `docs/SPEC-STAGE3.md` §E (eleven defaults to confirm or change).
2. Implement in the §B order; each step keeps typecheck, lint, tests and build green.
3. Migration 0002 is still not applied on the live project; 0003 will follow it.

## 2026-09-16 — three small recommender fixes

### Built
- `src/lib/taste/recommend.ts`: deterministic tie-break on the candidate key; anime features (runtime, no episode runtime) take the film path in `estimatedMinutes` and `fitsTime`.
- `src/lib/server/recommend.ts`: `query_sessions.results` stores each shown result's components, adjustments and normalised weight.
- `src/__tests__/scoring.test.ts`: two regression tests (anime feature vs a 40-minute budget; tie order independent of arrival order). DECISIONS #56–58.

### Verified
- **AI-verified:** `tsc --noEmit` clean; `eslint` clean on the touched files; `vitest` full run below.
- **Not verified:** the snapshot write has not run against a live database. Nothing phone-verified.

### Next
1. Founder answers `docs/SPEC-STAGE3.md` §E; then Stage 3 in the §B order.
2. Migration 0002 is still not applied on the live project.

## 2026-09-17 — basic setup checklist

No app code changed this session; local config only.

### Found (read-only query against the live Supabase project)
- **Migration 0002 is still not applied.** `entries.consumed_precision` does not exist on the live
  table, confirmed by a direct query. Every save still fails live, as STATE has said since 2026-09-12.
- `CRON_SECRET` in `.env.local` was still the placeholder `change-me`.
- VAPID keys were empty, so Web Push was disabled.
- `tsc --noEmit`, `eslint`, `vitest` (67/67) and `next build --webpack` are all clean on the current
  working tree; the one lint error and all warnings remain confined to the generated `public/sw.js`.
- 44 files have been modified or added since the last commit (`b1d9297`, 2026-09-10), spanning every
  session through 2026-09-16. Nothing has been committed since.

### Built
- Generated a real VAPID keypair (`npx web-push generate-vapid-keys`) and wrote both halves into
  `.env.local` (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`), local-only, not committed.
- Replaced the placeholder `CRON_SECRET` in `.env.local` with a random 32-byte value.

### Verified
- **AI-verified:** the four commands above, plus a direct read against the live project confirming the
  missing column.
- **Not verified:** push has still not been sent end-to-end (needs a subscribed browser). Nothing
  phone-verified.

### Next
1. Founder: paste `supabase/migrations/0002_consumed_precision.sql` into the Supabase SQL editor and
   run it. This is the one step nothing in this environment can do (no DB password, no Supabase CLI,
   no `psql`).
2. Decide whether to commit the 44 files sitting uncommitted since 2026-09-10.3. When first deploying, copy `.env.local` into the Vercel project's environment variables, including the new `CRON_SECRET` and VAPID keys.
4. Founder answers `docs/SPEC-STAGE3.md` §E; then Stage 3 in the §B order.

## 2026-09-17 — Stage 3 §E answered; safe-scope implementation begins (migration 0003 only)

### Built
- **Founder answered all eleven `docs/SPEC-STAGE3.md` §E questions** (DECISIONS #59): every default confirmed except #9 — the recency window is **14 days**, not the spec's 7, so `RECENCY_DAYS = 14` when `weights.ts` is written.
- **Stage 3 coding scope fixed (DECISIONS #60):** AI sessions implement only the deterministic, low-risk layer (docs sync, vocabulary v2, weights/constants, calibration utility, vector/form utilities, entry-vector plumbing, types, migration 0003, profile construction, deterministic fixtures, profiler interfaces/mock, unit tests) and stop before the recommendation engine, which is reserved for the stronger-model sessions. Approved deviations are recorded there; §E is closed, nothing blocks implementation.
- **`supabase/migrations/0003_item_profiles.sql` written** per SPEC §1.2: six columns on `media_items` (`profile` jsonb, `profile_version` text, `profile_status` text with the pending/done/failed check and 'pending' default, `profile_attempts` int, `profile_error` text, `profiled_at` timestamptz) plus the queue index on `(profile_status, profiled_at)`. No RLS change (DECISIONS #4). Nothing else in this session touched code — the audit of what already exists vs what is missing was delivered in conversation, and batches 2–10 await the founder's go.

### Verified
- **AI-verified:** nothing to run — SQL and documents only. `tsc`/`vitest` untouched.
- **Not verified:** the migration has not run anywhere, not even locally. Nothing phone-verified.

### Next
1. Founder: run `supabase/migrations/0002_consumed_precision.sql` (still not applied live — saving entries still fails) and then `0003_item_profiles.sql` in the Supabase SQL editor.
2. Founder gives the go for the safe-scope batches in order: docs sync → vocabulary v2 → weights → calibration → vector → form → types → entryVector → profile construction → fixtures/profiler interfaces, each left typecheck/lint/test-green.
3. Scoring pipeline, candidate generation, filtering, re-ranking, snapshot wiring, explainer and real profiling are reserved for the stronger-model sessions (DECISIONS #60).

## 2026-09-17 — Stage 3 safe-scope foundation, batches 1–10 (unattended run)

### Built
Ten batches, one green commit each, in the founder-specified lane (DECISIONS #60). Nothing outside the lane was touched: `recommend.ts`, `server/recommend.ts`, the extractors, `explainer.ts`, `rec-card.tsx` and the v1 engines are byte-identical.
1. **Docs sync** (§B1–B3): ATTRIBUTES gets the v2 lists, non-negative readings with `absent`/`didnt_work`/`valued`, Part 4 wired to SPEC §9/§12; RECOMMENDATIONS §14 is a pointer to SPEC-STAGE3 with the fixed six-component sum; DECISIONS #61 records the supersessions (#12, #30, #51) and #62 the v1 pin.
2. **Vocabulary v2, additive** (§B4): story-family lists exactly as specified, G_STORY/G_FEELING (ending weight 0), `familyOf`, `isKnownKeyIn`. `VOCABULARY_VERSION` stays `"v1"` with the pin comment; the v2 exports are read by nothing that writes live rows.
3. **weights.ts** (§B5): FEATURE_VERSION "f1", COMPONENTS, W0, LOVED, MAX_ANCHORS, BAND, QUOTAS, CREATOR_CAP, **RECENCY_DAYS = 14** (founder ruling, #59), PHASE_ACTIVE_DAYS, ANTI_MIN_EVIDENCE, pool/source sizes, PROFILE_VERSION "p1".
4. **calibration.ts** (§3): provisional constants, `cal`/`calStory`/`calFeeling`, pure `calibrate()` with nearest-rank P10/P90 and both guards, exhaustive ≤1500 / seeded 1M-pair sampling, `xorshift32` (see Blocked). 13 tests.
5. **vector.ts additive** (§2.1): `simFamily` (group skipping, per-pair normalisation, scalars), `sharedFamily`, `assertNonNegative`. Legacy similarity untouched. 14 tests.
6. **form.ts** (§1.4): `minutesToFinish`, `band`. `fitsTime`/`estimatedMinutes` stay in recommend.ts (#60). 9 tests.
7. **Types + migration** (§1.2–§1.3, §B13–B15): `ItemProfile`, `Attribute`, `Reading` in types.ts; `MediaItem.profile` optional; MediaItemsRow mirrors 0003; migration committed (founder applies by hand after 0002).
8. **affinity.ts additive + profiler infra** (§4.2, §B8/B16): `entryVectorFamily` (0.8/0.2 blend, absent deletion, no feel_prior), `usableProfile`, `hasOwnWordsV2`; `ai/profiler.ts` with the ItemProfiler interface, PROFILE_VERSION re-export, and the exact `frameFromGenre` table.
9. **profile.ts** (§4): `buildUserProfile` — aff² centroids, ≤40 anchors, form dist (n ≥ 3), active-phase selection, anti-profile with the ≥2-evidence rule; plus `pickActivePhase` exported separately. 21 tests covering §C 7–12, 14 and the §4.3 edges.
10. **Fixture profiles** (§B26): `fixtureProfile` derives a PLACEHOLDER profile from the canon feel_prior via familyOf + form.ts, labeled as such in the code.

### Verified
- **AI-verified:** `tsc --noEmit` clean after every batch; `eslint` clean on every touched file (project totals unchanged: the 1 error / 86–89 warnings all remain in generated `public/sw.js`); `vitest` **124/124** (from 67); `next build --webpack` succeeds. Ten commits, one per batch, none amended.
- **Not verified:** migration 0003 has not run anywhere (not even locally); nothing has run against a live database; nothing phone-verified.

### Blocked (STOP rather than decide)
1. **Mock profiler's overview lexicon (§B16) is unspecified.** No mock profiler was written rather than invent lexicon content; profiler.ts ships the interface + frameFromGenre only. The engine session or the founder must supply the word lists.
2. **§B26's demo-seed content targets are outside the lane** (demo-seeds.ts is a never-touch file): the fixture library does not yet gain its dropped-entry-with-profile / doesnt_hit / negation-note / two-creator / sparse-category rows. The engine session's tests need them added there or the lane widened once.
3. **"The existing xorshift generator" (§3.3) never existed in the repo** (only an unexported FNV hash in recommend.ts). Committed `xorshift32` in calibration.ts, seeded 20260915; the spec-pinned behaviour (seed, count, uniqueness, reproducibility) is implemented and tested identical twice. DECISIONS #63.
4. **§B7's in-place similarity signature change and §B10's move of fitsTime/estimatedMinutes** were pre-approved deviations (#60): both done additively instead.
5. **Route/Recommendation/snapshot type changes (§1.8) are deferred** to the engine session — they would break the legacy engine the lane protects.

### Next
1. Founder: run migrations 0002 (still unapplied live) then 0003 in the Supabase SQL editor.
2. Engine session (Sol/Astra/Opus) picks up §B11 onward: recommend.ts, server pipeline, snapshot, explainer, rec-card, extractor v2 (§B20 — required before any VOCABULARY_VERSION bump), then scripts/calibrate.ts against the profiled canon.
3. Founder supplies or approves the mock profiler lexicon (Blocked #1) before the mock can exist.

## 2026-09-19 — four Stage 3 profile-invariant fixes (pre-integration cleanup)

Tightly scoped cleanup pass before Stage 3 integration. Nothing else changed: the v1
engine, `recommend.ts`, the extractors and `explainer.ts` are byte-identical;
`VOCABULARY_VERSION` stays `"v1"` (#62) and `RECENCY_DAYS = 14` (#59).

### Founder-confirmed
- **Migrations 0002 and 0003 have been applied** to the live Supabase project (SQL editor),
  closing the long-standing "0002 not applied" blocker.

### Fixed
1. **Anti-profile evidence threshold** (`profile.ts`): evidence is now tracked as distinct
   evidence IDs per family — `${entryId}:dropped`, `${entryId}:doesnt_hit`, and one
   `${entryId}:didnt_work` per affected family covering all of that entry's `didnt_work`
   keys collectively. A family becomes non-null only at ≥ `ANTI_MIN_EVIDENCE` distinct IDs
   of that family, so one note with two disliked story keys no longer activates
   `anti.story` on its own. Each valid key still blends as its own one-hot part at its own
   weight. `anti.evidence` remains the global count of distinct `(entryId, source)` pairs.
2. **V2 scalar blending** (`vector.ts`): `blend()` now averages all five reading scalars
   (`intensity`, `ache`, `pace`, `moral-complexity`, `complexity`) defined-only, driven off
   the existing `READING_SCALARS` constant; a missing story scalar is no longer diluted as a
   zero-valued word attribute. Word keys still count missing as zero.
3. **Strict closed-vocabulary checks** (`vocabulary.ts`): `familyOf` resolves only exact v2
   keys — grouped keys must contain exactly one dot and an exactly listed value, bare
   scalars are valid only in their own family — and `isKnownKeyIn` is now
   `familyOf(key) === family`. The anti-profile accepts a `didnt_work` key only when it
   passes validation; malformed or unknown keys neither enter the vector nor count as
   evidence. Legacy `isKnownKey` (v1) is untouched.
4. **Misnamed profiling-category constant** (`profile.ts`): `PROFILED_CATEGORIES` is now all
   five media per DECISIONS #50, readonly via `satisfies readonly Category[]`, with a new
   `MATCHED_CATEGORIES` (movie, tv, anime, book) for Stage 3 matching. Repository search
   confirmed the old export had no consumers.

### Tests
- `src/__tests__/vector.test.ts`: 6 new blend tests (one-sided `complexity` preserved,
  weighted two-sided averaging, `moral-complexity` same, v1 scalars unchanged, word keys
  still diluted, undefined when nobody defines it).
- `src/__tests__/profile.test.ts`: 9 new tests — one entry with two story `didnt_work` keys
  stays null; two entries activate; one entry feeding both families still needs two IDs per
  family; malformed `didnt_work` keys never route nor count; `familyOf`/`isKnownKeyIn`
  strict cases; music profiled but not matched; `entryVectorFamily` preserves a profile
  story scalar the reading omits.

### Verified
- **AI-verified:** `tsc --noEmit` clean; `npx eslint` clean on all five touched files
  (project totals unchanged — the 1 error / 86+ warnings remain in the generated
  `public/sw.js`, untouched); `vitest` **139/139** (from 124); `next build --webpack`
  succeeds; `git diff --check` clean. Commands run sequentially, not concurrently.
- **Not verified:** nothing here runs against a database — all changed code is pure and
  deterministic; no migration was run or needed. Nothing phone-verified.

### Next
1. Stage 3 integration resumes at §B11 (engine session lane): recommend.ts, server
   pipeline, snapshot, explainer, extractor v2 (required before any VOCABULARY_VERSION
   bump), then scripts/calibrate.ts.
2. Founder supplies or approves the mock profiler lexicon (Blocked #1) before the mock
   profiler can exist.

## 2026-09-19 — vocabulary-v2 extraction cutover

The §B20/§B22 reading cutover is complete. This was deliberately limited to extraction,
version-safe persistence/loading, and compatibility with the still-active v1 engines; the
Stage 3 recommendation engine itself was not changed.

### Built
- `VOCABULARY_VERSION` is now `v2`, with an explicit `VOCABULARY_V1_VERSION` retained for
  historical rows and a complete exact-key list used by structured schemas.
- `src/lib/ai/reading.ts` owns the shared v2 Zod contract, empty reading, model prompt and
  verbatim guards. Mock, Claude and NVIDIA now emit the same `Reading` and separated
  `{ story, feeling }` vector. No-note reactions return an empty reading without a model
  call; tapped dimensions no longer manufacture words.
- The deterministic mock implements the specified three-token negation window,
  `didnt_work` preference evidence and verbatim `valued` phrases. Negative/out-of-range
  values are rejected rather than clamped.
- DB/domain loaders distinguish v1 and v2 JSON, attach only current done item profiles,
  and retain both extraction versions. Re-read creates missing v2 rows and resets only
  stale current-version/provider rows; v1 rows are never relabelled. Pending workers only
  process the current vocabulary version. The mock provider may perform a free vocabulary
  upgrade through the same route.
- Legacy engines receive a temporary deterministic projection of v2 feeling plus theme
  evidence, so this cutover does not erase note-derived behavior before the Stage 3 scorer
  lands. Empty story/feeling vectors now mean no evidence, closing the `{}` issue found in
  the preceding review.

### Tests and verification
- `src/__tests__/extraction.test.ts` now covers separated families/schema validity,
  determinism, taps adding no words, negation, `didnt_work`, verbatim `valued` text and
  rejection of negative weights. `profile.test.ts` covers empty-family semantics.
- **AI-verified:** `npm run typecheck` clean; touched-file ESLint clean; `npm test`
  **145/145**; `npm run build` succeeds; `git diff --check` clean.
- **Not verified:** no Claude/NVIDIA request was sent, no live Supabase row was written or
  re-read, and nothing was phone-verified. Migrations 0002 and 0003 remain founder-confirmed
  applied from the preceding session; this cutover needs no migration.

### Next
1. Live-check one new note and one Settings → Re-read flow, then inspect the resulting v2
   `attributes`, nested vector, preserved v1 row and UI summary.
2. Continue the remaining Stage 3 engine lane (`recommend.ts`, server candidates/filters,
   snapshot, deterministic re-ranking and evidence-grounded explanation) without changing
   this feature vector contract.

## 2026-09-22 — v2 cutover committed; docs reconciled; Session 2 planned (documents only after the commit)

### Done
- **Session 1 closed.** Reviewed the uncommitted vocabulary-v2 cutover (Codex's assessment plus a targeted read of the re-read route, extraction queue and loaders) and committed it as `ba22541`. Verified before committing: `npm run typecheck` clean; `npm test` 145/145; `npx eslint src` clean; `npm run build` succeeds; `git diff --check` clean. No model call, database write or re-read was performed.
- **Docs reconciled (founder-approved, no code):** SPEC-STAGE3 recency references now say 14 days (#59); ATTRIBUTES no longer says vocabulary is pinned to v1, and its anti-profile summary no longer lists "not for me" or negative weights; DECISIONS #66 records the Opus-plan → GLM-implement → review → founder-commit workflow (superseding #60's model lane) and names ThroughLine2.0 as the project of record; #67 records the profiler provider (NVIDIA default) and the mock-lexicon ruling, which closes Blocked #1. `docs/handoff/A1-data-model-plan.md` is marked stale and non-authoritative.
- **Session 2 plan written:** `docs/handoff/S2-profiler-contract.md`, for GLM.

### Known live facts (Codex read-only inventory, 2026-09-22)
24 media items, all `pending` with no profile; 24 entries; 19 extractions, all `done | v1 | mock`; 12 query sessions; 2 genre_run phases; no entry has `consumed_precision`. No live row carries Stage 3 data yet.

### Next
1. GLM runs Session 2 (profiler contract) from the handoff; then review, then founder authorizes the commit.
2. Sessions 3–10 per DECISIONS #66.

## 2026-09-22 — Session 2: item profiler contract (GLM, uncommitted)

Implemented `docs/handoff/S2-profiler-contract.md` in full. Nothing committed; the diff awaits Codex review and the founder's authorization. No database read or write, no route, no migration, no dependency change; `package.json` is untouched. No live model call was made — all provider tests use stubbed `fetch` or a hand-written fake Anthropic client, and the suite is offline-safe.

### Built
- `src/lib/taste/vocabulary.ts` — additive only: `CRAFT` (closed per-category craft lists exactly from ATTRIBUTES §1D) and `isCraftKey` (exact-match, like `familyOf`). Nothing existing changed; `VOCABULARY_VERSION` stays `v2` (DECISIONS #68).
- `src/lib/ai/mock-extractor.ts` — refactor only: the lexicon loop moved verbatim into an exported `lexiconVector(text)` returning `{ vector, absent }`; `mockExtract` now calls it and behaves byte-identically (all 145 pre-existing tests pass unedited).
- `src/lib/ai/profile-contract.ts` (new) — `ProfileDraftSchema` (strict: unknown keys rejected, never clamped), `ProfileValidationError`, `buildItemProfile` (the one pure builder: flatten → craft category-check → frame merge with catalogue-wins ties and top-3 cap → music 0.5 confidence cap → strict/lenient completeness → praise-guard premise → form from `form.ts` → deterministic ordering → vector at w×c ≥ 0.05 rounded to 4 decimals), `profilerInput` (the only item data a model sees; overview omitted for manual items; never feel_prior, image, encounter_weight, external_id, scores or unlisted metadata), and `PROFILE_SYSTEM_PROMPT` generated from the constants. Imports no `server-only`.
- `src/lib/ai/profiler.ts` — kept `ItemProfiler` and `frameFromGenre`; added `mockProfile`/`mockProfiler` running `lexiconVector` over the overview (empty for manual items), negated keys dropped, every tag at confidence 0.5, caps enforced by weight with key-ascending ties, then through `buildItemProfile` with `catalog` source and lenient validation. Header comment marks mock profiles as placeholders (like `fixtureProfile`). Deterministic: same item → deep-equal profile.
- `src/lib/ai/nvidia.ts` — added `nvidiaProfiler()` reusing the private `complete()`/`json()` helpers (120 s timeout, fenced-JSON cleanup) and building strict via `buildItemProfile`. Errors propagate.
- `src/lib/ai/item-profiler.ts` (new, imports `server-only`) — `claudeProfiler(client, model)` via `messages.parse` + `zodOutputFormat(ProfileDraftSchema)` with cached system prompt and `effort: "low"`, refusal/missing-output throw; `profilerFor(provider)`; `getProfiler()` cached like `getExtractor`, reusing `aiProvider()`/`anthropicModel()` (NVIDIA default per DECISIONS #67).
- `src/__tests__/profile-contract.test.ts` (new) — §3 tests A–M (contract, caps, merge, craft, music cap, manual/praise guards, form, ordering determinism, leakage), plus two review-round tests: provider-shaped genre normalisation before the frame table, and anime-film runtime in `profilerInput`.
- `src/__tests__/profiler.test.ts` (new) — §3 tests N–T (mock determinism/lexicon/negation/manual, NVIDIA happy + failure paths via stubbed fetch, Claude via a fake client, `profilerFor` names), plus one review-round test: negation drops a key even when the same word matched positively elsewhere. `vi.mock("server-only", () => ({}))`; no test touches the network.
- `docs/DECISIONS.md` — appended #68–#72 exactly as the handoff §4 lists them.

### Review round (Codex review, fixed same session)
Codex reviewed the first green run and identified three contract gaps, each reproduced as a failing test before the fix:
1. **Catalogue frames missed provider-shaped genres.** `buildItemProfile` passed raw `genre_tags` to `frameFromGenre`, but SPEC §1.2 requires `normaliseTags` first — TMDB's `"sci-fi & fantasy"` normalises to `sci-fi` yet produced no catalogue frame. Fixed by normalising before the table; new test asserts `frame.sci-fi` with `source: "catalog"` from that exact tag.
2. **The mock did not always drop negated keys.** `mockProfile` ignored the `absent` set from `lexiconVector`, so in `"A lonely hero. Not a lonely world."` the positive mention kept `theme.loneliness` alive. Fixed by deleting every absent key from the vector before the draft is built; new test covers the mixed positive/negated case.
3. **Anime films lost runtime in the model input.** `profilerInput` gated `runtime_minutes` on movies, while `minutesToFinish` already uses it for anime films; the provider saw less than the form calculation did. Fixed to include it for movie and anime; new test asserts input and form agree on the same number.

### Verified
- **AI-verified (final sequential run, after the review round):** `npm run typecheck` — clean, exit 0. `npm test` — `Tests 168 passed (168)` (145 pre-existing + 23 new). `npx eslint src` — clean, exit 0 (project-wide lint's 1 error / ~86 warnings remain confined to the generated `public/sw.js`, pre-existing and untouched). `npm run build` — `✓ Compiled successfully`, exit 0. `git diff --check` clean.
- **AI-verified only; no live model call, no database write, nothing phone-verified.**

### Deviations
- **Schema shape unchanged; no §2.5 simplification was needed** — `zodOutputFormat` accepts `ProfileDraftSchema` as specified (zod v4 + SDK 0.124), so scalars stay an object of `{ value, confidence }` rather than the array fallback. Recorded here per the handoff's instruction to log such choices.
- **`ProfileDraftSchema` uses `z.strictObject`** (and strict sub-objects) rather than `z.object`: with plain objects Zod strips unknown keys, which would have silently passed test C's unknown-key rejection; the plan's "unknown keys are rejected by the schema" requires strict objects. Same rules, stricter surface.
- **Craft groups enforce one value per group by dropping later duplicates with a reason**, not by failing the whole craft list — the handoff defines a second value in a group as a reason, so only the extra entries are errors.
- One test-authoring fix: test J originally expected band 3 for a 148-minute film; SPEC §1.4 puts 148 in band 2 (120–149). The code was correct; the assertion was fixed.

### STOPs
- None. No existing test needed to change, no file outside §1 was touched, and no spec contradiction was found.

### Next
- Session 3 (canon profiles + extraction QA) — needs the founder's spend approval before any live profiler run.
- Session 4 (profile runtime) — must never persist a mock profile as real without an explicit decision (DECISIONS #72).
