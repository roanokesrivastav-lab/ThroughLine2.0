# Canon profiles QA report

- Model: `nvidia/nemotron-3-super-120b-a12b` · p1 · prompt `1586263905ca` · 2026-09-24

## Counts

- movie: 24/24 profiled · 0 failed · 0 unreached
- tv: 20/20 profiled · 0 failed · 0 unreached
- anime: 18/18 profiled · 0 failed · 0 unreached
- book: 23/23 profiled · 0 failed · 0 unreached
- music: 24/25 profiled · 1 failed · 0 unreached

## evaluate()

| metric | value | threshold | pass |
|---|---|---|---|
| firstPassStrict | 0.8807 | 0.9 | FAIL |
| committedStrict | 1.0000 | 1 | PASS |
| agreementStory | null (not measurable here) | 0.5 | n/a |
| agreementFeeling | null (not measurable here) | 0.5 | n/a |
| scalarMae | null (not measurable here) | 0.15 | n/a |
| prevalenceFlag | 1.0000 | 0.5 | FAIL |

## Failure reasons (cache errors)

- 1× profile validation failed: craft: more than one "instrumentation.*" value for a music

## Prevalence (top 30 globally)

| key | family | global | movie | tv | anime | book | music | |
|---|---|---|---|---|---|---|---|---|
| ache | feeling | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | REVIEW |
| complexity | story | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | REVIEW |
| intensity | feeling | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | REVIEW |
| moral-complexity | story | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | REVIEW |
| pace | feeling | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | REVIEW |
| aftertaste.lingering | feeling | 0.96 | 0.96 | 0.95 | 1.00 | 0.91 | 1.00 | REVIEW |
| momentum.unpredictable | story | 0.87 | 1.00 | 1.00 | 1.00 | 0.83 | 0.58 | REVIEW |
| register.meditative | feeling | 0.85 | 0.83 | 0.80 | 0.83 | 0.96 | 0.83 | REVIEW |
| conflict.vs-self | story | 0.84 | 0.83 | 0.85 | 0.94 | 0.96 | 0.67 | REVIEW |
| arc.transformation | story | 0.83 | 1.00 | 0.90 | 1.00 | 0.83 | 0.46 | REVIEW |
| stakes.personal | story | 0.80 | 0.83 | 0.65 | 0.67 | 0.83 | 0.96 | REVIEW |
| tone.wistful | feeling | 0.79 | 0.71 | 0.60 | 0.67 | 0.96 | 0.96 | REVIEW |
| register.intimate | feeling | 0.77 | 0.79 | 0.65 | 0.67 | 0.78 | 0.92 | REVIEW |
| tone.earnest | feeling | 0.72 | 0.63 | 0.80 | 0.78 | 0.96 | 0.50 | REVIEW |
| tone.melancholy | feeling | 0.68 | 0.54 | 0.50 | 0.72 | 0.74 | 0.88 | REVIEW |
| structure.linear | story | 0.67 | 0.67 | 0.75 | 0.72 | 0.74 | 0.50 | REVIEW |
| world.lived-in | story | 0.65 | 0.83 | 0.85 | 0.89 | 0.70 | 0.08 | REVIEW |
| bond.found-family | story | 0.63 | 0.71 | 1.00 | 0.83 | 0.61 | 0.13 | REVIEW |
| aftertaste.haunting | feeling | 0.61 | 0.50 | 0.50 | 0.61 | 0.70 | 0.71 | REVIEW |
| setting.contemporary | story | 0.57 | 0.75 | 0.80 | 0.61 | 0.43 | 0.29 | REVIEW |
| setting.urban | story | 0.55 | 0.83 | 0.75 | 0.67 | 0.35 | 0.21 | REVIEW |
| cast.single-protagonist | story | 0.54 | 0.46 | 0.15 | 0.50 | 0.91 | 0.63 | REVIEW |
| texture.hazy | feeling | 0.54 | 0.54 | 0.55 | 0.39 | 0.48 | 0.71 | REVIEW |
| frame.realism | story | 0.51 | 0.54 | 0.55 | 0.17 | 0.70 | 0.54 | REVIEW |
| register.quiet | feeling | 0.51 | 0.58 | 0.60 | 0.44 | 0.70 | 0.25 | REVIEW |
| world.systemic | story | 0.50 | 0.46 | 0.80 | 0.61 | 0.48 | 0.21 |  |
| momentum.suspenseful | story | 0.49 | 0.58 | 0.65 | 0.78 | 0.43 | 0.08 |  |
| texture.dense | feeling | 0.49 | 0.54 | 0.65 | 0.72 | 0.43 | 0.17 |  |
| aftertaste.hopeful | feeling | 0.47 | 0.54 | 0.45 | 0.56 | 0.52 | 0.29 |  |
| cast.ensemble | story | 0.45 | 0.54 | 0.80 | 0.67 | 0.30 | 0.04 |  |

- Singleton keys (exactly 1 profile): 6

## Category artifacts (report-only)

- none

## Group fill (cap = SPEC §1.2)

| group | mean count | cap | share at cap |
|---|---|---|---|
| theme | 3.86 | 4 | 90% |
| arc | 1.72 | 2 | 83% |
| conflict | 1.80 | 2 | 85% |
| cast | 1.78 | 3 | 17% |
| bond | 1.50 | 2 | 72% |
| world | 1.75 | 2 | 81% |
| setting | 2.52 | 3 | 72% |
| frame | 2.34 | 3 | 59% |
| structure | 1.63 | 2 | 71% |
| momentum | 2.20 | 3 | 46% |
| stakes | 1.00 | 1 | 100% |
| ending | 1.00 | 1 | 100% |
| tone | 3.87 | 4 | 88% |
| register | 2.81 | 3 | 82% |
| texture | 2.83 | 3 | 83% |
| aftertaste | 2.93 | 3 | 94% |
| craft | 0.00 | 8 | 0% |

## Mean confidence

- story: 0.795 · feeling: 0.754

## Premise

- null premise: 3/109
- praise-guard drops: 0

## Music (profiled, never matched — DECISIONS #50)

- 24 profiles
- ache: 1.00
- aftertaste.lingering: 1.00
- complexity: 1.00
- intensity: 1.00
- moral-complexity: 1.00
- pace: 1.00
- stakes.personal: 0.96
- tone.wistful: 0.96
- register.intimate: 0.92
- tone.melancholy: 0.88

Note: canon profiles come from title, creator, year and genres only (canon has no overviews), so they rely on the model's knowledge of the work.

Caps used by the schema: {"theme":4,"arc":2,"conflict":2,"cast":3,"bond":2,"world":2,"setting":3,"frame":3,"structure":2,"momentum":3,"stakes":1,"ending":1,"tone":4,"register":3,"texture":3,"aftertaste":3,"craft":8}
