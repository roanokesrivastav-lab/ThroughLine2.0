# Stage 3 implementation specification

Written 2026-09-15 from the repository, `docs/PRD.md`, `docs/ATTRIBUTES.md`, `docs/RECOMMENDATIONS.md` §14,
`docs/DECISIONS.md` and `docs/AUDIT-STAGE3.md`. The audit was a proposal; this document resolves it.
Where this document and the audit differ, this document wins. Where this document and ATTRIBUTES or
RECOMMENDATIONS differ, this document wins for Stage 3 and those two documents are to be updated to match
(listed in §B). Nothing here reopens a 🔒 decision in the PRD.

Normative words: **MUST** is a rule; **SHOULD** is the default unless a stated reason applies; **MAY** is
allowed. Every number in this document is a decision, not an example, unless it is inside a block marked
*Example*.

Notation used throughout:

- A **family** `F ∈ {story, feeling}`. A family vector `V_F` is `Record<key, number>` with every value in
  `[0, 1]`. Keys are `"group.value"` (for word groups) or a bare scalar name.
- `sim_F(u, v)`: the family similarity in §2.1, in `[0, 1]`.
- `cal_F(s)`: the calibration map in §3, in `[0, 1]`.
- `aff(e)`: the affinity of an entry in §4.1, in `[0, 1]`.
- `clamp01(n) = max(0, min(1, n))`.
- `key(x)`: the candidate key, `item.id` when it contains `":"`, else `"${source}:${external_id}"`
  (existing `candidateKey`).
- Ties anywhere are broken by `key(x)` ascending in byte order, unless a rule says otherwise.

---

## 0. Changes to the audit's proposal

Writing the exact rules changed five things in the audit. They are listed once here so nobody implements
the audit by mistake.

1. **No "dropping" of user-side-missing components.** The audit said a component the user has no profile
   for is dropped request-wide. It is simpler and equivalent for ranking to set that component to `0` for
   every candidate and record `has_profile.<component> = false` in the snapshot. There is no
   re-normalisation anywhere in Stage 3, and the sum of weights is never a denominator.
2. **Form is length only.** The 0.15 "form" weight scores the length band (runtime, commitment hours,
   reading hours). Craft words (visual, prose, hook, and so on) are profiled and stored but not scored in
   Stage 3. Pacing and structure already live in story after the §1 merge.
3. **Calibration applies to each half of a component, then the halves are averaged**, rather than to the
   averaged raw value. Both halves are item-to-item or item-to-centroid cosines on the same scale, and this
   keeps one calibration table per family.
4. **The "left turn" is the stretch slot.** There is no separate left-turn mechanism.
5. **"Not for me" items do not feed the anti-profile in Stage 3.** ATTRIBUTES Part 4 says an answer may
   penalise "that item and its matched words"; that is Part 4, which is not Stage 3, and it conflicts with
   DECISIONS #32 until the founder resolves it (§E).

---

## 1. Data model

Types are TypeScript. `jsonb` columns store the JSON form of the same type. Every vector value is a
dimensionless weight in `[0, 1]`. "Absence is evidence" means a missing key is read as `0`; "missing
information" means the reader treats the whole object as not present and applies the rule given.

### 1.1 Vocabulary v2

`src/lib/taste/vocabulary.ts`, `VOCABULARY_VERSION = "v2"`.

Story family groups and values, exactly (after the §1.1 merge in the audit):

| Group | Values |
|---|---|
| `theme` | the 42 values in ATTRIBUTES 1B, minus `found-family` (41) |
| `arc` | transformation, characters-changing-each-other, parallels-and-foils, self-determination, breaking-expectations, coming-of-age, rise-and-fall, redemption-arc, descent, quest, homecoming |
| `conflict` | vs-self, vs-person, vs-society, vs-system, vs-nature, vs-fate, vs-the-unknown |
| `cast` | ensemble, sprawling-cast, single-protagonist, duo, morally-grey, every-character-a-lead, antihero, underdog |
| `bond` | found-family, rivals, mentor-student, siblings, parent-child, friendship, partners (no `romance`) |
| `world` | lived-in, systemic, mythic, grounded, hostile, intimate-scale |
| `setting` | contemporary, historical, near-future, far-future, secondary-world, timeless, urban, rural, school, workplace, wartime, space |
| `frame` | realism, fantasy, sci-fi, horror, crime, mystery, thriller, romance, comedy, adventure, slice-of-life, satire (no `historical`) |
| `structure` | linear, nonlinear, multiple-pov, frame-story, unreliable-narrator, mystery-box, anthology |
| `momentum` | suspenseful, unpredictable, episodic-arcs, twisty, cliffhangers (no `slow-burn`, no `action-driven`) |
| `stakes` | personal, community, world, cosmic |
| `ending` | resolved, open, ambiguous, bittersweet, tragic, triumphant |
| story scalars | `moral-complexity`, `complexity` |

Feeling family groups: `tone`, `register`, `texture`, `aftertaste` exactly as v1, scalars `intensity`,
`ache`, `pace`. **No `theme` group in feeling.** The two families share no key.

Group weights used by `sim_F` (§2.1), fixed for Stage 3:

```
G_story   = { theme: 1.0, arc: 0.8, frame: 0.8, bond: 0.7, conflict: 0.6, cast: 0.6, world: 0.6,
              momentum: 0.6, setting: 0.5, structure: 0.5, stakes: 0.4, ending: 0, scalar: 0.5 }
G_feeling = { aftertaste: 1.0, tone: 0.9, register: 0.55, texture: 0.55, scalar: 0.5 }
```

`ending` has weight `0`: it is stored and never scored (§1.3 of the audit).

### 1.2 Item profile (`media_items.profile`)

Migration `0003_item_profiles.sql` adds to `media_items`:

| Column | Type | Null means |
|---|---|---|
| `profile` | `jsonb` | no profile exists |
| `profile_version` | `text` | no profile exists |
| `profile_status` | `text` check in `('pending','done','failed')`, default `'pending'` | — (not null) |
| `profile_attempts` | `int` default 0 | — |
| `profile_error` | `text` | no error |
| `profiled_at` | `timestamptz` | never profiled |

