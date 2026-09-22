# Session 2: Item profiler contract (handoff for GLM 5.3)

**You implement this session, debug it yourself until every Verify command passes, and do NOT commit.**
A reviewer reads your diff next; the founder authorizes the commit.

**Outcome in one sentence:** given any `MediaItem`, three interchangeable profilers (deterministic mock, NVIDIA, Claude) produce a validated `ItemProfile` exactly as SPEC-STAGE3 §1.2 defines it. No database writes, no live model calls, no spend.

---

## 0. Before you start

Read, in order: `CLAUDE.md` · `docs/PRD.md` (§8, §9 are hard limits) · `docs/STATE.md` (last two entries) · `docs/SPEC-STAGE3.md` §1.1, §1.2, §1.4, §B (rows 16–17 and the `frameFromGenre` table) · `docs/ATTRIBUTES.md` §1B, §1C, §1D · `docs/DECISIONS.md` #4, #34, #35, #50, #52, #53, #60, #65, #66, #67.

Then read these files fully, because you will reuse them:
- `src/lib/ai/profiler.ts`: existing `ItemProfiler` interface and `frameFromGenre`. Extend it; don't rewrite it.
- `src/lib/ai/reading.ts`: the pattern to copy (Zod schema built from vocabulary lists, a pure `finalize*` step, one system prompt).
- `src/lib/ai/mock-extractor.ts` and `src/lib/ai/lexicon.ts`: the lexicon the mock profiler reuses.
- `src/lib/ai/nvidia.ts`: private `complete()` and `json()` helpers (120 s timeout, fenced-JSON cleanup).
- `src/lib/ai/extractor.ts`: `aiProvider()`, `anthropicModel()`, `getExtractor()`, and the Claude `messages.parse` + `zodOutputFormat` pattern.
- `src/lib/taste/vocabulary.ts` (`STORY_GROUPS`, `FEELING_GROUPS`, `familyOf`, `READING_SCALARS`, `STORY_SCALARS`), `src/lib/taste/form.ts` (`minutesToFinish`, `band`), `src/lib/taste/vector.ts` (`assertNonNegative`), `src/lib/taste/weights.ts` (`PROFILE_VERSION`), `src/lib/types.ts` (`ItemProfile`, `Attribute`, `MediaItem`, `MediaMetadata`).

