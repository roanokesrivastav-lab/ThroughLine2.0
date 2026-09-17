# Attributes — standing specification

Everything Throughline records about a work, about a person's reaction to it, and about their
behaviour, so the recommender has one agreed list to draw on. Agreed with the founder on
2026-09-15, before the Stage 3 build. `docs/STATE.md` records what is actually built;
`docs/RECOMMENDATIONS.md` says how these attributes are scored.

**Priorities (founder, 2026-09-15):**
- Story and themes carry the most weight. Feeling and mood are second.
- All five media are profiled.
- Matching is built for film, TV, anime and books only. Music matching waits until the founder
  settles its specifics.

**Boundaries:**
- Every value is a named word from a closed list; there are no embeddings (PRD §9).
- Nothing here reads another user's data (PRD §2.1).
- Nothing records reception, ratings, awards or popularity (PRD §2.3–2.4). TMDB's `vote_average`
  appears only behind the tap-to-reveal external score and is never an attribute. TMDB's and
  Spotify's `popularity` are never stored.
- The user's raw note is never changed; readings of it live in `extracted_attributes`.

**Every attribute carries:**
- a `source`: `catalog` (TMDB, Open Library, Spotify, MusicBrainz, canon), `ai` (the AI, working
  from the catalogue description plus its knowledge of the work), `user` (extracted from the
  person's own note or taps), or `manual`
- a `confidence` from 0 to 1

Weights run from 0 to 1 on item profiles. Only a user reading (Part 2) may carry negative weights.

---

## Part 1 — Item profile: what the work *is*

The same for everyone and stored once per item. It is written server-side only, versioned, and
generated lazily the first time an item is saved or considered as a candidate. The AI prompt
describes the work and is forbidden from judging quality or reception.

### 1A. Facts — from catalogues, nothing inferred · shown

| Media | Facts |
|---|---|
| All | category, kind, title, release year, country, original language, genre tags, creators with roles, adaptation of, franchise or series |
| Film | runtime |
| TV / anime | episode runtime, episodes, seasons, still airing or ended, limited series |
| Books | pages, series position, form (novel, web novel, light novel, manga, comic, non-fiction, poetry), translator |
| Music | duration, album, track position, artist, songwriters, producers, explicit lyrics |

**Premise** (`ai`, shown): 2–3 spoiler-light sentences about what the work is. No praise words.

### 1B. Story & themes — PRIMARY · `ai` · shown in explanations, except `ending`

| Group | Values |
|---|---|
| `theme` | grief, love, memory, loneliness, growing-up, obsession, family, home, faith, violence, class, time, identity, freedom, death, friendship, art, nature, power, desire, survival, justice, madness, wonder, found-family, ambition, destiny-vs-choice, expectation, exploitation, humanitys-limits, war, revenge, redemption, sacrifice, belonging, duty, truth-and-lies, corruption, legacy, isolation, technology, otherness |
| `arc` | transformation, characters-changing-each-other, parallels-and-foils, self-determination, breaking-expectations, coming-of-age, rise-and-fall, redemption-arc, descent, quest, homecoming |
| `conflict` | vs-self, vs-person, vs-society, vs-system, vs-nature, vs-fate, vs-the-unknown |
| `cast` | ensemble, sprawling-cast, single-protagonist, duo, morally-grey, every-character-a-lead, antihero, underdog |
| `bond` | found-family, rivals, mentor-student, romance, siblings, parent-child, friendship, partners |
| `world` | lived-in, systemic, mythic, grounded, hostile, intimate-scale |
| `setting` | contemporary, historical, near-future, far-future, secondary-world, timeless, urban, rural, school, workplace, wartime, space |
| `frame` | realism, fantasy, sci-fi, horror, crime, mystery, thriller, romance, comedy, adventure, slice-of-life, historical, satire |
| `structure` | linear, nonlinear, multiple-pov, frame-story, unreliable-narrator, mystery-box, anthology |
| `momentum` | slow-burn, suspenseful, action-driven, unpredictable, episodic-arcs, twisty, cliffhangers |
| `stakes` | personal, community, world, cosmic |
| `ending` *(never shown: spoiler)* | resolved, open, ambiguous, bittersweet, tragic, triumphant |
| story scalars | darkness, hope, humour, romance, moral-complexity, complexity |

Notes:
- `systemic` means a world run by rules, such as magic or power systems.
- `bond` is the relationship at the centre of the story.
- `frame` is genre, normalised from catalogue tags where they exist and filled by `ai` where they don't.
- The `complexity` scalar runs from easy to follow (0) to demanding (1).

### 1C. Feeling & mood — SECONDARY · `ai` for items, `user` for readings · shown

The v1 vocabulary, kept unchanged. It is the cross-media bridge and still carries music.

| Group | Values |
|---|---|
| `tone` | warm, tender, bleak, playful, wry, earnest, eerie, lush, austere, cold, wistful, fierce, serene, restless, romantic, melancholy |
| `register` | intimate, epic, quiet, loud, meditative, propulsive, confessional, cerebral |
| `texture` | spare, dense, dreamlike, gritty, ornate, raw, polished, hazy |
| `aftertaste` | lingering, haunting, comforting, unsettling, bittersweet, cathartic, hopeful, numb, energized, devastating |
| feeling scalars | intensity, ache, pace |

### 1D. Form & craft — medium-specific · `ai` unless a catalogue gives it · shown

- **Film:**
  - `visual` (naturalistic, stylised, lush, stark, animated)
  - `dialogue` (sparse, balanced, dialogue-heavy)
  - `drive` (plot-driven ↔ atmosphere-driven)
  - runtime band (under 90, 90–120, 120–150, 150+ minutes)
- **TV / anime:**
  - `format` (serialized ↔ episodic)
  - commitment band (total hours: under 5, 5–15, 15–40, 40+)
  - `hook` (immediate, a few episodes, slow)
  - `filler` (anime: light, moderate, heavy)
  - `animation` (anime: detailed, stylised, limited)
- **Books:**
  - `prose` (spare ↔ ornate)
  - `perspective` (first, third, second, multiple)
  - chapter length (short, medium, long)
  - reading difficulty (easy, moderate, demanding)
  - reading-time band (under 5, 5–10, 10–20, 20+ hours)
  - `rereadability` (low, medium, high)
- **Music — profiled now, not matched yet:**
  - `energy` (low, medium, high)
  - tempo band (slow, mid, fast)
  - `vocal` (intimate, theatrical, restrained, confessional, aggressive, none)
  - `instrumentation` (piano, guitar, synth, strings, percussion, orchestral)
  - `production` (lo-fi, spacious, polished, raw, atmospheric)
  - lyric themes (from the `theme` list)
  - lyric language

  Spotify gives new apps no audio features, so music traits are `ai` at a confidence of 0.5 or
  lower until a better source exists.

---

## Part 2 — A reading: what the person felt and valued

Written per reaction into `extracted_attributes`, using **the same words as 1B and 1C** so a
reading and an item profile compare directly.

- **Vector** over 1B and 1C. **Negative weights are allowed**: "there's no quiet feeling" gives
  `register.quiet = -0.6`. Chips are context for the reader, never injected tags.
- **What they valued:** short phrases in their own wording, e.g. "every character is their own
  main character".
- **What didn't work:** phrases in the same form. These feed the anti-profile.
- **Taps (existing `reactions.dimensions`):** loved, moved me, stuck with me, would return,
  changed my perspective, comforted me, challenged me. Taps raise the entry's weight; they do not
  add feeling words.
- **Summary** that echoes the person's emphasis, never a default adjective.

**How an entry's vector is built:**

| What exists | Reading | Item profile |
|---|---|---|
| A note | 0.8 (negatives subtract) | 0.2 |
| Taps, no note | taps set intensity | 0.7 |
| Nothing | — | 0.5 |

## Part 3 — Behaviour & time (mostly built)

- `entries.status`: want, in progress, finished, dropped. Finishing is not liking.
- `entries.private_score` (1–10): a nudge of at most ±0.05.
- When: `consumed_at`, `consumed_until`, `consumed_precision`.
- `entries.origin`: onboarding pick, canon, log.
- `resurface_events.response`: still hits, doesn't hit, not revisited.
- would return (from taps).

## Part 4 — Answers to recommendations (planned: not part of Stage 3)

The answers are: save, not for me, already know it, maybe later, too similar, more like this,
less like this, loved it.

Each answer stores a snapshot of that result's route and component scores at the moment it was
shown, so later weight learning knows what the engine believed. This needs a new user-writable
table, `recommendation_feedback`, with RLS.

| Answer | Correction |
|---|---|
| Too similar | raise novelty |
| More like this | strengthen that route |
| Not for me | penalise that item and its matched words, never a whole creator or genre |
| Already know it | remove from discovery; it may still confirm taste |

## Part 5 — Taste profiles (computed from Parts 1–4, never stored)

- **Long-term:** what survives across years.
- **Current phase:** recent entries, and detected phases.
- **Story profile:** 1B.
- **Feeling profile:** 1C.
- **Creator profile.**
- **Anti-profile:** drops, "doesn't hit", "not for me", what-didn't-work phrases, negative weights.
