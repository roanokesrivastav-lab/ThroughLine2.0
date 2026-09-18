# Recommendations — standing specification

> **Status, 2026-09-11.** What ships first is a rule-based **tag baseline**, not the attribute
> engine described below. Tags and creators are derived from the user's own taps and entries,
> matched by overlap, and the emotional layer stays wired in at a weight that rises as notes
> accumulate (`feelingWeight` in `src/lib/taste/recommend.ts`). The founder's reason: get a
> simple, readable engine in front of real use, see what it gets right, and only then layer the
> semantic matching on.
>
> Everything in §1–§12 below therefore becomes **Stage 1.5**, and the old "Stage 1" list in §13
> is what Stage 1.5 contains. Nothing here is cancelled. The seam is already in place: Stage 1.5
> is an upgrade of the `feeling` component, not a replacement of the engine.
>
> **Update, 2026-09-15.** The founder set new priorities before the Stage 3 build:
> - **Film, TV, anime and books are scored story-first.** Story and themes carry the most weight;
>   feeling and mood are second.
> - **Music is profiled but not matched** until the founder settles its specifics.
> - The full attribute list now lives in `docs/ATTRIBUTES.md`. Where it differs from §2, ATTRIBUTES
>   wins.
> - §14 below records the scoring weights and the model choice.

The full target design for Throughline's recommendation system, across all stages. This is
the reference document; `docs/STATE.md` records what is actually built. Nothing here overrides
`docs/PRD.md` §9 — in particular, **popularity contributes zero by default** and no cross-user
data is ever used.

---

## 1. The pipeline

```
User history
→ extract signals
→ build taste profiles
→ generate candidates
→ score candidates
→ diversify results
→ explain each recommendation
→ learn from the user's response
```

Architecture:

```
shared feeling model
+ medium-specific feature model
+ private behavior model
+ current time/phase model
→ deterministic shortlist
→ plain-language explanation
```

The emotional layer stays category-agnostic. Medium-specific layers (audio, cinematic, serial,
prose) are separate vectors that feed the same shared taste model. The engine stays unified;
each category contributes different signals.

---

## 2. Extract more than mood

### 2.1 Shared signals (every medium)

Built from: the user's notes, dimensional reactions, repeated resurfacing responses, private
behavior, completion/drop/revisit, the time period when they loved it, and the creators involved.

```
tone:        tender, bleak, playful, eerie, wry
register:    intimate, epic, quiet, propulsive, cerebral
texture:     spare, dense, dreamlike, gritty, ornate
aftertaste:  lingering, haunting, comforting, bittersweet, cathartic
themes:      grief, family, memory, identity, desire, freedom
scalars:     intensity, ache, pace
```

This lets a book, film and series connect meaningfully:

> You loved the restrained ache in this novel. This series carries the same emotional patience,
> even though its world is much larger.

### 2.2 Music signal types

- **Emotional** — ache, warmth, intensity, melancholy, comfort, euphoria
- **Texture** — sparse, distorted, lush, acoustic, hazy, polished, raw
- **Structure** — tempo, energy, dynamics, repetition, song length
- **Vocal** — intimate, theatrical, restrained, confessional, aggressive
- **Instrumentation** — piano-led, guitar-led, synth-heavy, strings, percussion
- **Production** — lo-fi, spacious, compressed, live-sounding, atmospheric
- **Lyrics** — memory, grief, desire, freedom, loneliness, identity
- **Context** — time of day, season, activity, listening session
- **Behavior** — replayed, skipped, revisited, saved, logged as loved, written about

```
"Re: Stacks"

emotional:
  lonely: 0.88
  intimate: 0.91
  lingering: 0.85
  aching: 0.79

musical:
  acoustic: 0.94
  sparse: 0.91
  low-energy: 0.83
  slow: 0.76
  atmospheric: 0.71
  vocal-intimacy: 0.90
```

### 2.3 Movie attributes

Runtime · director · writers · cinematographer · editors · actors the user repeatedly responds
to · genre and subgenre · visual style · dialogue density · narrative structure · pacing ·
ending type · degree of ambiguity · violence/content intensity · setting and period · language
and country · plot-driven vs atmosphere-driven.

