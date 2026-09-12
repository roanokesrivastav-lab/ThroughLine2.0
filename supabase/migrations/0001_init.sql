-- Throughline schema v1
-- Every user-writable table has row-level security. The shared media catalog is
-- readable by any signed-in user and written only by server code (service role).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- users (profile row per auth user)
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  onboarding_prefs jsonb not null default '{}'::jsonb,
  notification_prefs jsonb not null default '{"push": false, "cadence": "weekly", "snoozed_until": null}'::jsonb,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.users enable row level security;
create policy "users: read own" on public.users for select using (auth.uid() = id);
create policy "users: update own" on public.users for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "users: insert own" on public.users for insert with check (auth.uid() = id);
create trigger users_updated_at before update on public.users for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- media_items (shared catalog; one model across all five categories)
-- ---------------------------------------------------------------------------
create table public.media_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('movie', 'tv', 'anime', 'book', 'music')),
  title text not null,
  subtitle text,                       -- director / author / artist, for display
  source text not null,                -- 'tmdb' | 'openlibrary' | 'musicbrainz' | 'canon' | 'manual'
  external_id text not null,
  image_url text,
  release_year int,
  creators jsonb not null default '[]'::jsonb,   -- [{ name, role }]
  genre_tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,    -- runtime_minutes, pages, duration_seconds, album, episode_runtime_minutes, ...
  feel_prior jsonb,                    -- optional attribute prior (canon list); never shown as a score
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index media_items_category_idx on public.media_items (category);
create index media_items_title_idx on public.media_items (lower(title));
create index media_items_creators_idx on public.media_items using gin (creators);
alter table public.media_items enable row level security;
create policy "media_items: read when signed in" on public.media_items for select to authenticated using (true);
create trigger media_items_updated_at before update on public.media_items for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- entries (a user's relationship to one media item)
-- ---------------------------------------------------------------------------
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  media_item_id uuid not null references public.media_items (id) on delete restrict,
  status text not null default 'completed' check (status in ('want', 'in_progress', 'completed', 'dropped')),
  private_score smallint check (private_score between 1 and 10),
  consumed_at date,
  origin text not null default 'log' check (origin in ('log', 'onboarding_pick', 'canon', 'demo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, media_item_id)
);
create index entries_user_created_idx on public.entries (user_id, created_at desc);
create index entries_user_consumed_idx on public.entries (user_id, consumed_at desc);
create index entries_user_status_idx on public.entries (user_id, status);
create index entries_media_item_idx on public.entries (media_item_id);
alter table public.entries enable row level security;
create policy "entries: own rows" on public.entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger entries_updated_at before update on public.entries for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- reactions (what the user tapped and wrote; raw_note is never modified)
-- ---------------------------------------------------------------------------
create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  dimensions jsonb not null default '{}'::jsonb,  -- { loved, moved_me, stuck_with_me, would_return, changed_perspective, comforted_me, challenged_me }
  raw_note text,
  source text not null default 'log' check (source in ('log', 'onboarding', 'resurface', 'demo')),
  created_at timestamptz not null default now()
);
create index reactions_entry_idx on public.reactions (entry_id, created_at desc);
create index reactions_user_created_idx on public.reactions (user_id, created_at desc);
alter table public.reactions enable row level security;
create policy "reactions: own rows" on public.reactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- extracted_attributes (AI output; separate from reactions by design)
-- A row is inserted as 'pending' when a reaction with text is saved. The
-- extractor fills it in asynchronously; the daily cron retries failures.
-- ---------------------------------------------------------------------------
create table public.extracted_attributes (
  id uuid primary key default gen_random_uuid(),
  reaction_id uuid not null references public.reactions (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attributes jsonb,                    -- structured extraction (tones, themes, summary, quote, ...)
  vector jsonb,                        -- flattened { "tone.tender": 0.8, ... } used for scoring
  vocabulary_version text not null,
  extractor text,                      -- 'mock' | 'claude'
  attempts int not null default 0,
  last_error text,
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reaction_id, vocabulary_version)
);
create index extracted_attributes_pending_idx on public.extracted_attributes (status, created_at) where status <> 'done';
create index extracted_attributes_user_idx on public.extracted_attributes (user_id);
create index extracted_attributes_entry_idx on public.extracted_attributes (entry_id);
alter table public.extracted_attributes enable row level security;
create policy "extracted_attributes: read own" on public.extracted_attributes for select using (auth.uid() = user_id);
create policy "extracted_attributes: insert own" on public.extracted_attributes for insert with check (auth.uid() = user_id);
create policy "extracted_attributes: update own" on public.extracted_attributes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "extracted_attributes: delete own" on public.extracted_attributes for delete using (auth.uid() = user_id);
create trigger extracted_attributes_updated_at before update on public.extracted_attributes for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- phases (detected, never declared)
-- ---------------------------------------------------------------------------
create table public.phases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null check (kind in ('creator_run', 'album', 'category_stretch', 'feeling_cluster', 'genre_run')),
  fingerprint text not null,           -- stable key so re-detection updates instead of duplicating
  label text not null,                 -- generated
  user_label text,                     -- optional edit by the user
  start_at date not null,
  end_at date not null,
  category text check (category in ('movie', 'tv', 'anime', 'book', 'music')),  -- null when cross-media
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  dismissed boolean not null default false,
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);
create index phases_user_start_idx on public.phases (user_id, start_at desc);
alter table public.phases enable row level security;
create policy "phases: own rows" on public.phases for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger phases_updated_at before update on public.phases for each row execute function public.set_updated_at();

