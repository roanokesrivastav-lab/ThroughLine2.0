> **⚠ STALE, NOT EXECUTED, NOT AUTHORITATIVE (2026-09-22).** This draft was never run. Its
> assumptions are wrong in places: a read-only live database connection *does* exist, and it moves
> recommendation feedback into Stage 3, which the spec does not. The current sequence is DECISIONS
> #66. Keep this file only as a record; do not hand it to an implementer.

# A1 — Canonical data model: handoff plan

**Executor:** GLM (implementation + self-debug). **Reviewer:** founder, then a stronger-model session.
**Session type:** DESIGN ONLY. No application code changes. No live migration. No new files under `supabase/migrations/`.

---

## 0. Read first, in this order

1. `CLAUDE.md` — the rules for every session. They apply to you.
2. `docs/PRD.md` — §8 and §9 are hard limits. 🔒 sections cannot be changed.
3. `docs/STATE.md` — the latest two entries especially.
4. `docs/SPEC-STAGE3.md` §1 (data model), §4.7 (active phase), §6 (filtering, step 8 and 9), §9 (snapshot), §12 (learning contract).
5. `docs/DECISIONS.md` #4, #31, #32, #54, #55, #58, #59, #61, #65.
6. `supabase/migrations/0001_init.sql`, `0002_consumed_precision.sql`, `0003_item_profiles.sql`.
7. `src/lib/db/types.ts` (hand-written mirror of the schema; there is no generated file).
8. These code paths, to see how the tables are really used:
   - `src/lib/server/recommend.ts`: `buildCandidates`, `buildRecommendations` (the `query_sessions` insert), `materialise`
   - `src/lib/server/home.ts`: the 24h home cache in `query_sessions`
   - `src/app/api/extractions/reread/route.ts`: line ~53 **deletes** home `query_sessions` rows
   - `src/lib/server/phases.ts`, `src/app/api/phases/[id]/route.ts`
   - `src/lib/taste/tags.ts`: `candidateKey`

### 0.1 Pre-flight checks. Do these before writing anything

| Check | What to do if it fails |
|---|---|
| `git status` is clean, or the only changes are the uncommitted vocabulary-v2 cutover listed in STATE 2026-09-19 | If there are other changes, **STOP** and ask the founder. Do not commit someone else's work. |
| `docs/PRD.md` reflects the A0 rebaseline (new Stage 3 target, the locked categories/sources/provider/feedback vocabulary, and an "architecture honesty map") | **As of 2026-09-22 it does not.** PRD §7 still lists the original 11 tables and has no honesty map. Ask the founder where the A0 output is. If there isn't one, go ahead with SPEC-STAGE3 as the target, and add a **"Blocked on A0"** line to STATE. Do **not** write A0 yourself. |
| `npm run typecheck` and `npm test` pass (baseline) | Write down the failures. Do not fix them in this session. |

---

## 1. What A1 produces

Four document changes and nothing else:

| File | Change |
|---|---|
| `docs/DATA-MODEL.md` (**new**) | The canonical data model. Content is specified in §3 below. |
| `docs/DECISIONS.md` | Add entries #66 onward, one for each decision in §2 (one line of reasoning each, matching the style already in the file). |
| `docs/STATE.md` | A new dated entry: what was designed, what is still open, what A2 must do. Mark it "documents only". |
| `docs/PRD.md` §7 | **Only if the founder confirms A0 did not already do it:** add `recommendation_feedback` to the table list. §7 is not 🔒. Do not touch any other PRD section. |

The migration SQL goes **inside `docs/DATA-MODEL.md`** as fenced drafts titled `0004_… (DRAFT, not applied)`. Keeping it out of `supabase/migrations/` means nobody can apply it by accident. A2 moves it into the migrations folder once the founder approves.

---

## 2. Decisions to record