No RLS change: `media_items` is service-role written (DECISIONS #4). A profile is usable iff
`profile_status = 'done'` **and** `profile_version = PROFILE_VERSION` (the constant in code).

```ts
type Attribute = { key: string; weight: number; source: "catalog" | "ai" | "manual"; confidence: number };
// key: "group.value" or scalar name; weight ∈ [0,1]; confidence ∈ [0,1]

type ItemProfile = {
  profile_version: string;                 // "p1"; bump when the prompt, schema or merge rules change
  vocabulary_version: string;              // "v2"
  premise: string | null;                  // ≤ 400 chars, spoiler-light, no praise words; null for manual items
  story: Attribute[];                      // every key from the story family; ≤ 4 theme, ≤ 2 arc, ≤ 2 conflict, ≤ 3 cast, ≤ 2 bond, ≤ 2 world, ≤ 3 setting, ≤ 3 frame, ≤ 2 structure, ≤ 3 momentum, exactly 1 stakes, exactly 1 ending, both scalars
  feeling: Attribute[];                    // ≤ 4 tone, ≤ 3 register, ≤ 3 texture, ≤ 3 aftertaste, all 3 scalars
  form: {                                  // medium-specific; only the block for the item's category is present
    minutes_to_finish: number | null;      // §1.4; null = unknown
    band: 0 | 1 | 2 | 3 | null;            // §1.4; null = unknown
    craft: Attribute[];                    // ATTRIBUTES 1D words; stored, not scored in Stage 3
  };
  vector: { story: Record<string, number>; feeling: Record<string, number> };
  // vector[F][key] = clamp01(weight × confidence) for every attribute of family F with weight × confidence ≥ 0.05, computed at write time. This is the only thing the scorer reads.
};
```

Rules:

- Absence of a key in `vector` is evidence that the work does not carry it (AI profiles are asked to list
  everything that applies, with the caps above). Absence of the whole profile is missing information
  and the item is not ranked (§6).
- Music items get `story`, `feeling` and `form.craft` like any other; they are never candidates in Stage 3
  (§6 step 1).
- `frame` merge rule: catalogue genre tags are normalised with the existing `normaliseTags` and mapped to
  frame values by the table in §B (`frameFromGenre`), each with `weight 1.0, source "catalog",
  confidence 0.9`; the AI's frame values are added; where both name the same value the higher
  `weight × confidence` wins.
- Manual items (source `manual`) are profiled from title, creators and book kind only; premise is null.

### 1.3 Reading (`extracted_attributes`, vocabulary v2)

```ts
type Reading = {                         // extracted_attributes.attributes
  story: Record<StoryGroup, WeightedTag[]>;   // same caps as ItemProfile.story; scalars omitted when the note gives no evidence
  feeling: Record<FeelingGroup, WeightedTag[]>;
  scalars: Partial<Record<"intensity" | "ache" | "pace" | "moral-complexity" | "complexity", number>>;
  absent: string[];                      // keys the person explicitly said were not there; ≤ 6; must be vocabulary keys
  didnt_work: { keys: WeightedTag[]; phrases: string[] };  // ≤ 4 keys, ≤ 3 phrases (verbatim substrings of the note)
  valued: string[];                      // ≤ 3 verbatim substrings of the note, the person's own wording of what they valued
  summary: string;                       // ≤ 60 chars
  quote: string | null;                  // ≤ 160 chars, verbatim, guarded as today
};
// extracted_attributes.vector: { story: Record<string, number>; feeling: Record<string, number> }
// every value ∈ [0, 1]; NEGATIVE VALUES ARE INVALID and the row is marked failed
```

`WeightedTag = { key: string; weight: number }` with `weight ∈ [0, 1]` (the existing type). Taps
(`reactions.dimensions`) do not add keys to the reading; they only change `aff(e)` (§4.1). The mock
extractor's `DIMENSION_TAGS` is removed.

`absent` is evidence about the *item as this person experienced it*: it zeroes those keys in the entry
vector (§4.2). `didnt_work.keys` is evidence about *preference* and feeds the anti-profile (§4.6). An
empty `absent` or `didnt_work` means nothing was said, not that nothing was absent.

### 1.4 Form: length band

`minutes_to_finish(item)`:

| Category | Formula | Unknown when |
|---|---|---|
| movie | `metadata.runtime_minutes` | runtime missing |
| tv, anime | `episodes × episode_runtime_minutes`; anime with `runtime_minutes` (a film) uses that | either missing |
| book | `pages × 1.6` | pages missing |

`band(minutes)` per category, index `0..3`:

| Category | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| movie | < 90 | 90–119 | 120–149 | ≥ 150 |
| tv, anime | < 300 (5 h) | 300–899 | 900–2399 | ≥ 2400 (40 h) |
| book | < 300 (5 h) | 300–599 | 600–1199 | ≥ 1200 (20 h) |

`band = null` when minutes are unknown. Null is missing information: the form component is `0` for that
candidate and `has_evidence.form = false` in the snapshot.

### 1.5 User taste profile (computed, never stored, except as the snapshot context in §9)

```ts
type FamilyProfile = { centroid: Record<string, number>; anchors: Anchor[] } | null;
// null = the user has no loved profiled entry (§4.3); the component is 0 for every candidate
type Anchor = { entryId: string; itemId: string; category: Category; vector: Record<string, number>; affinity: number; ownWords: boolean };

type UserProfile = {
  story: FamilyProfile;
  feeling: FamilyProfile;
  form: Partial<Record<Category, { dist: [number, number, number, number]; n: number }>>;
  // dist sums to 1; n = loved entries with a known band in that category; the category is absent when n < 3
  creators: Map<string, CreatorAffinity>;       // existing type from tags.ts, key = `${category}:${name.lower}`
  activePhase: ActivePhase | null;              // §1.6
  anti: { story: Record<string, number> | null; feeling: Record<string, number> | null; evidence: number };
  // a family is null when its evidence count is < 2 (§4.6); evidence = distinct contributing entries + keys
  evidence: { loved: number; notes: number; profiled: number };
};
```

### 1.6 Active phase

```ts
type ActivePhase = {
  id: string; kind: "feeling_cluster" | "genre_run" | "category_stretch";
  label: string; end_at: string; confidence: number;
  key: string;            // feeling_cluster: the dominant vocabulary key (v2); genre_run: the normalised genre; category_stretch: the category
  second: string | null;  // feeling_cluster only
};
```

Selection (§4.7). `null` means no phase is active; the phase component is `0` for every candidate and
`has_evidence.phase = false`.

### 1.7 Candidate and provenance

```ts
type Source = "backlog" | "canon" | "creator" | "story_neighbour" | "feeling_neighbour" | "phase";
const SOURCE_ORDER: Source[] = ["backlog", "canon", "creator", "story_neighbour", "feeling_neighbour", "phase"];

type Candidate = {
  key: string;                 // key(x)
  item: MediaItem;             // with profile loaded
  entryId: string | null;      // backlog entries only
  sources: Source[];           // ≥ 1, ordered by SOURCE_ORDER, no duplicates
  creatorKey: string | null;   // `${category}:${primaryCreator.lower}` or null when no creator
};
```

Provenance never affects the score. It is stored for evaluation (§11) and as a learning feature (§12).

### 1.8 Feature snapshot and recommendation result

See §9 for the full contract. In memory, `Recommendation` becomes:

```ts
type Recommendation = {
  item: MediaItem; entryId?: string;
  score: number;                 // S(x), §2.7
  route: Route;                  // "story" | "feeling" | "form" | "creator" | "phase" | "backlog"
  snapshot: ImpressionSnapshot;  // §9, everything the explanation and the learner need
  explanation: string;
  fits: string | null;
};
```

The legacy `breakdown` mirror (`attribute_similarity`, `bridge_similarity`, `reaction_bonus`,
`score_hint`, `creator_bridge`) is deleted. `rec-card.tsx` and the explainer read `snapshot`.

### 1.9 Version fields

| Field | Lives on | Bump when |
|---|---|---|
| `vocabulary_version` (`"v2"`) | readings, item profiles, snapshots | any word list changes |
| `profile_version` (`"p1"`) | item profiles, snapshots | the profiling prompt, schema, caps or merge rules change |
| `feature_version` (`"f1"`) | snapshots, learned weights | anything that changes `x` for the same inputs: component set, formulas, group weights, weights `w0`, calibration constants, band thresholds, affinity formula |
| `calibration_id` | `calibration.ts`, snapshots | the calibration script is re-run (§3.6) |

A `feature_version` bump is required whenever `calibration_id` changes.

---

## 2. Scoring

### 2.1 Family similarity `sim_F(u, v)`

Inputs: two family vectors of the same family. Output: `[0, 1]`.

```
sim_F(u, v):
  total = 0; weight = 0
  for each word group g of family F with G_F[g] > 0:
    U = keys of u in group g; V = keys of v in group g
    if U is empty or V is empty: continue                       # group skipped: missing on one side
    dot = Σ_{k ∈ U ∩ V} u[k]·v[k]
    cos = dot / (‖u_g‖ · ‖v_g‖)      where ‖u_g‖ = sqrt(Σ_{k∈U} u[k]²); if either norm is 0: cos = 0
    total += G_F[g] · cos; weight += G_F[g]
  S = scalars of F defined on both sides
  if S non-empty:
    close = mean over s ∈ S of (1 − |u[s] − v[s]|)
    total += G_F.scalar · close; weight += G_F.scalar
  return weight > 0 ? clamp01(total / weight) : 0
```

This is the existing `similarity` restricted to one family, with `G_F` in place of `GROUP_WEIGHTS`. The
per-pair normalisation over groups present on both sides is retained deliberately: it is inside the
similarity, not the score, and both sides are always full profiles or blends of them.

`shared_F(u, v)`: the list `{ key, weight: u[k]·v[k]·G_F[group(k)] }` over every common word key with
`G_F[group] > 0`, plus `{ key: s, weight: (1 − |u[s] − v[s]|)·0.15 }` for scalars closer than 0.8,
sorted by weight descending then key ascending. Used only for explanation (§8).

### 2.2 Story component

```
v_story(x) = 0.5 · cal_story( sim_story(x.vector.story, P.story.centroid) )
           + 0.5 · cal_story( max_{a ∈ P.story.anchors} sim_story(x.vector.story, a.vector) )
```

- Range `[0, 1]`. Missing: `P.story = null` → `0` for every candidate. An anchor whose `itemId` equals
  `x.item.id` is skipped (cannot happen after filtering, guarded anyway).
- `anchor_story(x)` = the anchor attaining the max; ties by higher `affinity`, then `entryId` ascending.
- Weight `w_story = 0.40`, fixed in Stage 3.
- Evidence: item story profiles of loved entries, blended with story readings (§4.2).

### 2.3 Feeling component

Identical form with `feeling` in place of `story`: `v_feeling(x)`, `anchor_feeling(x)`,
`w_feeling = 0.20`.

### 2.4 Form component

```
v_form(x):
  c = x.item.category; b = x.item.profile.form.band
  if b is null or P.form[c] is undefined: return 0
  d = P.form[c].dist
  return clamp01( d[b] + 0.5·(d[b−1] if b>0 else 0) + 0.5·(d[b+1] if b<3 else 0) )
```

Range `[0, 1]`, no calibration (it is already a probability-like share). `w_form = 0.15`, fixed.
Evidence: the bands of the user's loved entries in that category (§4.4).

### 2.5 Creator component

```
v_creator(x) = x.creatorKey ? (P.creators.get(x.creatorKey)?.weight ?? 0) : 0
```

`CreatorAffinity.weight` is the existing formula `clamp01(mean_aff · sqrt(n) / 2)` over that creator's
entries with `aff > 0.5`. Range `[0, 1]`, no calibration. `w_creator = 0.10`, fixed. The `creatorOf ? 0.35`
fallback is deleted: creator-expanded candidates get the same rule as everyone.

### 2.6 Phase component

```
v_phase(x):
  ph = P.activePhase; if ph is null: return 0
  feeling_cluster: vec = x.vector.story ∪ x.vector.feeling (disjoint keys)
                   return clamp01( (vec[ph.key] ?? 0) + 0.5·(vec[ph.second] ?? 0) )
  genre_run:       tags = normaliseTags(x.item.genre_tags); fam = tagFamily(ph.key)
                   return 1 if ph.key ∈ tags; else 0.6 if any parent of a tag equals ph.key (via tagFamily); else 0
  category_stretch: return x.item.category === ph.key ? 1 : 0
```

Range `[0, 1]`, no calibration. `w_phase = 0.10`, fixed. Evidence: the one active phase.

### 2.7 Anti component

```
v_anti(x):
  parts = []
  if P.anti.story   ≠ null: parts.push( cal_story  ( sim_story  (x.vector.story,   P.anti.story  ) ) )
  if P.anti.feeling ≠ null: parts.push( cal_feeling( sim_feeling(x.vector.feeling, P.anti.feeling) ) )
  return parts.length ? mean(parts) : 0
```

Range `[0, 1]`. `w_anti = −0.15`, fixed. Evidence: §4.6.

### 2.8 Final scalar

```
COMPONENTS = ["story", "feeling", "form", "creator", "phase", "anti"]     // fixed order = feature order
W0 = { story: 0.40, feeling: 0.20, form: 0.15, creator: 0.10, phase: 0.10, anti: −0.15 }

S(x) = Σ_k W0[k] · v_k(x)
```

- `S ∈ [−0.15, 0.95]`. There is no denominator, no re-normalisation, no adjustment after the sum.
- The private score does not appear in `S` (it is inside `aff`, §4.1). The former `score_hint`,
  `reaction_bonus` and `feelingWeight(notes)` are deleted.
- `contribution_k = W0[k] · v_k(x)`; the snapshot stores `v_k`, `W0[k]` and `contribution_k`, and the
  displayed total MUST equal `Σ contribution_k` to within `1e-9`.
- Surprise mode (`filters.surprise`): `S` is computed and stored, and the *ordering* uses
  `0.5·S + 0.5·daySeed(userId + key)` (existing function). The snapshot records `policy.surprise = true`
  and those impressions are excluded from learning (§12.3).
- Weights are represented in code as `WEIGHTS: Readonly<Record<Component, number>>` in
  `src/lib/taste/weights.ts`, exported together with `FEATURE_VERSION`. A per-user learned vector (§12)
  is the same shape and is only consulted when it exists for the current `feature_version`; Stage 3
  always uses `W0`.

*Example.* A film with `v = (story 0.72, feeling 0.55, form 1.0, creator 0, phase 0, anti 0.10)`:
`S = 0.288 + 0.110 + 0.150 + 0 + 0 − 0.015 = 0.533`.

---

## 3. Calibration

### 3.1 What is calibrated

Only the two family similarities, through `cal_story` and `cal_feeling`:

```
cal_F(s) = clamp01( (s − lo_F) / (hi_F − lo_F) )
```

Outside `[lo_F, hi_F]` the value clamps to `0` or `1`; there is no extrapolation. Form, creator, phase are
already on a `[0, 1]` share scale and are not calibrated.

### 3.2 Population

All `media_items` rows with a usable profile (`profile_status = 'done'`, `profile_version =
PROFILE_VERSION`) whose category is in `{movie, tv, anime, book}`. Music joins the population when music
matching begins (§3.7). Items are ordered by `id` ascending before sampling so the run is reproducible.

### 3.3 Pairs

Let `N` be the population size and `M = N·(N−1)/2`.

- If `N ≤ 1500`: **exhaustive**, every unordered pair.
- If `N > 1500`: **seeded sample** of `1,000,000` unordered pairs drawn with the existing xorshift
  generator seeded with `20260915`, rejecting `i = j` and duplicates.

Pairs are drawn across categories; a cross-media pair is a valid pair (that is the space the components
operate in).

### 3.4 Percentiles

For each family `F`, compute `s_F = sim_F(u, v)` over the pairs, sort ascending, and take the
**nearest-rank** percentile: `p-th percentile = s[ceil(p/100 · M) − 1]`. `lo_F = P10`, `hi_F = P90`.

Guards, each of which makes the script exit non-zero and leave `calibration.ts` unchanged:

- `N < 60` (fewer than 1,770 pairs).
- `hi_F − lo_F < 0.05` for either family.

### 3.5 Before enough data exists

`calibration.ts` ships with provisional constants used until the first successful script run:

```
CALIBRATION = { id: "cal-provisional", n_items: 0, n_pairs: 0,
                story:   { lo: 0.15, hi: 0.65 },
                feeling: { lo: 0.15, hi: 0.65 } }
```

The Stage 3 build MUST run the script once against the profiled canon (about 80 items across the four
categories, above the `N ≥ 60` guard) and commit the result before the feature is enabled for the founder.

### 3.6 Recalculation, storage, versioning

- Stored as a committed TypeScript constant in `src/lib/taste/calibration.ts`:
  `{ id, computed_at, n_items, n_pairs, method: "exhaustive" | "sampled", story: {lo, hi}, feeling: {lo, hi} }`.
  Not in the database.
- `id = "cal-" + YYYYMMDD + "-" + n_items`.
- Re-run manually via `scripts/calibrate.ts` (a) whenever `PROFILE_VERSION` bumps, (b) when the population
  has at least doubled since `n_items`, (c) when a media type is added. Never automatically.
- Every run that changes `lo` or `hi` MUST bump `FEATURE_VERSION`; the commit that changes
  `calibration.ts` and `weights.ts` is the same commit.

### 3.7 New media type

Adding music to matching: extend the population in §3.2, re-run, bump `FEATURE_VERSION`. Rows in
`query_sessions` with the old `feature_version` remain valid history and are excluded from learning
(§12.8).

### 3.8 Pseudocode and numbers

```
calibrate(items, seed = 20260915):
  items.sort by id
  pairs = N ≤ 1500 ? allPairs(items) : samplePairs(items, 1_000_000, seed)
  for F in [story, feeling]:
    s = pairs.map((a, b) => sim_F(a.vector[F], b.vector[F])).sort(asc)
    lo = s[ceil(0.10·M) − 1]; hi = s[ceil(0.90·M) − 1]
    assert hi − lo ≥ 0.05
  write calibration.ts; print "bump FEATURE_VERSION"
```

*Example.* `N = 84`, `M = 3486`, exhaustive. Story similarities sorted; `ceil(348.6) − 1 = 348` →
`lo = 0.18`; `ceil(3137.4) − 1 = 3137` → `hi = 0.62`. Then `cal_story(0.50) = (0.50 − 0.18)/0.44 = 0.727`,
`cal_story(0.10) = 0`, `cal_story(0.70) = 1`. A candidate whose centroid half is `0.50` and anchor half is
`0.70` gets `v_story = 0.5·0.727 + 0.5·1 = 0.864`.

---

## 4. Profile construction

All of §4 is pure (`src/lib/taste/profile.ts`, new), deterministic, and takes the library plus the
loaded phases.

### 4.1 Affinity `aff(e)`

The existing `affinity()` in `affinity.ts`, unchanged, restated here as the specification:

```
status want → 0
a = status dropped ? 0.15 : 0.5
dims = union of reaction dimensions
+0.30 loved; +0.18 moved_me; +0.18 stuck_with_me; +0.14 would_return; +0.14 changed_perspective;
+0.10 comforted_me; +0.08 challenged_me
+0.08 if any raw_note longer than 20 chars
+((private_score − 5.5) / 10) · 0.30 when private_score is set          (range ±0.135)
+0.15 per resurface response still_hits; −0.35 per doesnt_hit
return clamp01(a)
```

This is the only place the private score enters the system. **Loved** means `aff(e) ≥ 0.55`.

### 4.2 Entry vector `vec_F(e)`

For a logged entry `e` (status ≠ want) whose item has a usable profile:

```
p = item.profile.vector[F]
readings = done extractions of e with vocabulary_version = "v2", newest first
if readings is empty: v = p
else:
  r = blend( readings[i].vector[F] with weight (i == 0 ? 1 : 0.5) )     # existing blend(): weighted mean, missing = 0; scalars averaged over those that define them
  v = blend( [ {r, 0.8}, {p, 0.2} ] )
absent = union of readings[*].absent
for k in absent: delete v[k]
return v
```

If the item has no usable profile: `v = readings-only blend` when readings exist, else the entry has no
vector and is skipped. The existing `feel_prior` on canon items is no longer read by the scorer; the
canon's committed profiles replace it (§B).

### 4.3 Family centroid and anchors

```
loved = logged entries with aff(e) ≥ 0.55 and vec_F(e) defined
if loved is empty: P[F] = null
centroid = blend( loved.map(e => { v: vec_F(e), w: aff(e)² }) )
anchors  = loved sorted by aff desc, then entry.created_at desc, then entryId asc; take the first 40
           each as { entryId, itemId, category, vector: vec_F(e), affinity: aff(e), ownWords: has a v2 reading with a note }
```

Decisions:

- **No similarity-based down-weighting** of near-duplicate loved items. The centroid reflects how often a
  person returns to something; that is the taste. The anchor half already lets any single loved item pull.
- **One creator may dominate the centroid.** No cap. The creator cap is applied at re-rank (§7).
- **Small histories:** one loved profiled entry gives a centroid equal to that entry and one anchor; the
  formulas need no special case. Zero gives `null`.

### 4.4 Form distribution

Per category `c`: over loved entries of category `c` with a known band, `dist[b] = Σ aff(e)` for entries in
band `b`, normalised to sum 1; `n` = their count. The category is omitted when `n < 3`.

### 4.5 Creators

`buildTagProfile(library, prefs).creators`, unchanged.

### 4.6 Anti-profile

Evidence sources, each contributing a family vector with a weight:

| Source | Vector | Weight |
|---|---|---|
| entry with status `dropped` and a usable item profile | `vec_F(e)` | `1 − aff(e)` |
| entry with a `doesnt_hit` resurface response and a usable profile | `vec_F(e)` | `0.5` |
| every `didnt_work.keys` tag in a v2 reading | one-hot `{ key: weight }`, routed to the family of `key` | `aff(e)` of that entry, minimum `0.5` |

`P.anti[F] = blend(parts_F)` when `parts_F.length ≥ 2`, else `null`. `evidence` is the count of distinct
`(entryId, source)` pairs across both families. One drop is not a pattern (in the spirit of DECISIONS #32).
Hidden ("not for me") candidates are not used (§0 item 5).

### 4.7 Active phase

From `loadPhases(db, userId)`:

```
eligible = phases where !dismissed and kind ∈ {feeling_cluster, genre_run, category_stretch}
           and end_at ≥ today − 90 days
if empty: null
pick max by confidence, then latest end_at, then fingerprint ascending
key: feeling_cluster → evidence.dominant mapped to v2 (theme keys stay "theme.x"; scalar "ache" stays "ache");
     genre_run → evidence.genre; category_stretch → evidence.category
second: feeling_cluster → evidence.second ?? null
```

`creator_run` and `album` phases are excluded: creators are scored once (§2.5) and albums are music.

---

## 5. Candidate generation

Inputs: `library`, `P`, `filters`, the shared catalogue. Output: deduplicated `Candidate[]`. Music is
excluded from every source in Stage 3 (§6 step 1 applies here too, so the work is never fetched).

| Source | Input | Retrieval rule | Max |
|---|---|---|---|
| `backlog` | library | every entry with status `want` | unbounded |
| `canon` | `CANON` | every canon item in `{movie, tv, anime, book}`, not in the library by `canon:slug` and not by lower-cased title | unbounded (about 80) |
| `creator` | `P.creators` | creators with `weight ≥ 0.4`, in the requested category when one is set, top 3 by weight then key; `adapter.byCreator(name, category)`, first 5 results each, skipping library matches by `source:external_id` and by title | 15 |
| `story_neighbour` | `P.story`, pool | pool (below) ranked by `sim_story(item, P.story.centroid)` desc; top 30 | 30 |
| `feeling_neighbour` | `P.feeling`, pool | pool ranked by `sim_feeling(item, P.feeling.centroid)` desc; top 30 | 30 |
| `phase` | `P.activePhase`, pool | `feeling_cluster`: pool items with `vector[ph.key] ≥ 0.5`, ranked by `sim_feeling` to the feeling centroid, top 20. `genre_run`: pool items whose normalised tags contain `ph.key`, ranked by `sim_story`, top 20. `category_stretch`: nothing extra (the pool already covers it) | 20 |

**Pool**: the 500 most recently profiled `media_items` (`profiled_at` desc, then `id` asc) with a usable
profile, category in the allowed set (the filter category if set, else the four), not in the library by
`source:external_id`. Loaded once per request. Neighbour and phase sources are skipped when their profile
input is `null`.

`listOnly` or `surprise`: only `backlog` runs.

**Deduplication**, in order:

1. Merge by `key(x)`: the same key from several sources becomes one candidate whose `sources` is the
   union ordered by `SOURCE_ORDER`; `entryId` is kept if any copy had one.
2. Merge by `(category, normalisedTitle)` where `normalisedTitle` is the existing `norm()` in `canon.ts`:
   keep the copy whose source is not `canon` (a live adapter row has a real id and artwork); if both are
   live, keep the one with the lower `key`. The kept candidate inherits the union of `sources`.

Source order affects nothing but the order inside `sources`. Backlog entries are not deduplicated against
the library (they are in the library).

The final list is sorted by `key` ascending before filtering, so the pipeline is order-independent.

---

## 6. Hard filtering

Applied to every candidate, in this order, each step removing candidates. A removed candidate never gets
a score. Counts removed per step are recorded in the snapshot context (§9.2).

1. **Category / music.** `item.category === "music"` → removed (Stage 3 matches four media). If
   `filters.category` is set and differs → removed.
2. **List only.** `filters.listOnly` and no `entryId` → removed.
3. **Already logged.** No `entryId` and `item.id` is in the library, or `key` matches a library entry's
   `source:external_id` → removed.
4. **Hidden.** `key ∈ prefs.hidden` → removed.
5. **Muted.** `isMuted(item.genre_tags, profile)` → removed.
6. **Already known.** Reserved for Part 4; in Stage 3 this step removes nothing and is present in the
   code as a named no-op so the ordering is fixed.
7. **Time / commitment.** `fitsTime(item, filters.minutes)` (existing rules, unchanged) and the
   `shortRead` rule (books only, `minutes_to_finish ≤ 480`) → removed on failure. `filters.returnable`
   → removed unless `vector.feeling["aftertaste.comforting"] ≥ 0.4` or `vector.feeling["tone.warm"] ≥ 0.4`.
8. **Unprofiled.** No usable profile → removed **and** queued: `ensureProfiles()` upserts the
   `media_items` row (materialising `canon:` and adapter results) with `profile_status = 'pending'` if it
   has no usable profile. At most 5 are profiled inline after the response (`after()`), the rest by the
   daily cron (≤ 20 per run, `attempts < 5`). The snapshot context records `deferred` count.
9. **Recent impressions.** `key` appears in the `results` of any `query_sessions` row of this user with
   kind in `{home, recommend, time}` created in the last 7 days → set aside. If fewer than `limit`
   candidates remain after this step, re-admit set-aside candidates in order of oldest impression first
   until `limit` is reached, and record `policy.recency_relaxed = true`.

Filtering runs before scoring and therefore before any profile-based computation; step 8 is a filter,
not part of scoring, so an unprofiled item never has a partial score.

---

## 7. Re-ranking

Input: `scored`, the filtered candidates with `S`, sorted by `S` desc then `key` asc (surprise mode: by
the blended order in §2.8). `L = filters.limit` (3 on Home, 5 on Recommend). Output: `out`, `≤ L`.

### 7.1 Band

```
closeness(x) = 0.5 · cal_story  ( max_a sim_story  (x, a) )       [0 when P.story   is null]
             + 0.5 · cal_feeling( max_a sim_feeling(x, a) )       [0 when P.feeling is null]
band(x) = closeness ≥ 0.60 ? "familiar" : closeness ≥ 0.35 ? "adjacent" : "stretch"
```

The two anchor maxima are the same numbers already computed for `v_story` and `v_feeling`. The thresholds
`0.60` and `0.35` are on the calibrated scale and are **provisional** (§E); they are constants in
`weights.ts` and part of `feature_version`.

### 7.2 Quotas

| `L` | familiar | adjacent | stretch |
|---|---|---|---|
| 1 | 1 | 0 | 0 |
| 2 | 1 | 0 | 1 |
| 3 | 2 | 0 | 1 |
| 4 | 2 | 1 | 1 |
| 5 | 3 | 1 | 1 |
| ≥ 6 | `L − adjacent − stretch` | `round(0.2·L)` | `max(1, round(0.1·L))` |

### 7.3 Constraints

- **Creator cap:** at most 2 results with the same `creatorKey` (null keys are unconstrained).
- **Category cap:** when `filters.category` is unset, at most `ceil(L/2)` results per category.
- **Theme cap:** let `themes(x)` = story theme keys with `vector.story[k] ≥ 0.5`. At most `ceil(L/2)`
  results may share any one theme key.
- **Bridge:** `bridge(x)` is true when the anchor of `x`'s route family (§8.2) has a category different
  from `x.item.category`. At least one result MUST satisfy `bridge` when any scored candidate does.

### 7.4 Algorithm

```
out = []; quota = QUOTAS[L] copied; caps = {creator: {}, category: {}, theme: {}}
admissible(x) = creator, category and theme caps all hold if x were added

pass 1 (quota-respecting):
  for x in scored: if quota[band(x)] > 0 and admissible(x): add(x); quota[band(x)]−−
pass 2 (fill quotas from any band):
  for x in scored not in out: if |out| < L and admissible(x): add(x)
pass 3 (relax caps, in this order only, each pass over the full list):
  relax theme cap; then category cap; the creator cap is never relaxed
  for x in scored not in out: if |out| < L and admissible(x): add(x)

bridge repair:
  if no r in out has bridge(r) and some x in scored has bridge(x) and creator cap holds for x:
    b = the first such x in scored order
    victim = the last element of out with band(victim) == band(b), else the last element of out
    replace victim with b
```

`add(x)` appends and updates the caps. Passes stop when `|out| = L`. If `|out| < L` after pass 3, the
list is short; nothing is invented. `out` is then re-sorted by `S` desc, `key` asc for display, and each
result records `rerank: { band, pass: 1|2|3, bridge_repair: boolean }` and its 1-based `position`.

Insufficient candidates for a quota (for example no stretch candidate) leave that quota unfilled in pass 1
and pass 2 fills the slot from another band; `policy.quota_unfilled` lists the bands that were not met.

---

## 8. Explanation

Everything in this section reads only the snapshot (§9) so it is reconstructable.

### 8.1 Route

```
if filters.listOnly or filters.surprise, and entryId: route = "backlog"
else: route = argmax over {story, feeling, form, creator, phase} of contribution_k
      ties (equal to 1e-9) broken in the order story, feeling, creator, phase, form
      if the maximum contribution is 0: route = entryId ? "backlog" : "story"
```

`anti` is never a route.

### 8.2 Anchor

- `story` route → `anchor_story(x)`; `feeling` → `anchor_feeling(x)`; any other route → whichever of the
  two anchors has the higher calibrated anchor similarity, story first on ties; null when neither family
  profile exists.

### 8.3 Shared attributes

`shared_F(x.vector[F], anchor.vector)` for the route's family (for non-family routes, the anchor's
family), filtered to exclude any key in group `ending`, first 3 kept in the snapshot, first 2 spoken.
Keys are rendered with `describeKey`.

### 8.4 "What I valued"

If the route is `story` or `feeling` and the anchor has `ownWords`, the first `valued` phrase of the
anchor's newest v2 reading is included, verbatim, in curly quotes. At most one phrase. Otherwise the
anchor's `quote` (existing behaviour), otherwise nothing.

### 8.5 Deterministic sentence per route

- `story`: `This connects to {anchor.title}: the same {shared[0]} and {shared[1]}.` + valued/quote.
  Cross-media anchor: prefix `This connects to something you loved in another medium: `.
- `feeling`: the existing `feelingSentence`, with the same cross-media prefix.
- `creator`: `Same hands as something you loved: {creator.name}.` + `It is also {shared[0]}.` when a
  shared attribute exists.
- `phase`: `Fits {phase.label}.` + the story or feeling sentence for the anchor when one exists.
- `form`: `{fits}.` (the time note) + `It sits close to what you tend to love.`
- `backlog`: existing wording.

The AI explainer receives exactly the fields in §9.1 `explain` and the rules in its existing system prompt,
extended with the `story`, `phase` and `form` routes.

### 8.6 Allowed and forbidden evidence

Allowed: route, band (as "a stretch from your usual" / "close to your usual"), anchor title and category,
shared attribute names, the anchor's summary, quote and one valued phrase, creator name and count, the
`fits` note, the active phase label.

Never: any `ending` value, the private score, the affinity number, other users, popularity, reception,
awards, the candidate's premise or plot beyond title and creator, provenance names, the numeric score.

---

## 9. Impression snapshot

Stored in `query_sessions.results` as `ImpressionSnapshot[]` (one per displayed item, in display order)
and `query_sessions.answers` as `{ filters, context }`. Both are jsonb; no migration.

### 9.1 Per result

```jsonc
{
  "position": 1,                                  // 1-based display position
  "key": "tmdb:movie:12345",
  "item": { "id": "uuid-or-key", "title": "…", "category": "movie", "creator": "…", "profile_version": "p1" },
  "entryId": null,
  "sources": ["canon", "story_neighbour"],
  "creatorKey": "movie:charlotte wells",
  "features": {                                    // v_k, exactly the x used by the learner (§12.1) in COMPONENTS order
    "story": 0.864, "feeling": 0.55, "form": 1.0, "creator": 0, "phase": 0, "anti": 0.10
  },
  "raw": {                                         // pre-calibration halves, for reconstruction
    "story":   { "centroid": 0.50, "anchor": 0.70 },
    "feeling": { "centroid": 0.41, "anchor": 0.48 },
    "anti":    { "story": 0.22, "feeling": null }
  },
  "has_evidence": { "story": true, "feeling": true, "form": true, "creator": false, "phase": false, "anti": true },
  "weights": { "story": 0.40, "feeling": 0.20, "form": 0.15, "creator": 0.10, "phase": 0.10, "anti": -0.15 },
  "contributions": { "story": 0.3456, "feeling": 0.11, "form": 0.15, "creator": 0, "phase": 0, "anti": -0.015 },
  "score": 0.5906,
  "route": "story",
  "anchor": { "entryId": "…", "itemId": "…", "title": "Aftersun", "category": "movie", "affinity": 0.93, "ownWords": true, "family": "story" },
  "shared": [ { "key": "theme.memory", "weight": 0.71 }, { "key": "theme.family", "weight": 0.52 }, { "key": "arc.coming-of-age", "weight": 0.31 } ],
  "explain": { "summary": "quiet devastation", "quote": "I sat in the dark for a long time after.", "valued": "Nothing happens and then everything does.", "creator": null, "phase_label": null, "fits": null },
  "indicators": { "is_cross_media": false, "is_backlog": false, "band_adjacent": 0, "band_stretch": 0, "own_words": 1 },
  "rerank": { "band": "familiar", "closeness": 0.81, "pass": 1, "bridge_repair": false },
  "versions": { "feature_version": "f1", "profile_version": "p1", "vocabulary_version": "v2", "calibration_id": "cal-20260920-84" },
  "explanation": "…"                               // the sentence shown, deterministic or AI
}
```

### 9.2 Per session (`answers.context`)

```jsonc
{
  "filters": { "category": null, "minutes": null, "listOnly": false, "returnable": false, "shortRead": false, "surprise": false, "limit": 5 },
  "weights_source": "w0",                          // "w0" | "learned"; Stage 3 always "w0"
  "learned": null,                                 // later: { n, trained_at }
  "versions": { … as above … },
  "calibration": { "story": { "lo": 0.18, "hi": 0.62 }, "feeling": { "lo": 0.16, "hi": 0.58 } },
  "thresholds": { "loved": 0.55, "band_familiar": 0.60, "band_adjacent": 0.35, "creator_cap": 2, "category_cap": 3, "theme_cap": 3, "recency_days": 7 },
  "profile": {
    "story":   { "top": [["theme.memory", 0.61], …20], "n_loved": 18 },      // top 20 centroid keys
    "feeling": { "top": [ … ], "n_loved": 18 },
    "anchors": [ { "entryId": "…", "affinity": 0.93 }, … ≤ 40 ],
    "form":    { "movie": { "dist": [0.1, 0.5, 0.3, 0.1], "n": 9 } },
    "creators": [ { "key": "book:kazuo ishiguro", "weight": 0.71 } ],       // weight ≥ 0.4 only
    "active_phase": null,
    "anti":    { "story_top": [ … ≤ 10 ], "feeling_top": [ … ≤ 10 ], "evidence": 3 }
  },
  "pools": { "backlog": 4, "canon": 62, "creator": 10, "story_neighbour": 30, "feeling_neighbour": 30, "phase": 0, "merged": 118, "removed": { "category": 0, "listOnly": 0, "logged": 3, "hidden": 1, "muted": 0, "known": 0, "time": 0, "unprofiled": 12, "recent": 9 }, "deferred": 12, "scored": 93 },
  "policy": { "quotas": { "familiar": 3, "adjacent": 1, "stretch": 1 }, "quota_unfilled": [], "recency_relaxed": false, "caps_relaxed": [], "surprise": false }
}
```

### 9.3 Not stored

Raw notes; full item profiles or full centroids (only the tops above); the candidates that were not shown
(counts only); private scores; email; any popularity or external score; the AI prompt or raw model output.
The Home cache (`answers.full`) keeps storing the full `Recommendation[]` for the day's reuse; it is
redundant with `results` and MAY be removed once Home reads `results`.

---

## 10. Tests

See §C.

## 11. Offline evaluation

See §D.

## 12. Future learning contract

Not built in Stage 3. Stage 3 MUST produce data that satisfies this contract.

### 12.1 `x`

Exactly the 11 numbers below, in this order, all in `[0, 1]`, read from the snapshot:

```
x = [ features.story, features.feeling, features.form, features.creator, features.phase, features.anti,
      indicators.is_cross_media, indicators.is_backlog, indicators.band_adjacent, indicators.band_stretch, indicators.own_words ]
```

### 12.2 `y`

From `recommendation_feedback.answer`, one row per `(query_session_id, position)`:

| answer | y |
|---|---|
| `save`, `loved_it`, `more_like_this` | 1 |
| `not_for_me`, `less_like_this` | 0 |
| `maybe_later`, `already_know_it`, `too_similar`, no answer | excluded |

`too_similar` is written to the same table and read only by the stretch-mix policy. Impressions with
`policy.surprise = true` are excluded regardless of answer.

### 12.3 `w0`, `w`, `b`

`w0 = [0.40, 0.20, 0.15, 0.10, 0.10, −0.15, 0, 0, 0, 0, 0]`. `w` has the same shape; `b` is a free
intercept initialised to `0`.

### 12.4 Objective and `λ`

```
J(w, b) = Σ_i logloss(y_i, σ(b + w·x_i)) + (κ/2) · Σ_j ((w_j − w0_j) / s_j)²
κ = 25;  s_j = max(|w0_j|, 0.10)
```

`κ = 25` means a one-scale-unit deviation of any weight costs as much as about 25 confidently wrong
predictions; at `n = 50` the data and the prior have comparable say. `s_j` puts every weight on the
same relative scale.

### 12.5 Bounds and signs

Projected after every gradient step: `w_j ∈ [0.5·w0_j, 1.5·w0_j]` for `j ≤ 5` (this fixes signs:
positive components stay in `[0.05, 0.60]` and so on, anti stays in `[−0.225, −0.075]`); indicator
weights `w_6..w_10 ∈ [−0.15, 0.15]`; `b ∈ [−3, 3]`.

### 12.6 Training

- Trigger: every new row with `y` defined, synchronously in the feedback route, when the user has
  `n ≥ 50` such rows with `feature_version = FEATURE_VERSION`.
- Solver: full-batch projected gradient descent, learning rate `0.05`, `500` iterations, starting from
  `(w0, 0)`. Deterministic.
- Storage: table `user_ranker_weights` (`user_id` pk, `feature_version`, `w jsonb`, `b`, `n`,
  `trained_at`), RLS "own rows". One row per user.

### 12.7 Use and explanations

`scoreCandidates` takes `weights = learned ?? W0`, where `learned` is used only when
`user_ranker_weights.feature_version = FEATURE_VERSION` and `n ≥ 50`. `S = Σ w_k · v_k` for the six
components; indicator weights and `b` affect the *ordering* only through
`S' = S + Σ w_j · indicator_j + b`, which is stored as `score` while `contributions` keep the six named
terms plus an `other` term so the displayed arithmetic still sums. The route and explanation rules (§8)
are unchanged; `weights_source = "learned"` and `learned.n` go in the context, and the UI MAY say "for
you, story counts 0.46".

### 12.8 Invalidation

A row is eligible for training iff its `versions.feature_version` equals the current one. A bump makes
every older row ineligible; if fewer than 50 eligible rows remain, the ranker returns to `w0` and the
`user_ranker_weights` row is deleted. Rows are never migrated between versions.

---

# A. Final Stage 3 specification

The normative pipeline, in execution order. Each step cites the section that defines it.

1. **Load** the library, prefs, phases (existing loaders).
2. **Build `P`** (§4): affinity per entry; entry vectors from item profiles blended with v2 readings,
   `absent` keys zeroed; story and feeling centroids over loved entries (`aff ≥ 0.55`, weights `aff²`) and
   up to 40 anchors each; form distributions per category (`n ≥ 3`); creators; the one active phase
   (feeling_cluster / genre_run / category_stretch, ≤ 90 days old); the anti-profile (≥ 2 pieces of
   evidence per family).
3. **Generate candidates** (§5) from six sources, merge by key then by title, sort by key.
4. **Filter** (§6) in the fixed nine-step order; queue unprofiled items; relax recency only to reach `L`.
5. **Score** (§2): `v_story`, `v_feeling` = calibrated half-centroid, half-best-anchor similarity;
   `v_form` = band share with half credit to neighbours; `v_creator` = profile weight; `v_phase` = phase
   key match; `v_anti` = calibrated similarity to the anti-profile; `S = Σ W0[k]·v_k`, no denominator.
6. **Re-rank** (§7): band by calibrated closeness (0.60 / 0.35); quotas by `L`; three greedy passes with
   creator, category and theme caps; bridge repair; sort by `S`.
7. **Explain** (§8): route by largest contribution with a fixed tie order; anchor by route family; shared
   keys minus `ending`; one valued phrase; deterministic sentence, optionally rewritten by the AI from
   the same fields.
8. **Store** (§9): one snapshot per shown result plus the session context.

Constants, all in `weights.ts` under `FEATURE_VERSION = "f1"`: `W0`; `LOVED = 0.55`; anchors `40`;
`BAND = { familiar: 0.60, adjacent: 0.35 }`; quotas table; `CREATOR_CAP = 2`; category and theme caps
`ceil(L/2)`; `RECENCY_DAYS = 7`; `PHASE_ACTIVE_DAYS = 90`; `ANTI_MIN_EVIDENCE = 2`; pool `500`; neighbour
tops `30`, phase top `20`, creator `3 × 5`. Calibration in `calibration.ts`.

# B. File-by-file implementation plan

Order matters: each step leaves `typecheck`, `lint`, `test` and `build` green.

| # | File | Change |
|---|---|---|
| 1 | `docs/ATTRIBUTES.md` | Apply §1.1 word lists; Part 2 becomes §1.3 (non-negative vector, `absent`, `didnt_work`, `valued`; taps do not add words; the "how an entry's vector is built" table becomes §4.2); Part 4 references §9 and §12 |
| 2 | `docs/RECOMMENDATIONS.md` §14 | Replace with a pointer to this document; novelty removed from the score; anti as a component; no re-normalisation |
| 3 | `docs/DECISIONS.md` | New entries: #30 superseded (fixed denominator, profile-or-defer); #51 superseded (non-negative readings, `absent`); #12 superseded (private score only inside affinity); form = length only; music excluded from Stage 3 candidates; calibration method; band thresholds provisional |
| 4 | `src/lib/taste/vocabulary.ts` | v2 lists (§1.1); `STORY_GROUPS`, `FEELING_GROUPS`, `G_STORY`, `G_FEELING`; `familyOf(key)`; `describeKey` / `adjective` extended for the new groups; `isKnownKey` per family |
| 5 | `src/lib/taste/weights.ts` (new) | `FEATURE_VERSION`, `COMPONENTS`, `W0`, every constant in §A |
| 6 | `src/lib/taste/calibration.ts` (new) | provisional constants (§3.5); `calibrate(family, s)` |
| 7 | `src/lib/taste/vector.ts` | `similarity(u, v, family)` (§2.1) and `shared(u, v, family)`; `blend` unchanged; `assertNonNegative(v)`; delete `GROUP_WEIGHTS` import |
| 8 | `src/lib/taste/affinity.ts` | `affinity` unchanged; `entryVector(e, family)` per §4.2; `feel_prior` no longer read |
| 9 | `src/lib/taste/profile.ts` (new) | `buildUserProfile(library, phases, prefs): UserProfile` (§4); `activePhase`; `antiProfile`; `formDistribution` |
| 10 | `src/lib/taste/form.ts` (new) | `minutesToFinish`, `band` (§1.4); `fitsTime` and `estimatedMinutes` move here from `recommend.ts` unchanged |
| 11 | `src/lib/taste/recommend.ts` | `scoreCandidates(P, candidates, filters, weights = W0)` per §2 and §6 steps 1–7 and 9 (step 8 is server-side); `rerank` (§7); `routeOf`, `fallbackExplanation` (§8); delete `feelingWeight`, adjustments, legacy mirror, `ROUTE_LABEL` gains `story`, `phase`, `form` |
| 12 | `src/lib/taste/snapshot.ts` (new) | `ImpressionSnapshot`, `SessionContext` types (§9) and `buildSnapshot`, `buildContext` |
| 13 | `src/lib/types.ts` | `Recommendation` per §1.8; `Route` union; `Reading`, `ItemProfile`, `Attribute` types; remove `feel_prior` from `MediaItem` once the canon profiles land (keep the column) |
| 14 | `src/lib/db/types.ts` | `MediaItemsRow` gains the six profile columns |
| 15 | `supabase/migrations/0003_item_profiles.sql` (new) | §1.2 columns; index on `(profile_status, profiled_at)` |
| 16 | `src/lib/ai/profiler.ts` (new) | `ItemProfiler` interface; Claude and NVIDIA implementations with structured output against the §1.2 schema; deterministic mock: `frameFromGenre` + lexicon over `metadata.overview`; `PROFILE_VERSION = "p1"` |
| 17 | `src/lib/catalog/canon-profiles.ts` (new, generated) | committed output of the real profiler over `CANON`, produced by `scripts/profile-canon.ts`, so fixtures and tests run without a model |
| 18 | `src/lib/server/profiles.ts` (new) | `ensureProfiles(items)`: materialise + mark pending; `runPendingProfiles(db, { limit, maxAttempts })` |
| 19 | `src/lib/server/recommend.ts` | `buildCandidates` per §5 with provenance; pool loader; §6 step 8 via `ensureProfiles`; step 9 via a `query_sessions` read; `buildRecommendations` writes `results` and `answers.context` per §9 |
| 20 | `src/lib/ai/extractor.ts`, `mock-extractor.ts`, `nvidia.ts`, `lexicon.ts` | v2 `Reading` schema (§1.3); negation window: a token from `{no, not, never, isn't, wasn't, without, lacks, lacking}` within 3 tokens before a lexicon match routes that rule's keys to `absent`; `didnt_work` from a second lexicon of dislike phrases; `valued` guarded as verbatim; remove `DIMENSION_TAGS` |
| 21 | `src/lib/ai/explainer.ts` | payload = snapshot `explain` + `shared` + `route` + `anchor` + `rerank.band` (§8); prompt rules for the three new routes |
| 22 | `src/lib/server/extraction.ts`, `src/app/api/extractions/reread/route.ts` | reread also re-queues rows with `vocabulary_version ≠ "v2"` |
| 23 | `src/app/api/cron/daily/route.ts` | call `runPendingProfiles` (≤ 20) |
| 24 | `src/components/rec-card.tsx` | render from `snapshot`: route pill (six routes), band label, shared keys, contributions table |
| 25 | `src/lib/taste/portrait.ts`, `evolution.ts`, `connections.ts`, `phases.ts`, `resurface.ts` | switch to `entryVector(e, "feeling")` and `similarity(…, "feeling")`; phases' `feeling_cluster` evidence keys are v2; `activePhase` helper in `phases.ts` |
| 26 | `src/lib/dev/fixtures.ts`, `demo-seeds.ts` | fixture items carry canon profiles; the fixture library has ≥ 1 dropped entry, ≥ 1 `doesnt_hit`, ≥ 1 note with a negation, ≥ 2 creators with 2+ loved entries, at least one category with < 3 loved entries |
| 27 | `scripts/calibrate.ts`, `scripts/profile-canon.ts`, `scripts/explain-rec.ts`, `scripts/eval-recs.ts` (new) | §3, §B17, §5.3 of the audit, §D |
| 28 | `docs/STATE.md` | session entry |

`frameFromGenre` (used in step 16): `comedy→comedy, sci-fi→sci-fi, fantasy→fantasy, horror→horror,
crime→crime, mystery→mystery, thriller→thriller, romance→romance, adventure→adventure,
slice of life→slice-of-life, satire→satire, noir→crime, psychological→thriller, dystopia→sci-fi,
supernatural→fantasy, mecha→sci-fi`. Everything else (drama, animation, action, family, history, war,
western, documentary, music) maps to nothing; the AI supplies `frame` for those.

# C. Test matrix

All tests use the fixture library (`buildFixtureLibrary`) plus the committed canon profiles, so they are
deterministic and need no model. File names are the ones in §B.

| # | Kind | File | Case | Assertion |
|---|---|---|---|---|
| 1 | unit | `vector.test.ts` | `similarity` family restriction | keys of the other family are ignored; `ending` contributes 0 |
| 2 | unit | `vector.test.ts` | group skipped when empty on one side | weight excluded from the divisor; two vectors with no common group → 0 |
| 3 | property | `vector.test.ts` | symmetry, bounds | `sim(u,v) = sim(v,u)`, in `[0,1]`, `sim(u,u) = 1` for non-empty `u` |
| 4 | unit | `vector.test.ts` | negative weight | `assertNonNegative` throws; the extractor marks the row failed |
| 5 | unit | `calibration.test.ts` | boundaries | `cal(lo) = 0`, `cal(hi) = 1`, `cal(lo − 0.2) = 0`, `cal(hi + 0.2) = 1`, monotone |
| 6 | unit | `calibration.test.ts` | script guards | `N = 59` → error; `hi − lo = 0.04` → error; `N = 60` exhaustive; `N = 1501` sampled with 1,000,000 pairs and a fixed seed reproduces identical constants twice |
| 7 | unit | `profile.test.ts` | loved threshold | an entry at `aff = 0.54` is not an anchor; at `0.55` it is |
| 8 | unit | `profile.test.ts` | `absent` | a note with "no quiet feeling" removes `register.quiet` from that entry's vector even though the item profile has it |
| 9 | unit | `profile.test.ts` | reading/profile blend | with a note: `0.8 r + 0.2 p`; without: `p` |
| 10 | unit | `profile.test.ts` | missing feeling profile | a library of taps on unprofiled manual items → `P.feeling = null` and `P.story = null` |
| 11 | unit | `profile.test.ts` | anti minimum evidence | one dropped entry → `anti.story = null`; a drop plus a `didnt_work` key → non-null |
| 12 | unit | `profile.test.ts` | active phase selection | two eligible phases → higher confidence wins; a `creator_run` is never chosen; a 91-day-old phase is not active |
| 13 | unit | `form.test.ts` | bands | boundary minutes 89/90, 119/120, 149/150, 299/300 land in the specified bands; unknown → null |
| 14 | unit | `profile.test.ts` | form distribution | category with 2 loved entries is omitted; with 3 it sums to 1 |
| 15 | unit | `scoring.test.ts` | fixed denominator | `S` equals the sum of six contributions; a candidate with `creator = 0` is not capped relative to one with `creator = 0.5` beyond the 0.05 difference |
| 16 | unit | `scoring.test.ts` | missing profile | an unprofiled candidate is absent from the scored list and present in `pools.deferred` |
| 17 | unit | `scoring.test.ts` | missing feeling profile | with `P.feeling = null`, every result has `features.feeling = 0` and `has_evidence.feeling = false`, and ranking equals the ranking with feeling weight 0 |
| 18 | unit | `scoring.test.ts` | creator absent / present | a candidate with no creator has `features.creator = 0`; an Ishiguro book has `features.creator ≥ 0.5` and route `creator` when its story contribution is lower |
| 19 | unit | `scoring.test.ts` | no active phase | `features.phase = 0` everywhere; with an injected `genre_run` phase the matching candidate gets `1` |
| 20 | unit | `scoring.test.ts` | anti lowers linearly | doubling `v_anti` (by injecting an anti vector) lowers `S` by exactly `0.15 · Δv` |
| 21 | unit | `scoring.test.ts` | cross-media anchor | a book anchored to a film has `indicators.is_cross_media = 1` and the story sentence carries the cross-media prefix |
| 22 | unit | `recommend.test.ts` | same candidate from two sources | one candidate, `sources = ["canon", "story_neighbour"]`, score identical to the single-source case |
| 23 | unit | `recommend.test.ts` | title dedupe | a canon film and a TMDB row with the same title → one candidate, the TMDB key kept |
| 24 | unit | `filters.test.ts` | order and counts | each of the nine steps removes the expected fixture candidates; `pools.removed` matches |
| 25 | unit | `filters.test.ts` | recency relaxation | with all candidates recently shown, `L` results are still returned and `policy.recency_relaxed = true` |
| 26 | unit | `filters.test.ts` | music excluded | no music candidate is ever scored; a music backlog entry is removed at step 1 |
| 27 | unit | `rerank.test.ts` | quotas | for `L = 5` with candidates in all bands, `out` has 3/1/1; for `L = 3`, 2/0/1 |
| 28 | unit | `rerank.test.ts` | no stretch candidate | quota unfilled, slot filled in pass 2, `policy.quota_unfilled = ["stretch"]` |
| 29 | unit | `rerank.test.ts` | duplicate creators | six candidates by one creator → at most 2 in `out`; the cap is never relaxed even when the list is short |
| 30 | unit | `rerank.test.ts` | category scarcity | with one category only and no filter, the category cap relaxes in pass 3 and `policy.caps_relaxed = ["theme", "category"]` or `["category"]` as applicable |
| 31 | unit | `rerank.test.ts` | theme cap | four candidates sharing `theme.grief ≥ 0.5` at the top → at most 3 in a list of 5 |
| 32 | unit | `rerank.test.ts` | bridge repair | a list with no bridge and a bridge candidate lower down → the bridge replaces the last same-band result; with no bridge candidate anywhere → no repair, no error |
| 33 | property | `rerank.test.ts` | determinism | two runs give identical order; permuting the input candidate order gives identical output |
| 34 | unit | `explain.test.ts` | route ties | equal story and feeling contributions → `story`; all-zero → `backlog` for a backlog entry, `story` otherwise |
| 35 | unit | `explain.test.ts` | forbidden evidence | no explanation contains an `ending` word, a digit score, "popular", "critics", "acclaimed", "rated" |
| 36 | unit | `explain.test.ts` | valued phrase | the phrase in the sentence is a verbatim substring of the anchor's raw note |
| 37 | unit | `explain.test.ts` | reconstruction | `fallbackExplanation(snapshot)` reproduces the stored `explanation` for every deterministic result |
| 38 | unit | `snapshot.test.ts` | completeness | every field in §9.1 is present and typed; `score = Σ contributions` to `1e-9`; `features` has exactly the six keys in order |
| 39 | unit | `snapshot.test.ts` | version mismatch | a stored snapshot with `feature_version = "f0"` is rejected by the learner's row filter; a profile with `profile_version ≠ PROFILE_VERSION` is treated as unprofiled |
| 40 | unit | `extraction.test.ts` | negation | "not quiet at all" → `absent` contains `register.quiet`, vector lacks it; "quiet" alone → vector has it |
| 41 | unit | `extraction.test.ts` | didnt_work | "hated how slow it was" → `didnt_work.keys` contains a pace-related key with weight > 0 |
| 42 | unit | `extraction.test.ts` | taps add no words | a reaction with taps and no note yields an empty reading vector |
| 43 | integration | `pipeline.test.ts` | end to end on fixtures | `buildRecommendations` with an in-memory db stub returns `L` explained results, writes `results` and `answers.context` matching §9 |
| 44 | integration | `pipeline.test.ts` | cold start | 10 canon taps, no notes → 5 results, `has_evidence.story = true` (from profiles), `own_words = 0`, routes ≠ `feeling` unless feeling contribution wins |
| 45 | regression | `regression.test.ts` | golden snapshot | the top 5 keys for the fixture library at a fixed `now` are pinned; any change requires a deliberate update and a `FEATURE_VERSION` bump in the same commit (the test asserts the version string changed when the golden file changed) |
| 46 | edge | `scoring.test.ts` | empty library | no candidates scored, no error, empty results |
| 47 | edge | `scoring.test.ts` | single loved entry | centroid = that entry's vector; one anchor; results still produced |
| 48 | edge | `rerank.test.ts` | `L = 1` | one result, familiar if available, bridge repair still applies |

# D. Evaluation harness

`scripts/eval-recs.ts`, pure functions in `src/lib/taste/eval.ts`, runnable on the fixture library and on
one user's library (read-only). Every run logs `feature_version`, `calibration_id`, the library size, and
the metric table below to stdout as JSON. Thresholds are stated only where a value is justified; the
others are to be calibrated empirically by comparing runs, as noted.

### D.1 Leave-one-loved-out

```
for each loved entry h (aff ≥ 0.55) with a usable profile:
  lib' = library without h
  P'   = buildUserProfile(lib', phases)
  cand = generate(lib', P') ∪ { h.item as a candidate with sources ["holdout"] }
  run filters (skip step 9), score, DO NOT re-rank
  rank_h = 1-based position of h.item in the scored order
log per h: rank_h, S(h), v_k(h), band(h), route(h)
report: hit@5 = share of h with rank ≤ 5; hit@20; mean reciprocal rank; median rank
```

Success is relative: a change to weights or calibration MUST not lower `hit@5` on the fixture library and
SHOULD raise MRR. No absolute threshold: the candidate pool size and the share of loved items that are
canon vary per library.

### D.2 Temporal holdout

```
dated loved entries sorted by entryDate; T = the date splitting them 70/30 (at least 5 after T, else skip)
lib_train = entries with date < T (plus all undated entries); holdouts = loved entries with date ≥ T
same procedure as D.1 with every holdout injected at once
report hit@5, hit@20, MRR over holdouts; also the share of holdouts that were unprofiled (excluded) — this
number is an input to the profiling backlog, not a quality score
```

### D.3 Component spread

```
for a request (fixture or user, default filters): over the scored candidates compute per component
  mean, sd, min, max, share of exact zeros
flag "dead"      when sd < 0.02 and the component has evidence for the user
flag "dominant"  when W0[k]·sd_k > 2 × the next largest W0[j]·sd_j
```

`0.02` and `2×` are diagnostic flags, not failures; they say where to look.

### D.4 Cold-start evaluation

```
cold = the fixture library reduced to 10 canon "loved" taps, no notes (existing construction in scoring.test)
run the full pipeline (with re-rank) for L = 5 and for each category filter
report: results returned, categories covered, routes, share own_words = 0, quotas met, mean closeness
```

Pass conditions (these are structural, hence absolute): 5 results with no filter; every result explained;
`has_evidence.story = true` for all; no result with route `feeling` whose anchor has `ownWords = true`
(there are none).

### D.5 Redundancy and diversity (offline proxies)

For a sequence of 7 simulated daily runs with the recency filter on: mean Jaccard between consecutive
lists; share of days with a bridge; mean intra-list `1 − sim` in both families; max theme share. Logged,
not thresholded.

# E. Open decisions that still require founder input

Defaults are what the specification above assumes; each can be changed without touching the maths.

1. **Music in Stage 3.** Default: excluded from every candidate source; the Music tab shows a "not yet"
   state. Alternative: keep the current tag baseline for music only (two engines).
2. **Band thresholds** `0.60 / 0.35` on the calibrated closeness scale are provisional until the first
   calibration run and a look at real distributions. They are constants, but changing them bumps
   `feature_version`.
3. **Home with `L = 3`** uses quotas 2/0/1. Alternative: 1/1/1 to always show one of each band.
4. **Private score** now enters only through affinity (supersedes DECISIONS #12's separate nudge).
   Confirm.
5. **Taps add no feeling words** (ATTRIBUTES Part 2 already says so; the code disagrees today). Confirm
   removing `DIMENSION_TAGS`, which changes the portrait for tap-only libraries.
6. **"Not for me" and the anti-profile.** Default: not used in Stage 3 (DECISIONS #32). ATTRIBUTES Part 4
   proposes "the item and its matched words"; decide before Part 4.
7. **Creator expansion materialises catalogue rows** (up to 15 per request) so they can be profiled. This
   costs one model call per new item, bounded at 5 inline and 20 per cron run. Confirm the budget and
   which provider profiles items (NVIDIA credits vs Claude).
8. **Committing canon profiles to the repository** (`canon-profiles.ts`, generated once by the real
   model, reviewed by hand). This is what makes tests model-free. Confirm.
9. **Recency window 7 days** for the "recently shown" filter. Alternative: 14.
10. **Form = length only in Stage 3.** Craft words are stored and not scored. Confirm.
11. **`category_stretch` as a phase component** gives a flat +0.10 to a whole category while the stretch is
    active. Keep, or restrict the phase component to `feeling_cluster` and `genre_run`.
