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
