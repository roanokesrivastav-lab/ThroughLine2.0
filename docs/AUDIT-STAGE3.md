# Stage 3 recommender audit

Written 2026-09-15, before any Stage 3 code. A review of whether the planned architecture
(`docs/ATTRIBUTES.md`, `docs/RECOMMENDATIONS.md` §14) is a sound foundation both for the
hand-tuned Stage 3 scorer and for the per-user logistic regression planned after ~50 answers.

Nothing here reopens a 🔒 decision. Where a finding touches a numbered entry in
`docs/DECISIONS.md`, the number is cited. No code was changed in the session that wrote this.

**Short verdict.** The shape is right: hard filters, a linear score over named components,
selection-pass diversity, explanation from evidence only, and a prior-regularised per-user
logistic regression over the same components. Those choices are compatible with each other. Nine
things need to change before Stage 3 code starts, and most of them are cheap. The two that matter
most are (1) the attribute spec double-counts several concepts across story and feeling, so the
40/20 split is not the split it claims to be, and (2) the score as currently built does not produce
a fixed feature vector, so the regression could not be trained on it.

---

## 1. Feature architecture

### 1.1 Duplicate and correlated signals

The spec assigns the same concept to several groups. Each duplicate counts twice in the score and
becomes a collinear pair for the regression.

| Concept | Where it lives today | Problem | Single home |
|---|---|---|---|
| Themes | 1B `theme` (42 values) **and** 1C, which is "the v1 vocabulary, kept unchanged" and includes 24 themes | The largest group is scored in both story (0.40) and feeling (0.20). | 1B only. Feeling = tone, register, texture, aftertaste, intensity, ache, pace. |
| Genre | catalogue `genre_tags` → `tag_overlap` component, and 1B `frame`, which is "normalised from catalogue tags" | Same fact scored twice. | `frame`, inside story. `tag_overlap` stays only as the cold-start fallback when an item has no profile yet. |
| Pace | 1C `pace` scalar, 1B `momentum`, 1C `register.propulsive` / `meditative`, film `drive`, TV `hook` | Five readings of one thing. | `pace` scalar in feeling for cross-media; `momentum` in story as the structural kind (episodic-arcs, twisty, cliffhangers), with slow-burn / action-driven removed from it; `hook` stays in form (TV only). |
| Romance | `bond.romance`, `frame.romance`, `tone.romantic`, story scalar `romance`, `theme.love`, `theme.desire` | Six. A romance would match itself six times over. | `frame.romance` (it is a genre), `theme.love` / `desire` (what it is about), `tone.romantic` (how it feels). Drop `bond.romance` and the `romance` scalar. |
| Found family | `bond.found-family` and `theme.found-family` | Identical value in two groups. | `bond`. |
| Hope / darkness | story scalars `hope`, `darkness`; `aftertaste.hopeful`, `aftertaste.devastating`, `tone.bleak` | The scalars restate the words. | Drop the two scalars. |
| Humour | story scalar `humour`; `tone.playful`, `tone.wry`; `frame.comedy` | Same. | Drop the scalar. |
| Complexity | story scalar `complexity`; `texture.dense`; `register.cerebral`; book `reading difficulty` | Same. | Keep `complexity` as the one cross-media scalar; book difficulty is a form band for the time filter. |
| Historical | `setting.historical` and `frame.historical` | Same word, two groups. | `setting`. |
| Systemic / mythic world vs secondary-world vs fantasy | `world`, `setting`, `frame` | Correlated, not identical; acceptable. | Keep, but see specificity below. |

After the merge, story is: theme, arc, conflict, cast, bond, world, setting, frame, structure,
momentum, stakes, ending, plus `moral-complexity` and `complexity`. Feeling is: tone, register,
texture, aftertaste, intensity, ache, pace. The two families share no word.

### 1.2 Signals that belong in candidate generation, not ranking

- Creator link, franchise / series, adaptation-of: retrieval keys and dedupe keys.
- Phase membership: a query ("the active phase's creator / genre / attribute") that fetches candidates.
- Backlog membership, category: filters or sources.

These may still appear in the score as *provenance* flags, but they are not similarity.

### 1.3 Signals that should be hard filters