Each one below has a recommended answer. Write the recommendation into DATA-MODEL.md and DECISIONS.md and mark it **"proposed — founder to approve in A2"**. If you think a recommendation is wrong, say so in STATE under "Open". Don't quietly pick a different answer.

### D1. Naming: `media_items` is the canonical name
- The database table is `public.media_items` (plural). It is already live and the PRD uses that name. **No rename.**
- `MediaItem` (in `src/lib/types.ts`) is the in-memory domain type. `MediaItemsRow` (in `db/types.ts`) is the row type. Any spec or pasted doc that says `media_item` (singular) means this same table.
- **Candidate key** = `source:external_id` (canon: `canon:<slug>`). This is the identity everything else joins on: impressions, feedback, the "hidden" list, the recency filter. If an item's `id` contains `:`, it is not stored in the database yet (`candidateKey` in tags.ts already works this way).

### D2. Canon items get stored as real catalogue rows
- Canon items become `media_items` rows with `source = 'canon'` and `external_id = <slug>`. This happens when they need a profile (SPEC §6 step 8) or during the catalogue backfill (S3-4). The existing `unique (source, external_id)` prevents duplicates.
- Only server code can write them, using the service role (DECISIONS #4). Committed canon profiles (§E Q8) are written the same way.
- Backfill: nothing happens in A2. Rows are created on demand, starting in S3-3/S3-4.

### D3. Integrity checks for item profiles (migration 0004)
```sql
alter table public.media_items
  add constraint media_items_profile_done_complete
    check (profile_status <> 'done' or (profile is not null and profile_version is not null and profiled_at is not null)),
  add constraint media_items_profile_is_object
    check (profile is null or jsonb_typeof(profile) = 'object'),
  add constraint media_items_profile_attempts_nonneg
    check (profile_attempts >= 0);
```
No RLS change.

### D4. Integrity checks for extracted readings (migration 0004)
```sql
alter table public.extracted_attributes
  add constraint extracted_attributes_done_complete
    check (status <> 'done' or (attributes is not null and vector is not null)),
  add constraint extracted_attributes_vector_is_object
    check (vector is null or jsonb_typeof(vector) = 'object'),
  add constraint extracted_attributes_attempts_nonneg
    check (attempts >= 0);
comment on column public.extracted_attributes.extractor is 'mock | claude | nvidia';
```
- **No** check constraint on `vocabulary_version`. With one, every vocabulary bump would need its own migration.
- v1 rows are kept forever and never relabelled (DECISIONS #65). `reactions.raw_note` is never touched (CLAUDE.md).
- The existing `unique (reaction_id, vocabulary_version)` stays. It is what allows one v1 and one v2 reading per note.
- Rows that fail these checks today must be **reported** by the pre-flight query (§4). Never delete or rewrite them to make the migration pass.

### D5. `query_sessions` becomes the permanent impression log
The per-result snapshot shape stays in jsonb, exactly as SPEC §9 says. The table gets these columns:
```sql
alter table public.query_sessions
  add column feature_version text,          -- null = legacy pre-Stage-3 row (no §9 snapshot)
  add column superseded_at timestamptz;     -- set when a cached Home result is replaced; the row is kept
create index query_sessions_user_kind_created_idx on public.query_sessions (user_id, kind, created_at desc);
```
- **Critical finding to write up:** `extractions/reread/route.ts` and the home cache currently **delete** `query_sessions` rows. Once feedback refers back to an impression, deleting it destroys training data (SPEC §12). New rule: **impression rows are never deleted by cache logic.** Cache invalidation sets `superseded_at` instead. The code change belongs to S3-12/S3-14, not A1 or A2. Record it in STATE "Next" so it isn't lost.
- Legacy rows (`feature_version is null`) store `results[].id` rather than `results[].key`. The recency filter (S3-9) must read `key`, and fall back to `id` only when that `id` contains `:`. Write that down as a rule for S3-9. Don't backfill the old rows.
- The `kind` check (`recommend | home | time | surprise`) stays as it is.

### D6. New table: `recommendation_feedback` (migration 0004)
This table supersedes the "planned, not Stage 3" part of DECISIONS #55, because the new sequence (S3-15) ships feedback actions. Record that as a decision.
```sql
create table public.recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  query_session_id uuid references public.query_sessions (id) on delete set null,
  position smallint not null check (position >= 1),
  item_key text not null,                               -- candidate key, D1
  media_item_id uuid references public.media_items (id) on delete set null,
  answer text not null check (answer in (
    'save','loved_it','more_like_this','not_for_me','less_like_this',
    'maybe_later','already_know_it','too_similar')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),  -- copy of the §9.1 result as shown
  feature_version text not null,
  surprise boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (query_session_id, position)                   -- one answer per impression; changing your mind updates it
);
create index recommendation_feedback_user_version_idx
  on public.recommendation_feedback (user_id, feature_version, created_at desc);
alter table public.recommendation_feedback enable row level security;
create policy "recommendation_feedback: read own" on public.recommendation_feedback
  for select using (auth.uid() = user_id);
create policy "recommendation_feedback: insert own" on public.recommendation_feedback
  for insert with check (
    auth.uid() = user_id
    and (query_session_id is null or exists (
      select 1 from public.query_sessions q where q.id = query_session_id and q.user_id = auth.uid())));
create policy "recommendation_feedback: update own" on public.recommendation_feedback
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and (query_session_id is null or exists (
      select 1 from public.query_sessions q where q.id = query_session_id and q.user_id = auth.uid())));
create policy "recommendation_feedback: delete own" on public.recommendation_feedback
  for delete using (auth.uid() = user_id);
create trigger recommendation_feedback_updated_at before update on public.recommendation_feedback
  for each row execute function public.set_updated_at();
```
Explain these choices in DATA-MODEL.md:
- **`snapshot` is copied** onto the feedback row, so a training example survives even if its session row goes. That is also why the FK uses `on delete set null`.
- **The snapshot is always built by the server** from the stored `query_sessions` row. It never comes from the client request body. (This is a rule for the future S3-15 route. Note it.)
- Mapping answers to training labels (`y`) happens in code (SPEC §12.2). The table stores the raw answer.
- "Not for me" also keeps writing `prefs.hidden` (DECISIONS #32). It does **not** feed the anti-profile (§E Q6).
- The only person who can ever read a feedback row is its owner. No aggregate view, no count shown to anyone (PRD §2.1, §9).

### D7. `user_ranker_weights`: design it, don't create it
Write the SPEC §12.6 shape in DATA-MODEL.md as **"deferred — not in migration 0004"**. Learning isn't part of this session sequence. Creating an empty table now is just schema without a feature to use it.

### D8. Phases: tag rows with a vocabulary version
The phase system already exists: `phases`, `phase_members` and detection in `src/lib/taste` plus `server/phases.ts`. **The pasted session plan says "no phase system currently exists". That's wrong.** Correct it in STATE so S3-7 starts from what the repo actually has.
```sql
alter table public.phases add column vocabulary_version text;  -- null = legacy v1 evidence keys
```
- S3-7 maps `evidence.dominant` from v1 to v2 at load time when the value is null (SPEC §4.7). New detections write `'v2'`.
- The `kind` check stays as it is.

### D9. Ownership consistency: fix the gap in the new table, report the old ones
Current RLS checks `auth.uid() = user_id` on each row. It does **not** check that a referenced parent row (entry, phase, reaction) belongs to the same user. The new table gets the `exists` check in D6. For the existing tables (`reactions.entry_id`, `extracted_attributes.reaction_id/entry_id`, `phase_members.phase_id/entry_id`, `resurface_events.entry_id`), write a **proposed** hardening migration `0005_ownership_checks (DRAFT, optional)` using the same `exists` pattern, and flag it for the founder. Neither A1 nor A2 applies it without explicit approval.

### D10. No new columns for catalogue sources
- `media_items.category` stays limited to five values (PRD §5 🔒). Web novels, manga and similar stay books with `book_kind` (DECISIONS #34).
- `source` stays free text. Just update the comment to list `tmdb | openlibrary | musicbrainz | spotify | canon | manual`. A3/A4 add adapters without schema changes.

### D11. Types stay hand-written
There is no Supabase CLI or database connection on this machine, so A2 updates `src/lib/db/types.ts` by hand. It must add `recommendation_feedback`, the new columns, and a `RecommendationFeedbackRow` type.

---

## 3. What goes in `docs/DATA-MODEL.md`

Use exactly these headings:

1. **Purpose and sources**: one paragraph. SPEC-STAGE3 is the target. List the migrations it builds on (0001–0003).
2. **Entity map**: a table with one row per table (all 11 existing plus `recommendation_feedback`). Columns: table · owner (user / shared catalogue) · who writes it (user client via RLS / service role / both) · RLS policy · Stage 3 role · retention.
3. **Identity and keys**: D1 and D2.
4. **Per-table changes**: D3–D8, each with its DRAFT SQL block.
5. **Version fields**: SPEC §1.9, plus where each field is physically stored:
   - `vocabulary_version`: `extracted_attributes` column, `ItemProfile` json, `phases` column, snapshot
   - `profile_version`: `media_items` column, `ItemProfile` json, snapshot
   - `feature_version`: `query_sessions` column, `recommendation_feedback` column, snapshot
   - `calibration_id`: `calibration.ts`, snapshot
6. **Backfill behaviour**: for every changed table, what existing rows look like after 0004 and why nothing needs rewriting. Include the legacy `query_sessions` rule from D5.
7. **Privacy rules**: SPEC §9.3 list; nothing aggregates across users; feedback rows are visible only to their owner; external scores never stored in snapshots.
8. **Migration 0004 (DRAFT, not applied)**: every SQL block from D3–D8 combined into one file, in dependency order, wrapped in `begin; … commit;`.
9. **Migration 0005 (DRAFT, optional)**: D9.
10. **Pre-flight queries**: §4 below, for the founder to run.
11. **A2 test plan**: §5 below.
12. **Open questions for the founder**: one bullet each.

---

## 4. Read-only pre-flight queries (founder runs these in the Supabase SQL editor)

Put these in DATA-MODEL.md §10 exactly as written. Every one is a `select`. **Do not include any `update`, `delete`, `insert` or `alter`.**
```sql
-- A. Would D3 fail on live data? Expect 0.
select count(*) from public.media_items
 where (profile_status = 'done' and (profile is null or profile_version is null or profiled_at is null))
    or (profile is not null and jsonb_typeof(profile) <> 'object')
    or profile_attempts < 0;

-- B. Would D4 fail on live data? Expect 0. If not, list them (do not fix).
select id, status, vocabulary_version, extractor, attributes is null as no_attr, vector is null as no_vec
  from public.extracted_attributes
 where (status = 'done' and (attributes is null or vector is null))
    or (vector is not null and jsonb_typeof(vector) <> 'object')
    or attempts < 0;

-- C. Legacy impression rows (informational).
select kind, count(*), min(created_at), max(created_at) from public.query_sessions group by kind;

-- D. Existing cross-owner references that 0005 would forbid. Expect 0 for each.
select count(*) from public.reactions r join public.entries e on e.id = r.entry_id where e.user_id <> r.user_id;
select count(*) from public.extracted_attributes x join public.reactions r on r.id = x.reaction_id where r.user_id <> x.user_id;
select count(*) from public.phase_members m join public.phases p on p.id = m.phase_id where p.user_id <> m.user_id;
select count(*) from public.resurface_events s join public.entries e on e.id = s.entry_id where e.user_id <> s.user_id;

-- E. Vocabulary versions actually present.
select vocabulary_version, extractor, status, count(*) from public.extracted_attributes group by 1,2,3 order by 1,2,3;
```

---

## 5. A2 test plan (write it down; A2 builds it)

No Postgres runs on this machine: no Docker, `psql` or Supabase CLI. The recommended approach is to add **`@electric-sql/pglite`** as a dev dependency and write `src/__tests__/migrations.test.ts`, which:
1. Creates a stub `auth` schema: `auth.users(id uuid primary key, email text)` and `auth.uid()` reading `current_setting('request.jwt.claim.sub', true)::uuid`. Also creates the `authenticated` role.
2. Applies 0001 → 0004 in order, with no errors.
3. **Constraint tests:** each D3/D4/D6 check rejects a bad row and accepts a good one.
4. **RLS tests**, with two users A and B and `set role authenticated` plus the claim set per user:
   - B cannot select A's feedback.
   - B cannot insert feedback pointing at A's `query_session_id`.
   - A cannot insert feedback with `user_id = B`.
   - Deleting a `query_sessions` row sets feedback `query_session_id` to null and keeps the row.
   - Upserting the same `(query_session_id, position)` updates the row instead of duplicating it.
5. Applying 0004 over a database seeded with legacy-shaped rows (v1 readings, old `results` shape) succeeds without rewriting any of them.

Adding a dependency needs the founder's approval. Write it as a proposal. If PGlite can't run the `auth` stub or RLS, the fallback is a manual checklist the founder runs in the Supabase SQL editor on a **branch/staging** project, never production first.

---

## 6. Hard boundaries (STOP and ask if you're about to cross one)

- Do not create or edit anything in `supabase/migrations/`, `src/`, `scripts/` or `package.json`.
- Do not run anything against Supabase. You have no credentials, and you shouldn't look for any.
- Do not design anything from PRD §9: no aggregate or popularity columns, no cross-user views, no counts across users, no vector/embedding columns (no `pgvector`).
- Do not add §8 reserved features. `imported_activity` stays unused.
- Do not modify `reactions.raw_note` or propose any migration that rewrites it.
- Do not reopen a 🔒 decision. If a design seems to need that, write it under "Open questions".
- Do not invent behaviour the spec doesn't give. Record it as an open question instead.

---

## 7. Self-debug checklist (run before you finish)

Documents have bugs too. Check each item and write the result in STATE:

1. `npm run typecheck`, `npm test`, `npm run lint` give the same results as the baseline in §0.1. (No code changed, so any difference means you changed something by mistake.)
2. `git status` shows changes **only** under `docs/`.
3. Every table in the entity map exists in 0001–0003 or in the 0004 draft. Every column named in §3.4 exists or is added by the draft.
4. The DRAFT SQL is internally consistent: every referenced table/column exists; policy names are unique; trigger function `public.set_updated_at` is the one defined in 0001; `begin/commit` wraps 0004.
5. Every `answer` value in D6 matches SPEC §12.2 and DECISIONS #55 exactly (8 values).
6. Every version field in §3.5 matches SPEC §1.9.
7. `grep -n "update\|delete\|insert\|alter" ` over the §10 pre-flight block returns nothing.
8. Every new user-writable table has RLS enabled and policies for select/insert/update/delete.
9. The DECISIONS numbering continues from the last entry (65) with no duplicates.
10. The STATE entry says "documents only", lists the open questions, and records the three corrections:
    (a) the PRD has not been rebaselined in the repo (unless the founder shows otherwise),
    (b) a phase system does exist,
    (c) there is no FastAPI service in this repo (`grep -ri fastapi` finds nothing), so S3-18's "delete the old FastAPI service" needs the founder to say where it lives.

---

## 8. Hand back to the founder

End with a short, plain-language message:
- what was designed (one line per decision D1–D11)
- the pre-flight queries to run, and what result each should give
- the open questions, each answerable with yes/no or a short choice
- a reminder that nothing touched the database and A2 starts only after approval