```
Movie:
  runtime: 108 minutes
  pacing: slow
  dialogue_density: high
  visual_style: lush
  narrative_mode: intimate
  ending: bittersweet
  ambiguity: high
  themes: memory, desire, time
```

### 2.4 TV attributes

Series-level by default; the user logs a series, not episodes.

Episode runtime · number of episodes · number of seasons · serialized vs episodic · season
completion · rewatch behavior · episode drop-off point · tone consistency · ensemble vs single
protagonist · slow-burn vs immediate hook · emotional investment over time · cliffhanger
density · creator and writer continuity · season-to-season quality changes.

```
Series:
  episode_runtime: 48 minutes
  structure: serialized
  pace: slow-burn
  emotional_mode: cumulative
  ensemble: yes
  commitment: high
  themes: grief, family, faith
```

### 2.5 Book attributes

Page count · estimated reading time · form (fiction, memoir, essays, poetry, biography) ·
narrative perspective · prose density · sentence complexity · dialogue proportion · chapter
length · emotional directness · plot-driven vs reflective · experimental structure · author ·
translator · series position · themes and recurring motifs · rereadability · readable in short
sessions.

```
Book:
  pages: 260
  estimated_reading_time: 7 hours
  prose: spare
  perspective: first-person
  structure: fragmented
  emotional_directness: restrained
  rereadability: high
  themes: memory, grief, family
```

---

## 3. Multiple taste profiles

Do not create one giant "user taste score". Maintain several:

- **Long-term taste** — what repeatedly survives across years
- **Current phase** — what the user has been drawn to recently
- **Emotional profile** — recurring feelings
- **Texture profile** — recurring sonic or visual qualities
- **Creator profile** — artists, directors, authors, collaborators
- **Context profiles** — what works at night, during work, while travelling
- **Anti-profile** — what they repeatedly drop, skip, or say no longer hits

```
Long-term:      intimate, melancholic, lyrical
Current phase:  energetic, restless, cathartic
Night profile:  quiet, hazy, slow-burning
Avoid recently: overly polished, relentlessly upbeat
```

---

## 4. Weight signals by reliability

```
Explicit words                          highest
Repeated dimensional reactions          very high
Repeated revisits / replays             high
Recent positive resurfacing             high
Completion or sustained listening       medium
One-time skip or drop                   medium
Private score                           low
External popularity                     disabled by default
```

Words are the most powerful signal because they carry meaning behavior cannot:

- Listening to a song once tells you little.
- Replaying it five times tells you more.
- Writing "I play this when I need to feel less alone" tells you the most.

Completion is **not** liking. A person can finish a book they disliked and abandon one they
deeply respect.

### Behavioral signals differ by medium

- **Movies** — started, completed, stopped early, rewatched, "still hits", wrote a note, chose a
  long film despite limited time.
- **TV** — started, completed a season, completed the series, dropped after one episode, returned
  after a long break, rewatched specific seasons, comfort rewatch.
- **Books** — started, completed, abandoned, reread, read slowly over a long period, added quotes
  or notes, returned to specific chapters, "short enough for a weekend".

---

## 5. Candidate generation — independent doors

Never one source. Each door is a distinct route that the explanation can name.

- **A. Emotional neighbors** — items whose emotional vectors resemble things the user loved.
- **B. Medium-feature neighbors** — for music: tempo, energy, vocal style, instrumentation,
  production texture, structure, acoustic/electronic balance. The equivalent of audio-feature
  discovery, but computed from the user's own liked songs. For film: visual/structural fit. For
  TV: episode rhythm and commitment. For books: prose texture and structure.
- **C. Bridge recommendations** — a different medium as the anchor. Throughline's signature
  advantage over a standard recommender.
- **D. Creator expansion** — other work by a loved creator; songwriters and producers behind loved
  songs; artists with similar recurring collaborators; related creator *phases*, not whole
  discographies. Writers, cinematographers, editors, actors for film; translators and literary
  lineage for books. A bridge, not the whole recommendation.
- **E. Album and phase continuation** — three songs from one album → another song from it, related
  songs from the same artist phase, and songs with the same emotional profile by another artist.
