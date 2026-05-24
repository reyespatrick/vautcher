-- ============================================================
--  Recurrence patterns + per-frequency horizons
--
--  Adds:
--    - vautcher_events.recurrence_pattern: 'date' | 'weekday'
--      Only meaningful when recurrence='monthly'.
--        'date'    = same calendar date every month (the original
--                    behaviour — e.g., the 21st of every month).
--        'weekday' = same Nth weekday of every month (e.g., the
--                    3rd Tuesday). Computed from the parent date.
--
--    - vautcher_materialize_series() now picks a sensible default
--      occurrence count when p_count is null:
--        weekly   →  4   (covers ~1 month)
--        biweekly →  6   (covers ~3 months)
--        monthly  → 12   (covers 12 months)
--      and handles the 'weekday' monthly pattern.
--
--  Re-runnable (idempotent).
-- ============================================================

alter table public.vautcher_events
  add column if not exists recurrence_pattern text not null default 'date';

alter table public.vautcher_events
  drop constraint if exists vautcher_events_recurrence_pattern_chk;
alter table public.vautcher_events
  add constraint vautcher_events_recurrence_pattern_chk
  check (recurrence_pattern in ('date', 'weekday'));

-- ---------- Helper: Nth weekday of (parent's month + offset) ----------
-- Given the parent date, returns "same Nth weekday" in the month
-- offset by p_months_offset. If the target month has fewer than N
-- occurrences of that weekday, the last available occurrence is used
-- so the materialised date never spills into a neighbouring month.
create or replace function public.vautcher_nth_weekday_of_month(
  p_base          date,
  p_months_offset int
)
returns date
language plpgsql
immutable
as $$
declare
  v_wd        int := extract(isodow from p_base)::int;        -- 1=Mon … 7=Sun
  v_nth       int := ceil(extract(day from p_base) / 7.0)::int;
  v_first     date := (date_trunc('month', p_base) + (p_months_offset * interval '1 month'))::date;
  v_first_wd  int := extract(isodow from v_first)::int;
  v_offset    int := (v_wd - v_first_wd + 7) % 7;
  v_candidate date := v_first + v_offset + ((v_nth - 1) * 7);
  v_last_day  date := (date_trunc('month', v_first) + interval '1 month - 1 day')::date;
begin
  -- Cap if the candidate spills into the next month — fall back to
  -- the prior week (i.e. the last occurrence of that weekday).
  while v_candidate > v_last_day loop
    v_candidate := v_candidate - 7;
  end loop;
  return v_candidate;
end;
$$;

-- ---------- Rewritten materialiser ----------
create or replace function public.vautcher_materialize_series(
  p_event_id uuid,
  p_count    int default null     -- null = auto-pick by recurrence
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  parent   public.vautcher_events;
  d        date;
  i        int;
  inserted int := 0;
  v_count  int;
begin
  select * into parent from public.vautcher_events where id = p_event_id;
  if parent.id is null then return 0; end if;
  if parent.recurrence is null or parent.recurrence = 'none' then return 0; end if;

  -- Default horizons per the product spec:
  --   weekly   →  4 (~1 month)
  --   biweekly →  6 (~3 months)
  --   monthly  → 12 (12 months)
  v_count := coalesce(p_count, case parent.recurrence
    when 'weekly'   then 4
    when 'biweekly' then 6
    when 'monthly'  then 12
    else 0
  end);

  for i in 1 .. v_count loop
    if parent.recurrence = 'weekly' then
      d := parent.event_date + (i * 7);
    elsif parent.recurrence = 'biweekly' then
      d := parent.event_date + (i * 14);
    elsif parent.recurrence = 'monthly' then
      if parent.recurrence_pattern = 'weekday' then
        d := public.vautcher_nth_weekday_of_month(parent.event_date, i);
      else
        d := (parent.event_date + (i * interval '1 month'))::date;
      end if;
    else
      exit;
    end if;

    insert into public.vautcher_events (
      title, description, event_date, event_time, location, price, image_url,
      restaurant_id, age_min, age_max, points_min, points_max,
      notify_days_before, rebate_value, rebate_unit, rebate_first_n,
      max_participants, published, status, recurrence, recurrence_pattern,
      moderation_status, announced_at
    ) values (
      parent.title, parent.description, d, parent.event_time, parent.location,
      parent.price, parent.image_url, parent.restaurant_id,
      parent.age_min, parent.age_max, parent.points_min, parent.points_max,
      parent.notify_days_before, parent.rebate_value, parent.rebate_unit,
      parent.rebate_first_n, parent.max_participants, parent.published,
      parent.status, parent.recurrence, parent.recurrence_pattern,
      parent.moderation_status, now()  -- pre-marked so announce trigger is a no-op
    );
    inserted := inserted + 1;
  end loop;

  return inserted;
end;
$$;
grant execute on function public.vautcher_materialize_series(uuid, int) to authenticated;
