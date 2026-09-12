# Throughline

A private, cross-media personal taste engine. It helps one person understand their own taste across **movies, TV, anime, books and music** by drawing connections between the things they have loved — **in feeling** (what you wrote about them) and **in time** (phases that emerge from clusters of entries).

It is not a rating app, a social network, a watchlist, or a dashboard. Nothing is public. Nothing aggregates. No popularity or crowd scores are used anywhere in recommendations.

## What is here

- **Onboarding as the first resurfacing session** — name up to ten things you loved, then a rapid canon pass (loved it / seen it / never heard of it), ending in a first taste portrait.
- **The Mirror (home)** — an evolving portrait, 3–5 cross-media connections with plain-language "why", one resurfacing card ("Still hits?"), and a small set of explained recommendations.
- **Fast logging** — search all five categories, save in one tap; private 1–10 score, dimensional reactions, and a note are optional. Your note is stored verbatim and never rewritten.
- **History and browse-by-era** — filters by category, status, year; period pages by year, month, quarter, half; detected phases as editable, confidence-labelled chips.
- **Taste evolution** — period-over-period narrative with attribute shifts, category mix, phases and representative entries.
- **Recommendations** — structured filters → deterministic attribute scoring → AI explanation. Time-aware ("I have 20 minutes"), short reads, returnables, "from my list", and "surprise me from my list". Every pick shows why, and a "Why this" breakdown.
- **Resurfacing** — weekly cadence, push opt-in, snooze, anti-annoyance defaults, one-tap answers with an optional note.
- **Installable PWA** with offline fallback and Web Push.

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind v4 · shadcn/ui (Base UI) · Supabase Auth + Postgres with RLS · TanStack Query · Zod · Serwist (service worker + Web Push) · Vercel Route Handlers + Vercel Cron · Claude API (server-side only) · TMDB, Open Library, MusicBrainz behind one adapter interface.

## Run it locally

```bash
npm install
cp .env.example .env.local   # fill in the Supabase values at minimum
npm run dev                   # http://localhost:3000
```

### 1. Supabase (required)

1. Create a project at supabase.com (free tier is fine).
2. From **Project settings → API** copy the URL, the `anon` key, and the `service_role` key into `.env.local`.
3. Apply the schema: open the SQL editor and run `supabase/migrations/0001_init.sql`, or use the CLI:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
4. Optional but recommended for development: **Authentication → Providers → Email → disable "Confirm email"** so sign-up signs you in immediately.
5. Add `http://localhost:3000/auth/callback` to **Authentication → URL configuration → Redirect URLs** (needed for magic links).

Then sign up at `/auth/sign-in`, go through onboarding, and open **Settings → Load demo library** to see the full experience immediately.

### 2. Optional keys

| Variable | What it unlocks | Cost |
|---|---|---|
| `TMDB_API_KEY` | Live search for movies, TV and anime (plus creator expansion and hidden-by-default scores). Without it, those categories search the built-in canon list only. | Free with an account |
| `ANTHROPIC_API_KEY` | Claude reads your notes into the shared emotional vocabulary and writes recommendation explanations. Without it, a deterministic lexicon-based mock does both. | **Real usage cost.** Roughly one small call per note (a few hundred input tokens, ~150 output) plus one call per recommendation batch. On the default `claude-opus-5` that is on the order of a cent or less per note; set `ANTHROPIC_MODEL` to a cheaper model to lower it. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push for the weekly resurfacing reminder. Generate with `npx web-push generate-vapid-keys`. | Free |
| `CRON_SECRET` | Protects `/api/cron/daily`. Vercel sets the header automatically when this env var exists. | Free |
| `MUSICBRAINZ_USER_AGENT` | MusicBrainz requires an identifying user agent with contact info. | Free |

Open Library and MusicBrainz need no key.

### Scripts

```bash
npm run dev         # development server (webpack, service worker disabled in dev)
npm run build       # production build (bundles the service worker)
npm run start
npm run typecheck
npm run lint
npm test            # vitest: engines, extraction, recommendations
npm run icons       # regenerate PWA icons
npm run seed:demo   # CLI demo seeder (needs SUPABASE_SERVICE_ROLE_KEY + DEMO_EMAIL/PASSWORD in .env.local)
```

## Deploy (Vercel)

Set the same environment variables in the Vercel project. `vercel.json` schedules `/api/cron/daily` at 09:00 UTC; Vercel sends `Authorization: Bearer $CRON_SECRET`. The cron retries failed extractions, refreshes detected phases, and sends at most one resurfacing push per user per cadence.

## Accounts and services

- **Supabase** project (free tier) — auth and Postgres. Only the URL and anon key reach the browser.
- **Anthropic API key** — the only paid service; usage driven by the extraction pipeline. Leave empty to use the mock.
- **TMDB** account (free) for the API key.
- **Open Library**, **MusicBrainz** — free, no key; MusicBrainz is rate-limited to ~1 request/second (the adapter throttles).
- **Vercel** (or any Node host) for the web app and cron. Push works on any HTTPS origin.

## Project map

```
src/app/(app)/           screens: mirror, onboarding, add, history, entry, connections, taste, recommend, resurface, settings
src/app/api/             route handlers (search, entries, home, connections, resurface, recommend, taste, phases, settings, push, onboarding, cron, demo)
src/lib/taste/           the engines: vocabulary, vector math, affinity, connections (Engine A), phases (Engine B), portrait, evolution, resurface, recommend
src/lib/ai/              extractor + explainer interfaces, deterministic mock, Claude implementation
src/lib/catalog/         adapter interface; TMDB, Open Library, MusicBrainz, built-in canon
src/lib/server/          Supabase-backed services (entries, extraction queue, phases sync, resurfacing, recommendations, home, demo seed)
supabase/migrations/     schema with RLS on every user-writable table
docs/                    PRD, STATE, DECISIONS
```

See `docs/PRD.md` for the locked scope, `docs/DECISIONS.md` for judgment calls, and `docs/STATE.md` for what has been verified and how.
