# Canon profiles QA report

- Model: `nvidia/nemotron-3-super-120b-a12b` · p1 · prompt `5d4a12956aea` · 2026-09-23

## Counts

- movie: 0/24 profiled · 1 failed · 23 unreached
- tv: 0/20 profiled · 0 failed · 20 unreached
- anime: 0/18 profiled · 0 failed · 18 unreached
- book: 0/23 profiled · 1 failed · 22 unreached
- music: 0/25 profiled · 0 failed · 25 unreached

## evaluate()

| metric | value | threshold | pass |
|---|---|---|---|
| firstPassStrict | 0.0000 | 0.9 | FAIL |
| committedStrict | 0.0000 | 1 | FAIL |
| agreementStory | null (not measurable here) | 0.5 | n/a |
| agreementFeeling | null (not measurable here) | 0.5 | n/a |
| scalarMae | null (not measurable here) | 0.15 | n/a |
| prevalenceFlag | 0.0000 | 0.5 | PASS |

## Failure reasons (cache errors)

- 2× [
  {
    "code": "invalid_value",
    "values": [
      "grief",
      "love",
      "memory",
      "loneliness",
    

## Prevalence (top 30 globally)

| key | family | global | movie | tv | anime | book | music | |
|---|---|---|---|---|---|---|---|---|

- Singleton keys (exactly 1 profile): 0

## Category artifacts (report-only)

- none

## Group fill (cap = SPEC §1.2)

| group | mean count | cap | share at cap |
|---|---|---|---|

## Mean confidence

- story: 0.000 · feeling: 0.000

## Premise

- null premise: 0/0
- praise-guard drops: 0

## Music (profiled, never matched — DECISIONS #50)

- 0 profiles

Note: canon profiles come from title, creator, year and genres only (canon has no overviews), so they rely on the model's knowledge of the work.

Caps used by the schema: {"theme":4,"arc":2,"conflict":2,"cast":3,"bond":2,"world":2,"setting":3,"frame":3,"structure":2,"momentum":3,"stakes":1,"ending":1,"tone":4,"register":3,"texture":3,"aftertaste":3,"craft":8}