- **F. Sequence-aware** — what tends to follow what in the user's own listening:
  `quiet folk → piano → ambient → cathartic vocal`. No one else's data required.
- **G. Reconnection candidates** — not heard recently, once replayed often, tied to strong notes,
  from older phases, marked "would return to". Not new discoveries, but essential to the product.

Candidate pools per medium:

- **Movies** — canon, directors of loved films, writers/actors/cinematographers/editors, emotional
  neighbors, visual-style neighbors, films from the same phase, runtime matches.
- **TV** — creators and writers of loved series, similar commitment length, emotional neighbors,
  similar episode rhythm, current-phase shows, limited series for low commitment.
- **Books** — authors, translators, prose-texture and structure matches, emotional and thematic
  neighbors, length matches, same author-phase or theme cluster, rereadable books.

The pool stays private-history-driven. External catalog data describes an item; it never decides
whether the item is good.

---

## 6. Scoring

### Music

```
emotional similarity        × 0.30
musical similarity          × 0.22
strongest-loved-anchor      × 0.18
context fit                 × 0.10
creator/collaborator link   × 0.08
current-phase fit           × 0.07
novelty/diversity           × 0.05
```

### Movie

```
emotional similarity        35%
visual/structural fit       20%
creator connection          15%
runtime fit                 10%
current phase fit           10%
novelty and diversity       10%
```

### TV

```
emotional similarity        30%
commitment fit              20%
pacing and structure        15%
creator connection          15%
current phase fit           10%
novelty and diversity       10%
```

### Book

```
emotional similarity        35%
prose/structure fit         20%
reading-length fit          15%
author/translator link      10%
current phase fit           10%
novelty and diversity       10%
```

Weights must be configurable and logged in the breakdown. Order of operations:

1. Hard filters first
2. Anti-profile penalties
3. Repetition penalties
4. Recently-seen penalties
5. Candidate diversity rules

The private 1–10 score stays a tiny optional nudge, no more than ±0.03 to ±0.05.

---

## 7. Novelty

A recommender that only finds close neighbors becomes boring. Make novelty explicit:

```
70% familiar emotional territory
20% adjacent territory
10% deliberate stretch
```

```
Familiar:  another sparse, intimate folk song
Adjacent:  a hazy electronic track with the same ache
Stretch:   a louder, rhythmically complex song that preserves the emotional core
```

Discovery without random genre-hopping.

---

## 8. Avoid recommendation collapse

Without safeguards every result becomes "melancholic acoustic songs". Constraints:

- No more than two results from one artist
- No more than two results from one album
- Mix familiar and unfamiliar creators
- Mix categories in the cross-media recommender
- Penalize attributes overrepresented in the last few results
- Preserve one "left turn" option in each batch

---

## 9. Recommendation modes

Do not produce one universal list. Produce modes:

- Follow a feeling
- Continue a phase
- Same creator
- Cross-media bridge
- Something short
- Something immersive
- Something familiar
- Surprise me
- Reconnect with something I already loved

This makes the engine feel intelligent without pretending there is one objective ranking of a
person's taste.

TV commitment length is a hard filter or major preference, never a popularity signal. A user who
loved a ten-episode drama should not automatically get a five-season commitment because the mood
matched.

---

## 10. Feedback

After showing recommendations, allow lightweight responses:

- Save to list
- Loved it
- Not for me
- Maybe later
- Already know it
- Too similar
- More like this
- Less like this

More useful than a rating, because they say what kind of correction is needed:

- **Too similar** → increase novelty
- **More like this** → strengthen that specific feature route
- **Not for me** → must not globally punish the whole artist or genre
- **Already know it** → remove from discovery, may still confirm taste

---

## 11. Explanations as structured evidence

The explainer receives the score breakdown, not just the result:

```json
{
  "recommended": "Song A",
  "anchor": "Song B",
  "shared_emotional": ["ache", "lingering"],
  "shared_musical": ["sparse", "intimate vocal"],
  "creator_link": null,
  "novelty": "electronic production"
}
```

> This connects to "Re: Stacks" through the same spare, intimate ache. The difference is the
> wider electronic space around it.

