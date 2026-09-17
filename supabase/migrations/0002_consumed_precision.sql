-- 0002: honest, approximate "when did you consume this".
--
-- consumed_at stays the start of the period the user named. consumed_precision says how
-- precise that is, and consumed_until closes the period (the end of that year or season,
-- or the last year of a span like "as a teen"). Null precision means an exact day, which
-- is what every row written before this migration meant.
--
-- No new table, so no new RLS: entries already has "entries: own rows".

alter table public.entries
  add column consumed_precision text
    check (consumed_precision in ('day', 'month', 'season', 'year', 'range')),
  add column consumed_until date;

alter table public.entries
  add constraint entries_consumed_until_after_start
    check (consumed_until is null or (consumed_at is not null and consumed_until >= consumed_at));

-- Onboarding picks used to be stamped with the day they were picked, which put a lifetime of
-- favourites into a single month. That date was a default, never something the user said.
-- Clear it only where it still equals the creation day, so nothing the user set is touched.
update public.entries
  set consumed_at = null
  where origin = 'onboarding_pick'
    and consumed_at = (created_at at time zone 'utc')::date;
