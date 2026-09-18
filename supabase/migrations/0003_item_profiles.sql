-- 0003: item profiles for Stage 3 matching.
--
-- One profile per media_items row: the story and feeling attributes, the length band,
-- and the flattened vectors the scorer reads. profile holds the ItemProfile shape
-- written by the profiler; profile_version must equal the PROFILE_VERSION constant in
-- code for a profile to be usable, so a change to the profiling prompt, schema or merge
-- rules can roll out without old profiles being mistaken for current ones. Rows with a
-- profile whose version no longer matches stay 'done' but are treated as unprofiled
-- until they are re-run.
--
-- profile_status is the queue the profiler works from: 'pending' rows are profiled a
-- few at a time inline after a response and in a bounded daily batch. Every row that
-- existed before this migration becomes 'pending' with no profile, which is exactly
-- right: it has no profile yet and is queued to get one. 'failed' rows keep their
-- last_error and are retried until profile_attempts reaches the cap in code.
--
-- No RLS change: media_items is readable by any signed-in user and written only by
-- server code (DECISIONS #4), and a profile is derived catalogue data, not user
-- content. Nothing here exposes one user's data to another.

alter table public.media_items
  add column profile jsonb,                          -- null = no profile exists
  add column profile_version text,                   -- null = no profile exists
  add column profile_status text not null default 'pending'
    check (profile_status in ('pending', 'done', 'failed')),
  add column profile_attempts int not null default 0,
  add column profile_error text,                     -- null = no error
  add column profiled_at timestamptz;                -- null = never profiled

-- Serves the profiling queue: which rows still need a profile, and how fresh the
-- done ones are (the candidate pool reads the most recently profiled first).
create index media_items_profile_status_idx on public.media_items (profile_status, profiled_at);