create table public.phase_members (
  phase_id uuid not null references public.phases (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  weight numeric(4,3) not null default 1,
  primary key (phase_id, entry_id)
);
create index phase_members_entry_idx on public.phase_members (entry_id);
alter table public.phase_members enable row level security;
create policy "phase_members: own rows" on public.phase_members for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- resurface_events (the input spine)
-- ---------------------------------------------------------------------------
create table public.resurface_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  surfaced_at timestamptz not null default now(),
  channel text not null default 'home' check (channel in ('home', 'push', 'onboarding')),
  response text check (response in ('still_hits', 'doesnt_hit', 'not_revisited', 'snoozed')),
  responded_at timestamptz,
  note_reaction_id uuid references public.reactions (id) on delete set null,
  snoozed_until timestamptz,
  created_at timestamptz not null default now()
);
create index resurface_events_user_surfaced_idx on public.resurface_events (user_id, surfaced_at desc);
create index resurface_events_entry_idx on public.resurface_events (entry_id, surfaced_at desc);
alter table public.resurface_events enable row level security;
create policy "resurface_events: own rows" on public.resurface_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- query_sessions (recommendation requests and their results, for debugging and reuse)
-- ---------------------------------------------------------------------------
create table public.query_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null default 'recommend' check (kind in ('recommend', 'home', 'time', 'surprise')),
  category text check (category in ('movie', 'tv', 'anime', 'book', 'music')),
  answers jsonb not null default '{}'::jsonb,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index query_sessions_user_created_idx on public.query_sessions (user_id, created_at desc);
alter table public.query_sessions enable row level security;
create policy "query_sessions: own rows" on public.query_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- imported_activity (reserved seat for history import; nothing reads or writes it yet)
-- ---------------------------------------------------------------------------
create table public.imported_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  source text not null,                -- 'letterboxd' | 'trakt' | 'goodreads' | 'spotify' | 'lastfm' | 'takeout'
  external_id text,
  payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index imported_activity_user_idx on public.imported_activity (user_id, created_at desc);
alter table public.imported_activity enable row level security;
create policy "imported_activity: own rows" on public.imported_activity for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- push_subscriptions (Web Push endpoints; one row per browser)
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,                 -- { p256dh, auth }
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "push_subscriptions: own rows" on public.push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