- Category, hidden, muted, already logged, "already know it" (once answers exist), recently shown.
- Commitment band and reading-time band **when the user asked for a time**. Otherwise they are a
  soft form-fit signal. §9 of RECOMMENDATIONS already says this.
- `ending`: not a ranking input at all. A component that contributes to the score but may never be
  named in the explanation breaks the "route matches arithmetic" invariant (DECISIONS #29). Keep it
  on the profile for a future user-declared mute ("no tragic endings").
- Explicit lyrics, original language, country: not taste. Optional user filters.

### 1.4 Positive vs negative evidence: the reading vector

DECISIONS #51 lets a reading carry negative weights: "there's no quiet feeling" → `register.quiet
= -0.6`. This conflates two different statements:

- **Item-side absence.** The note says the work is *not* quiet. That is a correction to the item
  profile. The user loved it. It is a loved, non-quiet thing.
- **Preference-side dislike.** "I hated how slow it was." That is anti-profile evidence.

A negative weight in a similarity vector does neither cleanly. In cosine, a −0.6 against an item's
+0.7 subtracts from the dot product, and the −0.6 also inflates the norm, so the effect is
asymmetric and impossible to explain in a sentence. The AI extractor writing this vector is also
free to invent "absences" that the user never mentioned.

Change: the reading vector stays non-negative and describes what the user experienced. Two separate
lists carry the rest: `absent: ["register.quiet"]` (explicit negation, used to *zero* that key in
the entry's blended vector and to override the item prior) and `didnt_work: [phrases + keys]`
(anti-profile evidence with the entry's affinity as its weight).

### 1.5 Too subjective or noisy for their weight

- Six story scalars at AI confidence. After 1.1 two remain (`moral-complexity`, `complexity`).
- `rereadability`, `hook`, `filler`, `momentum.unpredictable`: keep on the profile, scored at
  low weight or not at all until real use shows they predict anything.
- `cast.morally-grey` and `theme.identity`, `theme.love`, `theme.family` are nearly universal in the
  kind of work this user base logs. A theme list of 42 with four themes per item will match on the
  common ones constantly. The tag layer already solved this with `tagSpecificity`; the story layer
  needs the same: a per-word specificity computed from word frequency across **item profiles** (not
  user data, not popularity: it is vocabulary frequency, the same thing `TAG_SPECIFICITY` hand-codes).
- Canon `feel` priors and music traits at ≤ 0.5 confidence: already correctly down-weighted /
  excluded.

### 1.6 Meaning changes by media

`pace` (a 100-minute film vs 60 episodes), `register.epic`, `texture.dense` (prose vs image),
`structure.episodic`, `momentum.cliffhangers`, `cast.ensemble`, `complexity`. The spec already
isolates form (1D) per medium, which is right. The rule to enforce in code: **cross-media
similarity uses only 1B and 1C; 1D is compared within medium only**, except one derived scalar,
hours-to-finish, which is comparable across all four.

### 1.7 Absence must mean "no evidence"

- Item has no profile yet → the candidate is **not ranked** (see §3). Today it is scored with the
  component nulled and the weights re-normalised (DECISIONS #30), which works for the deterministic
  score and breaks the regression (§4.3).
- User has no feeling profile (no notes) → the feeling component is dropped for the whole request.
  That is a constant factor across candidates and does not change the ranking, so it needs no
  per-candidate re-normalisation.
- No creator link, no active phase, unknown runtime → value 0, meaning "no lift", never a penalty.
  Today `creator` is 0 for most candidates but its weight stays in the denominator, so every
  candidate not by a loved creator is capped at 90% of the maximum. That is a 10% penalty for
  absence, the opposite of the intent.
- A theme missing from a four-theme AI profile is weak evidence of absence. Shared-key cosine
  already handles this; scalars are skipped when either side lacks them. Keep both.

---

## 2. Ranking function

### 2.1 Is a weighted additive score appropriate?

Yes, and it is the right pairing with the later model: a logistic regression over the same
components *is* a weighted additive score under a sigmoid. The two stages share a feature vector by
construction, which is the whole point of DECISIONS #54. The problems are in the details below,
not the form.

### 2.2 Is 40 / 20 / 15 / 10 / 10 / 5 coherent?

Not as stated, for three reasons.

**Commensurability.** A weight only means what it says if every component has a similar spread
across the candidate set. They do not:

| Component | Raw form | Typical spread over candidates |
|---|---|---|
| story | shared-key cosine over ~12 groups | compressed; most real matches land 0.3–0.8, few near 0 |
| feeling | cosine over 4 groups + 3 scalars | similar |
| form fit | band closeness | mostly 1.0; near-constant |
| creator | profile weight or 0 | 0 for almost every candidate, ≥ 0.4 for a few |
| phase | undefined in the plan | — |
| novelty | 1 − similarity | anti-correlated with story and feeling |

Effective influence is weight × spread. Form at 0.15 with spread ≈ 0 contributes a near-constant
and inflates every total; creator at 0.10 acts as a fixed +0.10 bonus for a handful of items;
novelty at 0.05 is a 5% haircut on story, not a novelty policy.

**Fix: calibrate each component once, with fixed constants.** For story and feeling, map the raw
cosine through a fixed piecewise-linear squash whose anchors are the 10th and 90th percentiles of
pairwise similarity across the profiled catalogue (computed once, stored as constants, versioned as
`feature_version`). The explainer can then say "story match 0.71, well above the usual 0.35". Do
not rank-normalise within a request: that destroys the cross-request stability the regression needs.

**Penalties.** Anti-profile is planned as an adjustment after normalisation. Make it a component
with a negative weight instead (value = similarity to the anti-profile in 0..1, weight −0.15 hand
tuned) so it lives in the same linear form and the regression can learn it. Recently-shown is not a
taste signal; it is a filter or a re-rank rule. The private-score nudge (DECISIONS #12) uses the
*anchor's* private score, and affinity already includes that score when choosing the anchor, so it
is counted twice. Recommendation: drop it, or keep it as a display-only tie-break outside the
feature vector. Not locked; founder's call.

**Creator is counted up to five times.** (1) creator expansion generates the candidate; (2) the
`creator` component scores it; (3) a creator-expanded candidate with no profile weight still gets
`creatorOf ? 0.35`; (4) a `creator_run` phase would score it again under phase fit; (5) same creator
implies similar story and feeling profiles anyway. Keep (2) only. Delete the 0.35 fallback (the
candidate should carry the real profile weight). Phase fit must not use `creator_run` phases.
The ≤ 2 per creator cap handles (5).

**Phase fit duplicates long-term taste when the library is small.** With under ~40 dated entries,
"recent centroid" and "whole centroid" are nearly the same vector. Define phase fit as similarity
to what is *distinctive* about now: the active detected phase's fingerprint attribute (a
`feeling_cluster`'s dominant key, a `genre_run`'s genre, a `category_stretch`'s category), or the
"rising" keys from `buildEvolution`, and null when no phase is active within the last 90 days.
That makes it orthogonal to story/feeling and gives it a real explanation ("fits your autumn 2026
run of things that lingered").

**Novelty does not belong in the scalar.** 1 − similarity to the library is the negative of what
story and feeling reward, so inside the score it can only dilute them. The 70/20/10 mix (§7) is a
slot allocation, done at re-rank: band each candidate by its similarity to the nearest loved anchor
(familiar / adjacent / stretch) and fill slots. Diversity is already a selection pass in the code
(DECISIONS: "never a score mutation"), which is correct; extend it, do not fold it in.

**Collapse.** Story, feeling, tag overlap, creator, phase, anchor and centroid all reward the same
neighbourhood. After the merges above there are five components and one negative; the re-rank pass
adds an attribute-overrepresentation rule (§8 of RECOMMENDATIONS: penalise a theme that already
appears in three of five results).

### 2.3 Cleaner decomposition

```
candidate x (must have an item profile)

score(x) = w_story   · story(x)
         + w_feel    · feeling(x)
         + w_form    · form(x)
         + w_creator · creator(x)
         + w_phase   · phase(x)
         − w_anti    · anti(x)

story(x)   = calib( 0.5 · sim_1B(x, story_centroid) + 0.5 · max_a sim_1B(x, a) )   over loved anchors a
feeling(x) = calib( 0.5 · sim_1C(x, feel_centroid)  + 0.5 · max_a sim_1C(x, a) )
form(x)    = within-medium band closeness, 0..1; 0 when unknown
creator(x) = profile creator weight, 0 when none
phase(x)   = similarity to the active phase's fingerprint, 0 when none active
anti(x)    = calib( sim(x, anti_profile) ), 0 when the anti-profile is empty

fixed denominator: no per-candidate re-normalisation
user-side-missing components (no notes → no feeling profile) are dropped request-wide
```

The anchor that maximised the story or feeling term is kept as the bridge for the explanation.
Route = the component with the largest contribution, as today (DECISIONS #29), with `story` added
to the route list.

Hand-tuned starting weights, given the founder's priorities: story 0.40, feeling 0.20, form 0.15,
creator 0.10, phase 0.10, anti −0.15. Novelty leaves the score. These are the prior means for §4.

---

## 3. Candidate generation vs ranking

| Stage | What happens | Owner |
|---|---|---|
| A. Generate | backlog · canon · creator expansion (top 3 loved creators) · story/feeling neighbours from the profiled catalogue · phase continuation (query the active phase's creator / genre / attribute) | `src/lib/server/recommend.ts` `buildCandidates` |
| A′. Profile or defer | any candidate without an item profile is queued for profiling and **excluded from this request** | new `src/lib/server/profiles.ts` |
| B. Hard filter | category · time / commitment band when asked · in library · hidden · muted · answered "already know it" · shown in the last N days | `scoreCandidates` top |
| C. Rank | §2.3 | `scoreCandidates` |
| D. Re-rank | 70/20/10 stretch slots · ≤ 2 per creator · category mix · attribute overrepresentation · at least one cross-media bridge · one "left turn" | new `rerank()` in `recommend.ts` |
| E. Explain | route + bridge anchor + shared words + the user's own "what I valued" phrases; never `ending` | `fallbackExplanation`, `explainer.ts` |

Each "door" from RECOMMENDATIONS §5 placed:

| Door | Stage | Notes |
|---|---|---|
| Emotional neighbours | A + C | a retrieval source and the `feeling` component |
| Creator expansion | A + C | retrieval source and the `creator` component; nothing else |
| Cross-media bridges | D + E | not a source. A bridge is a *property* of a candidate (anchor category ≠ candidate category). Guarantee one slot at re-rank and say so in the explanation |
| Phase continuation | A + C | retrieval by the active phase's key; the `phase` component |
| Reconnection | **not a recommendation** | served by the resurfacing engine (PRD payoff #2). Keep it out of the ranker so novelty metrics stay honest |
| Novelty | D | stretch band slots |
| Diversity | D | selection rules |
| Anti-preferences | B + C | hidden / muted / already-know are filters; the anti-profile is the negative component |

**Unified ranker, parallel sources.** Doors are not mutually exclusive routes and not separate
rankers. Every candidate carries a `sources: ("backlog" | "canon" | "creator" | "neighbour" |
"phase")[]` provenance list (a candidate can arrive through several). One ranker scores them all.
Provenance is kept for evaluation (acceptance by source) and never affects the score. The "modes"
in §9 (something short, surprise me, from my list) are filters and re-rank policies over the same
ranker, not different rankers.

---

## 4. Future personalised learning

### 4.1 One training example

One **impression**: (user, request, candidate shown, position, feature snapshot at show time,
answer or no answer). Stored per shown item, not per request.

### 4.2 Target

Binary `y`:

| Answer | Label | Reason |
|---|---|---|
| save, loved it, more like this | 1 | explicit acceptance |
| not for me, less like this | 0 | explicit rejection |
| maybe later | excluded from the ranker; logged; the item may be re-shown later | it is about timing, not taste |
| already know it | excluded from the ranker; item filtered from discovery | says nothing about liking |
| too similar | excluded from the ranker; **counts for the stretch-mix policy** | it is a diversity complaint, not an item verdict |
| no answer | excluded initially (weight 0); revisit after real data | implicit negatives are too noisy at n ≈ 50 |

"More like this" additionally strengthens the shown item's route for that session's re-ranking
(RECOMMENDATIONS §10), a policy effect outside the model.

### 4.3 Inputs

Features are the calibrated component values from §2.3, and only those:

```
x = [story, feeling, form, creator, phase, anti,
     is_cross_media, is_backlog, stretch_adjacent, stretch_stretch,
     evidence_is_own_words]
```

Never an item identity, creator name, genre, or title. That is what makes DECISIONS #32 ("not for
me never widens to a creator or genre") hold automatically: the model can only learn how much each
*kind of evidence* matters to this person.

Stays deterministic: candidate generation, hard filters, item profiles, note readings, calibration
constants, diversity rules, explanation.

### 4.4 Normalisation

The fixed per-component calibration (§2.2) is the normalisation. No per-user standardisation: with
50 rows it would learn noise. Indicators are 0/1.

### 4.5 Model and regularisation

Per-user logistic regression, fitted by minimising

```
Σ logloss(y_i, σ(b + w·x_i))  +  λ · ‖w − w0‖²
```

where `w0` is the hand-tuned vector (0.40, 0.20, 0.15, 0.10, 0.10, −0.15, 0, 0, 0, 0, 0). This is a
Gaussian prior centred on the hand-tuned weights, so the model starts *at* Stage 3 and can only be
moved by evidence. Choose `λ` so the prior is worth about 25 pseudo-observations; at n = 50 the
data and the prior have comparable say. Add a box constraint: each weight within [0.5·w0, 1.5·w0]
(and sign-fixed: positive components stay ≥ 0, `anti` stays ≤ 0). No interaction terms. Intercept
free. Solve with a few hundred gradient steps in plain TypeScript; no service.

Conceptually the regularisation says: *the model may shift emphasis between named kinds of
evidence, never invent or invert one.* The explanation stays "story match counted 0.46 for you"
because the weights are still the same named components.

### 4.6 Route-specific vs one model

One global model per user, with the provenance and stretch indicators as features. Route-specific
models would split ~50 answers into ~10 each; that is nothing.

### 4.7 Cold start

Below ~50 labelled examples, `w = w0`. At and after 50, the MAP fit above; the prior already blends
smoothly, so no separate interpolation is needed. Re-fit on every new answer (it is milliseconds).

### 4.8 Stage 3 choices that would block this

1. **Per-candidate re-normalisation** (DECISIONS #30). Makes the feature vector row-dependent; the
   regression cannot use it. Fixed by profile-or-defer (§3) and a fixed denominator.
2. **No feature snapshot at show time.** `query_sessions.results` stores score, route, matched tags
   and bridge id only. It must store the full `x`, the raw and calibrated component values, weights
   used, `feature_version`, `profile_version`, `vocabulary_version`, position, and provenance. This
   is a jsonb change with no migration and should ship *in* Stage 3 even though the feedback table
   does not (DECISIONS #55).
3. **Adjustments outside the linear form.** The surprise blend (multiplicative) and the returnable
   comfort bonus are policies; mark them so and exclude them from `x`.
4. **`feelingWeight(notes)`** makes `w0` depend on evidence count. Acceptable if documented: `w0` is
   a function of the user's evidence, the regression learns deviations from it. Snapshot `w0` too.
5. **Negative reading weights** distort calibration (§1.4).
6. **Novelty in the score** would make the model learn a "novelty weight" from "too similar"
   answers that are not about the item.
7. **Vocabulary changes without a version on the feature vector.** `vocabulary_version` exists on
   extractions; add `feature_version` to the snapshot so training only mixes compatible rows.

---

## 5. Evaluation framework

### 5.1 Offline, available now, no feedback needed

- **Leave-one-loved-out.** For each loved entry with a profile: remove it from the library, rebuild
  profiles, inject it as a candidate among the normal pool, record its rank. Report hit@5 and mean
  rank. This is the primary Stage 3 acceptance test and runs on the fixture library today.
- **Temporal holdout.** Train on entries dated before T, candidates = entries after T plus the pool;
  hit@5 for the later loved items.
- **Component spread.** Mean and standard deviation of each component across the candidate set for
  a request. Flags dominance by scale (§2.2) and a dead component.
- **Determinism** and **displayed arithmetic equals score** (tests already exist; keep).
- **Cold start.** The existing synthetic 10-tap library: five results, ≥ 2 categories, every result
  explained, no route claiming feeling.

### 5.2 Online, once `recommendation_feedback` exists

| Metric | Definition |
|---|---|
| precision@K | positives ÷ answered, per shown list of K |
| acceptance rate | positives ÷ (positives + rejections), overall |
| by source / route / stretch band / category | same, sliced by provenance, route, band, category |
| novelty | mean (1 − max similarity to the library) of shown items; share from creators not in the library |
| intra-list diversity | mean pairwise (1 − similarity) within a list |
| creator repetition | share of lists with two results by one creator |
| category coverage | distinct categories per list; share of lists with a cross-media bridge |
| attribute overrepresentation | max share of any single theme across a list |
| redundancy | Jaccard overlap between consecutive days' lists; repeats within 30 days |
| "too similar" rate | too-similar ÷ answered, per stretch band, the stretch-mix health signal |
| cold-start performance | all of the above for users under 50 answers vs over |

### 5.3 Debugging: why did this get its score

- A pure `explainScore(candidate, profiles)` that returns, per component: raw value, calibrated
  value, weight, contribution, the shared keys with both sides' weights, which anchor won, and which
  filters were passed; plus provenance and the calibration constants used.
- `scripts/explain-rec.ts <user or fixture> [title]` printing that table.
- The `/dev/preview` breakdown panel already renders components; extend it with the shared-keys
  list and the anchor.
- Every impression's snapshot in `query_sessions.results`, so a bad recommendation seen last week
  can be reconstructed exactly.

---

## 6. Implementation recommendation

### A. Must change before Stage 3 implementation

1. **One home per concept** in `docs/ATTRIBUTES.md`: themes leave 1C; drop `bond.romance`,
   `theme.found-family`, `setting`/`frame` overlap, and the `hope`, `darkness`, `humour`, `romance`
   scalars; slow-burn / action-driven leave `momentum`. (§1.1)
2. **Non-negative reading vectors**, with separate `absent` and `didnt_work` lists. (§1.4)
   Touches DECISIONS #51, which is not locked.
3. **Profile-or-defer.** No candidate is ranked without an item profile; unprofiled candidates are
   queued. Then remove per-candidate re-normalisation and use a fixed denominator. (§1.7, §4.8)
4. **Novelty out of the score; stretch bands at re-rank.** (§2.2)
5. **Snapshot the full feature vector, weights and versions per shown item** in
   `query_sessions.results`, with position and provenance. (§4.8)
6. **Creator counted once.** Delete the `creatorOf ? 0.35` fallback; phase fit ignores
   `creator_run` phases. (§2.2)
7. **Anti-profile as a negative linear component; recently-shown as a filter.** (§2.2)
8. **Fixed per-component calibration constants**, versioned as `feature_version`. (§2.2)
9. **`ending` out of ranking.** (§1.3)

### B. Should change, can be deferred

- Story-word specificity from item-profile word frequency (§1.5).
- Merge `tag_overlap` into `story.frame`; keep it as the fallback for unprofiled canon until every
  canon item has a profile.
- Phase fit as the distinctive direction of the active phase (§2.2).
- Drop the private-score nudge, or move it to display-only (§2.2; DECISIONS #12, not locked).
- Attribute-overrepresentation rule at re-rank.
- `explainScore` and `scripts/explain-rec.ts`.
- Leave-one-loved-out and temporal-holdout evaluation as tests.

### C. Current design is sound

- Hard filters before any score; a rejected candidate never gets a number.
- Route derived from the arithmetic, never chosen by hand (DECISIONS #29).
- Diversity as a selection pass, never a score mutation.
- Every component carries value, weight and contribution; the displayed total is the computed total.
- Deterministic; same input, same output; tests assert it.
- Popularity-free candidate sources: backlog, canon, creators the user returns to.
- Item-scoped "not for me" (DECISIONS #32); with component-level features this stays true under
  the learned model without any special handling.
- Closed vocabulary with source and confidence (DECISIONS #53).
- Profiles written server-side, versioned, generated lazily.
- Per-user logistic regression over named components, regularised toward the hand-tuned weights
  (DECISIONS #54): the right model for this data size and for explainability.
- Explanation from matched evidence only; `ending` never named.

### D. Future learning requirements

- `recommendation_feedback` (RLS, user-scoped): `impression_id` (the query_session row plus the
  position), `user_id`, `candidate_key`, `answer`, `answered_at`; the feature snapshot lives on the
  impression, not duplicated here.
- Label mapping as in §4.2. `too similar` feeds the stretch-mix policy, not the ranker.
- Feature vector as in §4.3; no identity features, ever.
- Prior `w0` = the Stage 3 weights; λ ≈ 25 pseudo-observations; box [0.5·w0, 1.5·w0]; sign-fixed.
- Threshold 50 labelled examples; below it `w = w0`.
- Weights shown to the user in the same words as the components.
- Retrain only on rows with the current `feature_version`.

### Recommended Stage 3 architecture

```
library ──► profiles (story, feeling, creator, anti, active phase)     [taste/*.ts, pure]
                              │
catalogue ──► candidates + provenance ──► profile-or-defer ──► hard filters
                                                                   │
                                             score = w · x (fixed denominator, calibrated)
                                                                   │
                                        re-rank: stretch slots · creator cap · category mix
                                                 attribute overrepresentation · one bridge
                                                                   │
                                        explain from evidence (route, anchor, shared words)
                                                                   │
                                        snapshot x, w, versions, position → query_sessions.results
                                                                   │
                            (later) answers → recommendation_feedback → per-user MAP logistic fit → w
```

### Exact files, functions, schemas and tests

| File | Change |
|---|---|
| `docs/ATTRIBUTES.md` | 1C loses themes; remove the duplicates in §1.1; Part 2 gains `absent` and `didnt_work`; Part 4 specifies the impression snapshot |
| `docs/RECOMMENDATIONS.md` §14 | novelty removed from the score; anti as a component; fixed denominator; profile-or-defer; snapshot requirement; calibration |
| `docs/DECISIONS.md` | new entries for each item in A; note that #30 and #51 are superseded and why |
| `src/lib/taste/vocabulary.ts` | v2: `STORY_GROUPS`, `FEELING_GROUPS`, group weights per family, `VOCABULARY_VERSION = "v2"` |
| `src/lib/taste/vector.ts` | `similarity(a, b, family)` restricted to one family; `calibrate(component, raw)` with versioned constants; reject negative weights |
| `src/lib/taste/recommend.ts` | components `story`, `feeling`, `form`, `creator`, `phase`, `anti`; no re-normalisation; `stretchBand()`; `rerank()`; `explainScore()`; route list gains `story`; remove the `creatorOf` fallback and the anchor private-score hint |
| `src/lib/taste/phases.ts` | `activePhase(phases, now)` helper for the phase component |
| `src/lib/taste/tags.ts` | unchanged; `tagOverlap` becomes the `frame` fallback only |
| `src/lib/types.ts` | `Recommendation.breakdown` → `FeatureSnapshot { feature_version, profile_version, vocabulary_version, components, weights, indicators, provenance, position }`; drop the legacy mirror; `Route` gains `"story"` |
| `src/lib/server/recommend.ts` | `buildCandidates` tags provenance and adds neighbour and phase sources; profile-or-defer; recently-shown filter reads `query_sessions`; results store the full snapshot per item |
| `src/lib/server/profiles.ts` (new) | `ensureProfile(item)`: load or queue an AI item profile; lazy, server-only |
| `supabase/migrations/0003_item_profiles.sql` (new) | `media_items.profile jsonb`, `profile_version text`, `profiled_at timestamptz`; no RLS change (catalogue is service-role written) |
| `src/lib/ai/extractor.ts`, `mock-extractor.ts`, `nvidia.ts` | v2 schema: story and feeling groups, `absent`, `didnt_work`, `valued` phrases; non-negative weights |
| `src/lib/ai/explainer.ts` | payload gains story words and the user's `valued` phrases; never `ending` |
| `src/__tests__/scoring.test.ts` | replace the re-normalisation test with: fixed denominator; unprofiled candidate is deferred not scored; creator absent is 0 not a cap; novelty absent from components; stretch slots filled; snapshot complete and versioned; anti lowers the score linearly |
| `src/__tests__/rerank.test.ts` (new) | creator cap, category mix, overrepresentation, one bridge guaranteed |
| `src/__tests__/eval.test.ts` (new) | leave-one-loved-out hit@5 on the fixture library; component spread not degenerate |
| `src/__tests__/extraction.test.ts` | negation lands in `absent`, never as a negative weight |
| `scripts/explain-rec.ts` (new) | prints `explainScore` for a user or the fixture library |