**Baseline.** Run these and save the output. They must pass before you touch anything:
```bash
npm run typecheck
npm test
npx eslint src
npm run build
```
Expected: typecheck clean, **145/145** tests, eslint clean, build succeeds. (`npm run lint` project-wide fails on the generated `public/sw.js` with 1 error / ~86 warnings. That's pre-existing and not yours to fix. Use `npx eslint src`.) If the baseline is not green, **STOP** and report.

`git status` should show only `CLAUDE.md` (vexp version line), `.codex/`, `.freebuff/`. Don't touch or stage those.

---

## 1. Scope

### Files you may create or change (nothing else)

| File | Change |
|---|---|
| `src/lib/taste/vocabulary.ts` | **Add** craft word lists (§2.1). Change nothing existing. |
| `src/lib/ai/mock-extractor.ts` | **Refactor only:** extract the lexicon-matching loop into an exported `lexiconVector(text)` (§2.4). `mockExtract` must behave byte-identically. |
| `src/lib/ai/profile-contract.ts` (**new**) | Draft schema, caps, `profilerInput`, `buildItemProfile`, `ProfileValidationError`, system prompt (§2.2, §2.3). **Must not import `server-only`.** |
| `src/lib/ai/profiler.ts` | Keep the interface and `frameFromGenre`. Add `mockProfiler` (§2.4). **Must not import `server-only`.** |
| `src/lib/ai/nvidia.ts` | Add `nvidiaProfiler()` reusing the private `complete()`/`json()` (§2.5). |
| `src/lib/ai/item-profiler.ts` (**new**, `import "server-only"`) | `claudeProfiler(client, model)`, `profilerFor(provider)`, `getProfiler()` (§2.5). |
| `src/__tests__/profile-contract.test.ts` (**new**) | §3 tests A–M. |
| `src/__tests__/profiler.test.ts` (**new**) | §3 tests N–T. |
| `docs/DECISIONS.md` | Append #68–#72 exactly as §4 lists them. |
| `docs/STATE.md` | Append one session entry (§5). |

### Out of scope. If you find yourself needing any of this, STOP and report instead
- Any database read or write, any route, cron, `server/*.ts` file, migration, or `db/types.ts` change. (Persisting profiles is Session 4.)
- `scripts/`, `canon-profiles.ts`, running any profiler over the canon (Session 3).
- `recommend.ts`, `server/recommend.ts`, `explainer.ts`, `rec-card.tsx`, `dev/fixtures.ts`, `demo-seeds.ts`, any v1 engine.
- Changing `ItemProfile`, `Attribute`, `Reading`, `PROFILE_VERSION`, `VOCABULARY_VERSION` or any existing vocabulary list.
- Calling NVIDIA or Anthropic for real, even once. **Tests must never touch the network.**
- Adding dependencies. `package.json` must not change.
- Anything in PRD §9: no popularity, ratings, awards, reception or external scores may enter a profile or the profiler's input.

---

## 2. What to build

### 2.1 Craft words (`vocabulary.ts`, additive)

Implement ATTRIBUTES §1D as closed lists, keyed by category. A key is `"<group>.<value>"` with exactly one dot. Values are lowercase and hyphenated.

```ts
export const CRAFT: Record<Category, Record<string, readonly string[]>> = {
  movie: {
    visual: ["naturalistic", "stylised", "lush", "stark", "animated"],
    dialogue: ["sparse", "balanced", "dialogue-heavy"],
    drive: ["plot-driven", "atmosphere-driven"],
  },
  tv: {
    format: ["serialized", "episodic"],
    hook: ["immediate", "a-few-episodes", "slow"],
  },
  anime: {
    format: ["serialized", "episodic"],
    hook: ["immediate", "a-few-episodes", "slow"],
    filler: ["light", "moderate", "heavy"],
    animation: ["detailed", "stylised", "limited"],
  },
  book: {
    prose: ["spare", "ornate"],
    perspective: ["first", "third", "second", "multiple"],
    "chapter-length": ["short", "medium", "long"],
    difficulty: ["easy", "moderate", "demanding"],
    rereadability: ["low", "medium", "high"],
  },
  music: {
    energy: ["low", "medium", "high"],
    tempo: ["slow", "mid", "fast"],
    vocal: ["intimate", "theatrical", "restrained", "confessional", "aggressive", "none"],
    instrumentation: ["piano", "guitar", "synth", "strings", "percussion", "orchestral"],
    production: ["lo-fi", "spacious", "polished", "raw", "atmospheric"],
  },
};
export function isCraftKey(category: Category, key: string): boolean
```
`isCraftKey` is exact-match, like `familyOf`. The length bands (runtime, commitment, reading time) are **not** craft words; they are `form.band`. Music "lyric themes" go in story `theme`, and "lyric language" is omitted. `VOCABULARY_VERSION` does **not** change (DECISIONS #68).

### 2.2 The draft the model returns (`profile-contract.ts`)

A group-structured Zod schema, built from the vocabulary constants in the same way `ReadingSchema` is:

```ts
const tag = (values) => z.object({ key: z.enum(values), weight: z.number().min(0).max(1), confidence: z.number().min(0).max(1) });
export const ProfileDraftSchema = z.object({
  premise: z.string().max(400).nullable(),
  story: z.object({
    theme: z.array(tag(THEMES_V2)).max(4), arc: …max(2), conflict: …max(2), cast: …max(3), bond: …max(2),
    world: …max(2), setting: …max(3), frame: …max(3), structure: …max(2), momentum: …max(3),
    stakes: …max(1), ending: …max(1),
  }),
  feeling: z.object({ tone: …max(4), register: …max(3), texture: …max(3), aftertaste: …max(3) }),
  scalars: z.object({            // each { value: 0..1, confidence: 0..1 }, all optional in the schema
    intensity, ache, pace, "moral-complexity", complexity,
  }),
  craft: z.array(z.object({ key: z.string(), weight: 0..1, confidence: 0..1 })).max(8),
});
export type ProfileDraft = z.infer<typeof ProfileDraftSchema>;
```
- Unknown keys and out-of-range numbers are **rejected** by the schema, never clamped (same rule as readings, DECISIONS #65).
- Craft keys are validated in `buildItemProfile` with `isCraftKey(item.category, key)`, because the allowed set depends on the category.

### 2.3 `buildItemProfile(item, draft, opts)`: the one pure builder every profiler goes through

```ts
export class ProfileValidationError extends Error { constructor(public reasons: string[]) }
export function buildItemProfile(
  item: MediaItem,
  draft: ProfileDraft,
  opts: { attributeSource: "ai" | "catalog"; completeness: "strict" | "lenient" },
): ItemProfile
```
Apply these steps in order. Gather every problem into `reasons` and throw once at the end if there are any.

1. **Flatten.** Each group tag becomes `Attribute { key: "<group>.<value>", weight, confidence, source: opts.attributeSource }`. Story scalars (`moral-complexity`, `complexity`) become story attributes with the bare key. Feeling scalars (`intensity`, `ache`, `pace`) become feeling attributes with the bare key. Their weight is the scalar's `value`.
2. **Craft.** Keep only keys where `isCraftKey(item.category, key)` is true. Any other craft key is a reason. Keep at most one value per craft group; a second value in the same group is a reason.
3. **Frame merge (SPEC §1.2).** For each `g` in `item.genre_tags`, run it through `frameFromGenre(g)`. Each hit becomes `frame.<value>`, weight 1.0, confidence 0.9, source `"catalog"`. Where the catalogue and the draft name the same frame, keep the one with the higher `weight × confidence`; on a tie, keep the catalogue one. After merging, keep the top 3 frames by `weight × confidence`, breaking ties by key ascending (DECISIONS #69).
4. **Music confidence cap.** If `item.category === "music"`, every attribute whose source is `"ai"` gets `confidence = min(confidence, 0.5)` (DECISIONS #50, #70).
5. **Completeness.** Only when `completeness === "strict"`: story must have exactly 1 `stakes.*`, exactly 1 `ending.*`, and both story scalars; feeling must have all 3 feeling scalars. Each missing piece is a reason.
6. **Premise.**
   - `null` when `item.source === "manual"`.
   - Otherwise trimmed, and `null` if empty.
   - Set it to `null` (not a failure) if it matches the praise/reception guard `/\b(masterpiece|acclaimed|award|awards|award-winning|oscar|emmy|best-selling|bestseller|beloved|critically|critics?|masterful|must-see|popular|hit)\b/i` (DECISIONS #71).
7. **Form.** `minutes_to_finish = minutesToFinish(item)` and `band = band(item.category, minutes)`, both from `form.ts`. Never from the model. `craft` = the kept craft attributes.
8. **Ordering (deterministic).** Sort `story` by group, in `STORY_GROUPS` key order with scalars last, then by `weight × confidence` descending, then key ascending. Sort `feeling` the same way using `FEELING_GROUPS`. Sort craft by key.
9. **Vector (SPEC §1.2).** For every story and feeling attribute, `vector[F][key] = clamp01(weight × confidence)`, but only when `weight × confidence ≥ 0.05`. Round to 4 decimals **after** that threshold check. Craft never enters the vector. Call `assertNonNegative` on both families.
10. Return `{ profile_version: PROFILE_VERSION, vocabulary_version: VOCABULARY_VERSION, premise, story, feeling, form, vector }`.

Also export:
- `PROFILE_SYSTEM_PROMPT`: lists every story, feeling and craft key by group (generated from the constants, like `READING_SYSTEM_PROMPT`), the caps, and the strict completeness rule. It must include these rules, written plainly:
  - Describe what the work *is*, never how good it is.
  - Never use reviews, ratings, popularity, awards or other people's opinions.
  - `confidence` is how sure you are the attribute applies. Weight is how strongly it applies.
  - List everything that applies, within the caps, because a missing key is read as "not present".
  - The premise is ≤ 400 characters, spoiler-light, contains no praise words, and never reveals the ending. `ending.*` is still required, because it is never shown to the user (DECISIONS #52).
  - Use craft keys only from the item's category.
  - For a manual item, `premise` is `null`.
  - Return JSON only.
- `profilerInput(item): string`: the **only** item data any model sees. Include: category, title, subtitle, release year, creator names with roles, genre tags, `metadata.book_kind`, runtime/episodes/pages if present, and `metadata.overview`. **Omit the overview when `item.source === "manual"`** (SPEC §1.2). Never include `feel_prior`, `image_url`, `encounter_weight`, `external_id`, any `metadata` key not listed here, anything about any user, or any score.

### 2.4 Deterministic mock profiler (`profiler.ts`, DECISIONS #67)

First, in `mock-extractor.ts`, move the existing lexicon loop into:
```ts
export function lexiconVector(text: string): { vector: AttributeVector; absent: Set<string> }
```
Then have `mockExtract` call it. **Behaviour must be identical:** all 145 existing tests must pass without editing any of them.

```ts
export const mockProfiler: ItemProfiler = { name: "mock", profile: async (item) => mockProfile(item) };
export function mockProfile(item: MediaItem): ItemProfile
```
- Text = `item.source === "manual" ? "" : (item.metadata.overview ?? "")`.
- Run `lexiconVector(text)`. **Drop negated keys completely.** Item profiles have no `absent`.
- Convert the vector to a `ProfileDraft`. Each group tag and scalar gets confidence **0.5**. Enforce the caps by keeping the top N by weight, ties by key ascending. Set `premise: null` and `craft: []`.
- `buildItemProfile(item, draft, { attributeSource: "catalog", completeness: "lenient" })`. The frame merge adds genre frames automatically.
- No `feel_prior`, no randomness, no clock. The same item always gives a deep-equal profile.

Mock profiles are placeholders for offline tests. A header comment must say so, the same way `fixtureProfile` does.

### 2.5 Provider adapters (no network in tests)

- **`nvidiaProfiler()`** in `nvidia.ts`, `name: "nvidia"`: `json(await complete(PROFILE_SYSTEM_PROMPT, profilerInput(item), 8192), ProfileDraftSchema)` → `buildItemProfile(item, draft, { attributeSource: "ai", completeness: "strict" })`. Let errors propagate.
- **`claudeProfiler(client, model)`** in `item-profiler.ts`, `name: "claude"`: `client.messages.parse({ model, max_tokens: 4096, system: [{ type: "text", text: PROFILE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: profilerInput(item) }], output_config: { format: zodOutputFormat(ProfileDraftSchema), effort: "low" } })`. On `stop_reason === "refusal"` throw. If `parsed_output` is missing, throw. Otherwise build strict.
- **`profilerFor(provider: "claude" | "nvidia" | "mock"): ItemProfiler`** and **`getProfiler()`** = `profilerFor(aiProvider())`, cached like `getExtractor`. Reuse `aiProvider()` and `anthropicModel()` from `extractor.ts`; don't duplicate them. With `AI_PROVIDER=nvidia` and a key, that selects NVIDIA, which is the founder's chosen default (DECISIONS #67). Changing the default isn't in scope.

If `zodOutputFormat` rejects `ProfileDraftSchema` at type level (for example the nested scalar objects), simplify the *schema shape*, not the rules: for instance, move scalars into an array of `{ key: enum, value, confidence }`. Record what you changed in STATE.

---

## 3. Tests (write them first, then make them pass)

`profile-contract.test.ts` covers the pure contract. `profiler.test.ts` covers adapters and the mock. Provider tests use `vi.mock("server-only", () => ({}))`, `vi.stubGlobal("fetch", …)` / `vi.stubEnv(…)`, and a hand-written fake Anthropic client object. Any test that reaches the real network is a bug.

| # | Test |
|---|---|
| A | A valid strict draft produces a profile with `profile_version === PROFILE_VERSION` and `vocabulary_version === "v2"`. Every story key has `familyOf === "story"` and every feeling key has `familyOf === "feeling"`. |
| B | Vector rule: w×c = 0.049 → key absent; 0.05 → present; value equals `round4(clamp01(w×c))`; craft keys are never in the vector; scalars appear by their bare key in the right family. |
| C | Schema rejects: unknown story key, weight 1.2, confidence −0.1, 5 themes, premise of 401 chars. |
| D | Strict completeness: missing `stakes` → `ProfileValidationError` with a reason naming stakes; also missing `ending` and missing `pace`. Lenient: the same draft passes. |
| E | Frame merge: genre `"noir"` alone → `frame.crime` from catalog (w 1, c 0.9). The draft also naming `frame.crime` at 1.0 × 0.95 → the AI one wins. At 1.0 × 0.9 → the catalogue one wins (tie). Four candidate frames → the top 3 are kept, deterministically. |
| F | Craft: a `movie` with `visual.lush` is kept; a `movie` with `prose.spare` → error; two `visual.*` → error. |
| G | Music: AI confidence 0.9 → stored as 0.5 and the vector uses 0.5; `form.band === null`. |
| H | Manual item: premise forced `null` even if the draft has one; `profilerInput` has no overview. |
| I | Praise guard: premise "An acclaimed masterpiece about…" → `premise === null`, and the profile is otherwise built. |
| J | Form comes from metadata: a movie with `runtime_minutes: 125` → `minutes_to_finish 125`, band 2, whatever the draft says. |
| K | Ordering: shuffling the draft's array order gives a deep-equal profile. |
| L | `profilerInput` includes title/creators/genres/overview and excludes `feel_prior`, `image_url`, `encounter_weight`, `external_id`, and an injected `metadata.popularity`. |
| M | `CRAFT`/`isCraftKey`: exact match only (`"visual.lush"` ok; `"visual"`, `"visual.lush.x"`, `"visual.Lush"` rejected); music keys are invalid for movie. |
| N | `mockProfile` is deterministic (called twice → deep-equal) and passes lenient validation. |
| O | Mock on an overview containing "a story of grief and memory" includes `theme.grief`/`theme.memory` (whichever the lexicon maps). On "not a lonely film", the loneliness key is **absent** from the profile (negated → dropped). |
| P | Mock on a manual item with an overview → the overview is ignored (the vector only holds genre frames). |
| Q | NVIDIA: stubbed fetch returns a fenced JSON draft plus a sentence of prose → a valid profile; `fetch` is called once with the `/chat/completions` URL; the request body contains no `feel_prior`. |
| R | NVIDIA: invalid JSON → throws. Missing `NVIDIA_API_KEY` → throws "NVIDIA_API_KEY is not configured". A draft missing `ending` → `ProfileValidationError`. |
| S | Claude: the fake client returns `parsed_output` → a profile. `stop_reason: "refusal"` → throws. `parsed_output: null` → throws. |
| T | `profilerFor("mock").name === "mock"`, `"nvidia"` → `"nvidia"`, `"claude"` → `"claude"` (constructing them makes no network call). |

---

## 4. DECISIONS entries to append (numbers continue from #67)

Write each entry as one bolded headline plus a line of reasoning, matching the file's style:
- **68.** Craft words are closed per-category lists in `vocabulary.ts` (`CRAFT`, `isCraftKey`), implemented exactly from ATTRIBUTES §1D. No `VOCABULARY_VERSION` bump: the words were already part of the v2 specification, they have never appeared in any reading, and they never enter a vector.
- **69.** Frame merge keeps the catalogue attribute on a `weight × confidence` tie and caps merged frames at 3 (the §1.2 cap), by `weight × confidence` then key. The spec named the winner rule but not the tie or the post-merge cap.
- **70.** For music items, AI-sourced attribute confidence is capped at 0.5, per #50 and ATTRIBUTES §1D. Music isn't matched in Stage 3, so this only affects stored data.
- **71.** Premise praise/reception guard: a premise containing a reception word is dropped to `null` rather than failing the profile. §1.2 forbids praise words and #53 forbids reception, but losing a whole profile over one word is disproportionate.
- **72.** AI profiles are validated strictly (exactly one stakes, exactly one ending, all five scalars) and fail otherwise. The deterministic mock is validated leniently, because a lexicon can't honestly assert an ending. A mock profile is a placeholder, and Session 4 must never persist one as though it were real without an explicit decision.

---

## 5. STATE entry to append

Title: `## <date> — Session 2: item profiler contract (GLM, uncommitted)`. Include:
- **Built:** the files listed, one line each.
- **Verified:** paste the real final output lines of the four commands (typecheck, test count, eslint src, build). Say "AI-verified only; no live model call, no database write, nothing phone-verified".
- **Deviations:** anything you changed from this plan and why (for example the schema-shape simplification in §2.5).
- **STOPs:** anything you didn't decide.
- **Next:** Session 3 (canon profiles + extraction QA; needs the founder's spend approval) and Session 4 (profile runtime).

---

## 6. Debug loop (do this yourself until green)

1. Write the §3 tests. Run `npm test`; the new ones should fail, and the 145 existing ones should still pass.
2. Implement §2.1 → §2.4 → §2.5, running `npm test` after each.
3. When tests pass: `npm run typecheck`, `npx eslint src`, `npm run build`. Fix every error. **Don't** suppress an error with `// @ts-ignore`, `eslint-disable`, `any`, or by loosening a test assertion. If a test seems wrong, re-read the spec. If the spec really is ambiguous, that's a STOP, not a test edit.
4. Build failure due to `server-only`: a file that doesn't need secrets must not import it (`profile-contract.ts`, `profiler.ts`). A client component must never import `item-profiler.ts` or `nvidia.ts`.
5. `git diff --stat` must list only the files in §1. `git diff --check` must be clean.
6. Run all four Verify commands one final time, in sequence, and paste their output into STATE.

## 7. STOP conditions (report; do not improvise)
- The baseline wasn't green.
- A test in the existing 145 needs to change.
- Something here contradicts SPEC-STAGE3 or a DECISIONS entry.
- You need to change `ItemProfile`, `Reading`, a version constant, an existing word list, or a file outside §1.
- The Anthropic SDK types can't express the schema even after the §2.5 simplification.

## 8. Acceptance (what the reviewer will check)
- [ ] Only §1 files changed; no `package.json`, migration, route, server or DB file.
- [ ] `npm test` = 145 + the new tests, all passing; typecheck, eslint src and build clean.
- [ ] No test touches the network (the reviewer will run the tests offline).
- [ ] `mockExtract` output is unchanged (the existing extraction tests are untouched and green).
- [ ] `profilerInput` can't leak `feel_prior`, scores, popularity or user data (test L).
- [ ] Every profiler goes through `buildItemProfile`; there's no second vector-building path.
- [ ] DECISIONS #68–#72 and the STATE entry are present; nothing is marked phone-verified.
