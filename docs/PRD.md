# Throughline — Product Requirements (standing document)

🔒 marks a locked decision. **Only the founder can reopen a locked decision, and only explicitly, outside a coding session. Task friction is not permission to reopen one.** Everything else is a judgment call; see `DECISIONS.md`.

## 1. What this is

Throughline is a private, cross-media personal taste engine. It helps one person understand their own taste — across movies, TV, anime, books and music — by drawing connections between the things they have loved, in feeling and in time, and using those connections to surface things they would never have found otherwise.

## 2. 🔒 Philosophy

1. **Nothing is public. Nothing aggregates.** No shared ratings, averages, "users who liked X", feed, or social graph. A mirror, not a scoreboard.
2. **Ratings can be strange and personal.** A private number plus dimensional reactions plus, most importantly, the user's own words. The words are the real signal.
3. **Consensus is the enemy.** External scores are hidden by default. The user may tap to reveal one; nothing surfaces a crowd score unprompted.
4. **No popularity in the recommender.** Recommendations come from attribute matching against the user's own history. Popularity is used in exactly one place — onboarding — and only to guess what someone is likely to have *encountered*, never what is good.
5. **Low friction beats completeness.** The primary input is reacting to what the app resurfaces, not diligent logging.

## 3. 🔒 The spine

- **Output spine: connection.** The home screen serves connections, not logging, journaling, or list-clearing.
- **Input spine: reacting to what the app resurfaces.** Single taps, mostly. Logging is secondary and never a prerequisite for value.
- Payoff priority: (1) understand my own taste, (2) reconnect with what I already loved, (3) find new things, (4) get through my backlog.

## 4. 🔒 The two engines

- **Engine A — Connection in feeling.** The user's words are extracted into a shared, category-agnostic vocabulary (tone, register, texture, aftertaste, themes, intensity, ache, pace). Matching happens in that space, so a film and a song can connect. Raw notes are stored unchanged and separately from extractions; every extraction carries a `vocabulary_version`.
- **Engine B — Connection in time.** Entries are logged at the smallest honest unit; higher structures are **detected, never declared**: album rollups (3+ songs), creator runs / artist phases, category stretches, genre runs, feeling clusters. Phases are cross-media by nature and feed browse-by-era and taste evolution.

## 5. 🔒 Entry granularity

| Category | Atom | Rollups (detected) |
|---|---|---|
| Movies | Film | Director run, franchise (future) |
| TV | Series | Season (optional, future) |
| Anime | Series | Season (optional, future) |
| Books | Book | Author run, series (future) |
| Music | Song | Album (3+ songs), artist phase (density in time) |

Music is not a separate product. TV is series-level; no episode logging.

## 6. Feature set (v1)

1. **Onboarding** — stage one: up to ten loved things across all categories; stage two: 20–30 single-tap canon cards (loved it / seen it / never heard of it); finish with a first portrait and push opt-in. Skippable and resumable.
2. **Home ("Mirror")** — portrait, 3–5 explained cross-media connections, one resurfacing card, a small recommendations section, empty state that guides into onboarding.
3. **Logging** — search all five categories, status, optional private 1–10 score, optional dimensional reactions, optional private note; save under fifteen seconds, one-handed.
4. **History and browse-by-era** — filters for category/status/year/period; period pages; phases shown as inferred, editable labels with confidence.
5. **Taste evolution** — period-over-period narrative, attribute trends, category mix, phases, representative entries. Editorial, not a chart wall.
6. **Recommendations** — `structured filter → deterministic attribute scoring → AI explanation`. Extracted attributes carry the weight; dimensional reactions are secondary; the private score is a coarse, low-weight nudge. Always 3–5, always explained, cross-media bridges shown prominently. "Surprise me from my list" for the backlog.
7. **Time-aware suggestions** — 20 / 40 / 60 minutes / an evening, short reads, returnables; runtime or session length as a hard filter where available.
8. **Resurfacing** — weekly cadence via daily cron + Web Push; opt-in at onboarding; adjustable cadence; snooze; never more than one pending card; one-tap answers with optional note.

## 7. Architecture

Next.js App Router (TypeScript), Tailwind, shadcn/ui, Supabase Auth + Postgres with RLS on every user-writable table, TanStack Query, Zod, Serwist, Vercel route handlers and cron, Claude API server-side only. One metadata adapter interface: TMDB (movies/TV/anime), Open Library (books), MusicBrainz (music), plus a built-in canon list used for onboarding and as a key-free fallback. Only the Supabase URL and anon key reach the client.

Tables: `users`, `media_items`, `entries`, `reactions`, `extracted_attributes`, `phases`, `phase_members`, `resurface_events`, `query_sessions`, `imported_activity` (reserved, unused), `push_subscriptions`.

## 8. 🔒 Reserved seats — schema only, no feature

History import (`imported_activity` exists; nothing reads or writes it), shareable read-only friend page, availability-aware filtering, cross-media yearly Wrapped.

## 9. 🔒 Do not build, at any size, in any form

Public ratings or aggregate scores; comparisons between users; feeds, friends, follows, public profiles, comments; streaks, goals, badges, gamified consistency; semantic/vector search; prominent external scores; a second native codebase.

If a task appears to require one of these, stop and say so rather than building a small version of it.
