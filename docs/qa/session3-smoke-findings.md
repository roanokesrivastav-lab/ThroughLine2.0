# Session 3 smoke-run STOP report (2026-09-23)

Status: **STOPPED at the smoke gate** per handoff §7 ("The smoke run fails on both items, or the output looks structurally wrong"). No full canon run was started. The repo is left green and uncommitted; `canon-profiles.ts` still holds 0 entries.

## What works

- All offline machinery is built and green: `qa.ts` metrics, `CallLedger`/`withRetries`/cache, the deterministic renderer, the zero-entry `canon-profiles.ts` + `canonProfile()`, the `PROFILE_CAPS` refactor (schema behaviour identical — all 168 Session 2 tests pass unedited), the `nvidiaReadingDraft`/`nvidiaProfileDraft` refactor, and the three scripts. `npm test` = 204/204 (168 pre-existing + 36 new), typecheck/eslint/build clean.
- Budget enforcement works: `scripts/out/calls.jsonl` holds 51 lines (well under 500); the ledger counted every attempt including retries.
- `--dry-run` inputs are clean: title/creator/year/genres/runtime only — no `feel_prior`, no `encounter_weight`, no image, no overview.

## What failed (live smoke, 51 calls)

`npm run profile:canon -- --only movie-spirited-away,book-the-hobbit` (3 runs × 3 attempts) and two partial `qa:repeat` runs **never produced a single strictly-valid profile draft** (0 of 51 calls ok). Error kinds from the ledger:

| calls | error |
|---|---|
| 21 | `invalid_value` in `story.theme.*.key` etc. — the model returns tag objects as `{"value": ...}` (and sometimes `{"name": ...}`) where the schema requires `{"key": ...}` |
| 11 | `invalid_type` — plain strings instead of `{key, weight, confidence}` objects, single objects instead of arrays (`stakes`/`ending`/`craft`), or whole drafts with `story`/`feeling`/`scalars`/`craft` missing (the groups were top-level keys) |
| 11 | NVIDIA 503 "Service temporarily overloaded" |
| 3 | timeout (120 s abort) |
| 4 | prose-wrapped/truncated JSON (including a reasoning model that spent tokens on "We need to...") |

### What was fixed during the smoke

1. **`value` → `key` dialect**: `nvidiaProfileDraft` now normalizes `{value, weight, confidence}` to `{key, weight, confidence}` before the strict parse (adapter plumbing only — `ProfileDraftSchema` and `PROFILE_SYSTEM_PROMPT` untouched, per the §2 out-of-scope list). This fixed the single most common failure.
2. **Missing budget stop in the readings loop** of `repeat-eval.mts`: a `BudgetExceededError` now breaks the loop and marks the report PARTIAL.

### Why I stopped anyway

The model's JSON **dialect is unstable run-to-run**: across successive probes of the same item I observed `{"value": ...}`, `{"name": ...}`, bare strings in place of tag objects, scalar objects where arrays belong, and drafts missing the `story`/`feeling` wrappers entirely. The normalizer could chase each variant, but:

- Perfection was explicitly out of scope: "Changing ... ProfileDraftSchema ... (the only exception is the behaviour-identical PROFILE_CAPS refactor)". Robust repair belongs in the schema or prompt, both frozen this session. Chasing the dialect in adapter code risks silently accepting malformed drafts — the opposite of "unknown keys are rejected, never clamped" (#65).
- Success rate through the strict gate was ~1 in 4 probes at best (6/23 profile calls parsed; most of those only after retries), with 503s on top. The full 110-item run would burn ~300+ calls for a mostly-empty module and blow through the §7 "more than 30% of the first 20 items fail validation" stop anyway.

## Founder decision needed (pick one; each changes a frozen file, so it needs your authorization)

1. **Strengthen the prompt** (Session 4's cheaper fix): add an explicit JSON shape example with `key`/`weight`/`confidence` and "arrays always, never bare strings". `PROFILE_SYSTEM_PROMPT` is frozen to this session, so this is a one-line founder go-ahead — but it changes the prompt hash, invalidating the 51 cache entries (they're all failures anyway).
2. **Broaden the adapter normalizer** (no schema change): accept `name` as a `key` alias, coerce a bare string in a tag array to `{key: s, weight: 1, confidence: 0.5}`, wrap single objects into arrays, and hoist top-level `theme`/`arc`/... into a `story` wrapper. Maximally compatible but starts to look like clamping rather than rejecting.
3. **Try a different NVIDIA model** for profiling (e.g. a non-reasoning model with steadier JSON): `NVIDIA_MODEL` is already an env var; zero code change, one env edit, re-run the smoke.

Whichever is chosen, the offline layer needs no changes; re-running `npm run profile:canon` resumes from the (empty) cache and the ledger continues from 51/500.

## Ledger

- `scripts/out/calls.jsonl`: 51 lines, ≤ 500, no keys or request bodies (test-checked).
- Cache: `scripts/out/canon/*.json` — 2 smoke entries, both `draft: null` with errors; reusable only on a provider/model/version/prompt-hash match, so a prompt change discards them cleanly.
