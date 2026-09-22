# Attributes — standing specification

Everything Throughline records about a work, about a person's reaction to it, and about their
behaviour, so the recommender has one agreed list to draw on. Agreed with the founder on
2026-09-15, before the Stage 3 build. `docs/STATE.md` records what is actually built;
`docs/RECOMMENDATIONS.md` says how these attributes are scored.

> **Revised 2026-09-17 to match `docs/SPEC-STAGE3.md` (Stage 3, vocabulary v2).** Where the two
> differ, the spec wins for Stage 3. What changed here: `found-family` left `theme` (it lives in
> `bond`); `romance` left `bond`; `historical` left `frame`; `slow-burn` and `action-driven` left
> `momentum`; the story scalars are now only `moral-complexity` and `complexity`; readings
> (Part 2) are non-negative, with negation recorded as `absent` instead of a negative weight;
> the entry-vector blend table moved to SPEC §4.2. Since the 2026-09-19 cutover (DECISIONS #65) `VOCABULARY_VERSION` is `v2`: new readings
> are written in v2, and historical v1 rows are kept and never relabelled.

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

Weights run from 0 to 1 everywhere — item profiles and user readings alike. A reading that
would have carried a negative weight instead records the key in `absent` (Part 2); negative
vector values are invalid and mark the extraction row failed.

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
| `theme` | grief, love, memory, loneliness, growing-up, obsession, family, home, faith, violence, class, time, identity, freedom, death, friendship, art, nature, power, desire, survival, justice, madness, wonder, ambition, destiny-vs-choice, expectation, exploitation, humanitys-limits, war, revenge, redemption, sacrifice, belonging, duty, truth-and-lies, corruption, legacy, isolation, technology, otherness |
| `arc` | transformation, characters-changing-each-other, parallels-and-foils, self-determination, breaking-expectations, coming-of-age, rise-and-fall, redemption-arc, descent, quest, homecoming |
| `conflict` | vs-self, vs-person, vs-society, vs-system, vs-nature, vs-fate, vs-the-unknown |
| `cast` | ensemble, sprawling-cast, single-protagonist, duo, morally-grey, every-character-a-lead, antihero, underdog |
| `bond` | found-family, rivals, mentor-student, siblings, parent-child, friendship, partners |
| `world` | lived-in, systemic, mythic, grounded, hostile, intimate-scale |
| `setting` | contemporary, historical, near-future, far-future, secondary-world, timeless, urban, rural, school, workplace, wartime, space |
| `frame` | realism, fantasy, sci-fi, horror, crime, mystery, thriller, romance, comedy, adventure, slice-of-life, satire |
| `structure` | linear, nonlinear, multiple-pov, frame-story, unreliable-narrator, mystery-box, anthology |
| `momentum` | suspenseful, unpredictable, episodic-arcs, twisty, cliffhangers |
| `stakes` | personal, community, world, cosmic |
| `ending` *(never shown: spoiler)* | resolved, open, ambiguous, bittersweet, tragic, triumphant |
| story scalars | moral-complexity, complexity |

Notes:
- `systemic` means a world run by rules, such as magic or power systems.
- `bond` is the relationship at the centre of the story. `found-family` is a bond, not a theme.
- `frame` is genre, normalised from catalogue tags where they exist and filled by `ai` where they don't.
- The `complexity` scalar runs from easy to follow (0) to demanding (1).
- `ending` is stored and never scored: it is a spoiler, and it is excluded from similarity
  (SPEC-STAGE3 §1.1 gives it group weight 0).

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
reading and an item profile compare directly. This is SPEC-STAGE3 §1.3, the vocabulary-v2
reading; it is what the Stage 3 extractors will emit.

- **Vector** over 1B and 1C. **Every value is 0..1; negative values are invalid** and mark the
  extraction row failed. What the person said was *not* there is recorded in `absent` instead:
  "there's no quiet feeling" puts `register.quiet` in `absent` (≤ 6 keys, all vocabulary keys).
  `absent` zeroes those keys in that entry's vector when it is built (SPEC §4.2).
- **What didn't work** (`didnt_work`): ≤ 4 vocabulary keys plus ≤ 3 verbatim phrases from the
  note. These are preference evidence and feed the anti-profile (SPEC §4.6). Empty means nothing
  was said, not that nothing was absent.
- **What they valued** (`valued`): ≤ 3 short phrases in their own wording, verbatim substrings of
  the note, e.g. "every character is their own main character".
- **Taps (existing `reactions.dimensions`):** loved, moved me, stuck with me, would return,
  changed my perspective, comforted me, challenged me. Taps raise the entry's weight; they do not
  add words to the reading.
- **Summary** that echoes the person's emphasis, never a default adjective (≤ 60 chars).
- **Quote:** ≤ 160 chars, verbatim, guarded as today.

**How an entry's vector is built** is SPEC-STAGE3 §4.2: with a note, 0.8 reading + 0.2 item
profile; without a note, the item profile alone. The old blend table here (0.7 taps-only, 0.5
nothing) is superseded: no profile and no reading means no vector and the entry is skipped.

## Part 3 — Behaviour & time (mostly built)

- `entries.status`: want, in progress, finished, dropped. Finishing is not liking.
- `entries.private_score` (1–10): enters the system only inside `affinity(e)` (SPEC §4.1,
  ±0.135), superseding the separate ±0.05 scoring nudge (DECISIONS #59, Q4).
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

Where this meets Stage 3: the snapshot stored with each shown result is SPEC-STAGE3 §9, the
feature vector the learner will read is §12.1, and per DECISIONS #32/#59 a "not for me" stays
item-scoped and does **not** feed the Stage 3 anti-profile; "what didn't work" in a note does.

## Part 5 — Taste profiles (computed from Parts 1–4, never stored)

- **Long-term:** what survives across years.
- **Current phase:** recent entries, and detected phases.
- **Story profile:** 1B.
- **Feeling profile:** 1C.
- **Creator profile.**
- **Anti-profile (Stage 3, SPEC §4.6):** dropped entries, "doesn't hit" resurface answers, and
  `didnt_work` keys from v2 readings. "Not for me" is item-scoped and not anti-profile evidence
  (DECISIONS #32, §E Q6); readings carry no negative weights (DECISIONS #61).
