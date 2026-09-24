# Repeatability report

- Model: `nvidia/nemotron-3-super-120b-a12b` · 2026-09-24
- Calls used: 273/500
- Latency p50 13682 ms · p95 81453 ms · timeouts 7

## evaluate() PASS/FAIL (profiles; readings are diagnostic)

| metric | value | threshold | pass |
|---|---|---|---|
| firstPassStrict | 0.8807 | 0.9 | FAIL |
| committedStrict | 1.0000 | 1 | PASS |
| agreementStory | 0.5020 | 0.5 | PASS |
| agreementFeeling | 0.5285 | 0.5 | PASS |
| scalarMae | 0.0317 | 0.15 | PASS |
| prevalenceFlag | 1.0000 | 0.5 | FAIL |

## A. Profile repeatability (20 items × 3 runs)

- strict validity per run: movie-spirited-away:3, movie-eternal-sunshine:3, movie-the-godfather:3, movie-parasite:2, tv-breaking-bad:3, tv-the-office-us:3, tv-fleabag:1, tv-the-bear:2, anime-cowboy-bebop:2, anime-neon-genesis-evangelion:2, anime-your-name:2, anime-fullmetal-alchemist-brotherhood:2, book-the-great-gatsby:3, book-1984:3, book-to-kill-a-mockingbird:3, book-normal-people:3, song-hallelujah-buckley:1, song-bohemian-rhapsody:2, song-motion-picture-soundtrack:2, song-holocene:2
- mean pairwise weightedJaccard — story: 0.502 · feeling: 0.528
- mean topKOverlap(5) — story: 0.535 · feeling: 0.571
- mean scalarMae (5 scalars): 0.032

## B. Reading repeatability (35 notes × 3 runs, diagnostic only)

- mean weightedJaccard — story: 0.713 · feeling: 0.789
- pairs where both sides empty (excluded): 0
- mean scalarMae: 0.033
- mean setJaccard — absent: 0.000 · didnt_work: 0.000
- verbatim guard drops: 2/132
- schema-failure rate: 21/105

### Per-item rows (profiles)

| slug | runs valid | story J (pairs) | feeling J | scalar MAE |
|---|---|---|---|---|
| movie-spirited-away | 3/3 | 0.90 | 0.79 | 0.02 |
| movie-eternal-sunshine | 3/3 | 0.77 | 0.84 | 0.02 |
| movie-the-godfather | 3/3 | 0.76 | 0.82 | 0.05 |
| movie-parasite | 2/3 | 0.26 | 0.23 | 0.08 |
| tv-breaking-bad | 3/3 | 0.71 | 0.70 | 0.05 |
| tv-the-office-us | 3/3 | 0.77 | 0.88 | 0.03 |
| tv-fleabag | 1/3 | 0.00 | 0.00 | - |
| tv-the-bear | 2/3 | 0.27 | 0.28 | 0.07 |
| anime-cowboy-bebop | 2/3 | 0.24 | 0.27 | 0.04 |
| anime-neon-genesis-evangelion | 2/3 | 0.23 | 0.30 | 0.07 |
| anime-your-name | 2/3 | 0.28 | 0.32 | 0.04 |
| anime-fullmetal-alchemist-brotherhood | 2/3 | 0.24 | 0.32 | 0.05 |
| book-the-great-gatsby | 3/3 | 0.72 | 0.81 | 0.02 |
| book-1984 | 3/3 | 0.81 | 0.80 | 0.01 |
| book-to-kill-a-mockingbird | 3/3 | 0.84 | 0.68 | 0.04 |
| book-normal-people | 3/3 | 0.84 | 0.88 | 0.00 |
| song-hallelujah-buckley | 1/3 | 0.00 | 0.00 | - |
| song-bohemian-rhapsody | 2/3 | 0.24 | 0.26 | 0.04 |
| song-motion-picture-soundtrack | 2/3 | 0.11 | 0.26 | 0.03 |
| song-holocene | 2/3 | 0.20 | 0.25 | 0.00 |