Claude explains the algorithm's evidence and never invents why the match exists. Every result
names its route: "This connects to something you loved" · "Same emotional register, different
medium" · "Same creator" · "Fits your available time" · "A stretch from your recent phase" ·
"A shorter version of a feeling you return to".

Worked examples:

> You loved Aftersun and The Remains of the Day for their quiet, delayed ache. This film is
> similarly restrained, but its emotional release arrives through memory rather than conversation.

> You loved the slow accumulation of grief in this series. This one has the same patience, but it
> is only eight episodes and reaches its emotional centre more quickly.

> You loved Never Let Me Go for its quiet delivery and devastating implications. This book has the
> same restrained emotional surface, but its subject is family rather than fate.

> This connects to Aftersun through memory, family, and delayed grief. It is a series rather than
> a film, but its first season is only six episodes.

---

## 12. Popularity — off by default, isolated behind a preference

```
Use wider cultural signals:  [ Off by default ]
```

If ever enabled, popularity may affect candidate *availability* or act as a small tie-breaker
only. It must never overpower personal taste. Modes: personal only · personal + trusted catalog
discovery · personal + broader discovery signals. Default:

```
Popularity contribution = 0
```

Never silently mix popularity into the score. Show when the user has enabled it.

---

## 13. Implementation stages

### Stage 1 — Improve the deterministic engine
- More detailed music attributes
- Emotional and musical vector separation
- Multiple taste profiles
- Anti-profile penalties
- Novelty/diversity rules
- "More like this" and "Too similar" feedback
- Better score breakdowns
- Same treatment carried across movies, TV and books

### Stage 2 — Private listening/watching/reading behavior
Replays · skips · completion · saves · revisit frequency · session context. Deserves its own
`media_interactions` table rather than overloading `entries`.

### Stage 3 — Richer metadata
MusicBrainz gives identity and relationships, not sonic depth. Add a replaceable audio-feature
adapter later if API terms permit. Keep that data server-side and normalize it into Throughline's
own feature schema.

### Stage 4 — Personal sequence modeling
What follows what · which contexts correlate with which choices · which recommendations lead to
meaningful reactions · which phases are emerging.

### First implementation (the Stage 1 target)
1. Shared emotional vectors for all categories
2. Movie, TV and book-specific feature vectors
3. Medium-specific hard filters
4. Creator and collaborator bridges
5. Current-phase weighting
6. Anti-profile penalties
7. Novelty and diversity controls
8. Feedback: "too similar", "more like this", "not for me"
9. Explanations generated from the exact matching evidence

---

## 14. Model (Stage 3)

**Superseded 2026-09-17 by `docs/SPEC-STAGE3.md`**, which is now the normative Stage 3
specification for scoring, calibration, profile construction, candidate generation, filtering,
re-ranking, explanation, the impression snapshot and the future learning contract. This section
keeps only the model choice; see it there.

- **Now (Stage 3): a hand-tuned weighted score for film, TV, anime and books.** Six fixed
  components — story 0.40, feeling 0.20, form 0.15, creator 0.10, phase 0.10, anti −0.15 — with
  **no re-normalisation**: the score is the plain weighted sum, and a component without evidence
  contributes 0 rather than being dropped. The form component scores the **length band only**
  (runtime, commitment hours, reading hours); craft words are stored but not scored. Novelty is
  no longer a score term — it is the stretch slot at re-rank. The private score enters only
  through affinity (SPEC §4.1), superseding the separate ±0.05 nudge. Weights and every other
  constant live in `src/lib/taste/weights.ts` under `FEATURE_VERSION = "f1"`.
- **Later: learn the weights from the person's own answers.** A per-user logistic regression
  regularised toward the hand-tuned weights (SPEC §12: κ = 25, ±50% bounds on component weights,
  from n ≥ 50 answers at the current feature_version), so a handful of answers cannot swing it
  and every result stays explainable. Not built in Stage 3; Stage 3 must only produce the
  snapshot data it needs.
- **Rejected** (unchanged, PRD §2.1 and §9): collaborative filtering, matrix factorization,
  two-tower models and LightFM (they need many users' data); embeddings and vector similarity;
  sequence models such as SASRec (too little data); gradient-boosted ranking such as LightGBM
  LambdaMART (overfits a few hundred answers, hard to explain).
