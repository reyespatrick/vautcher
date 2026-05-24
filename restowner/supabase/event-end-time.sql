-- ============================================================
--  Optional end time on events
--
--  - Adds vautcher_events.event_end_time (text, nullable). Same
--    free-form text shape as event_time ("19h30", "20:00" …).
--  - Extends the diner-facing vautcher_upcoming_events RPC to
--    project the column so the diner app can display it and use
--    it in the .ics file's DTEND.
--  - Refreshes vautcher_materialize_series so recurring children
--    inherit the parent's end time.
--
--  Re-runnable (idempotent).
-- ============================================================

alter table public.vautcher_events
  add column if not exists event_end_time text;

-- ---------- Diner-facing RPC ----------
-- DROP first because the return column list is changing (Postgres
-- refuses CREATE OR REPLACE when the OUT signature differs).
drop function if exists public.vautcher_upcoming_events(uuid, uuid);
create or replace function public.vautcher_upcoming_events(
  p_profile_id    uuid,
  p_restaurant_id uuid
)
returns table (
  id uuid, title text, description text, event_date date,
  event_time text, event_end_time text,
  location text, price text, image_url text, attendees bigint, joined boolean,
  rebate_value numeric, rebate_unit text, rebate_first_n int,
  max_participants int
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.title, e.description, e.event_date,
         e.event_time, e.event_end_time,
         e.location, e.price, e.image_url,
         (select count(*) from public.vautcher_event_rsvps r where r.event_id = e.id),
         exists (select 1 from public.vautcher_event_rsvps r
                 where r.event_id = e.id and r.profile_id = p_profile_id),
         e.rebate_value, e.rebate_unit, e.rebate_first_n,
         e.max_participants
  from public.vautcher_events e
  where e.published = true
    and e.moderation_status = 'approved'
    and e.event_date >= current_date
    and e.restaurant_id = p_restaurant_id
  order by e.event_date asc, e.sort asc;
$$;
revoke all on function public.vautcher_upcoming_events(uuid, uuid) from public;
grant execute on function public.vautcher_upcoming_events(uuid, uuid) to anon, authenticated;

-- ---------- Materialiser ----------
-- Same body as event-recurrence-pattern.sql, with event_end_time
-- threaded through the INSERT so recurring children get it.
create or replace function public.vautcher_materialize_series(
  p_event_id uuid,
  p_count    int default null
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
      title, description, event_date, event_time, event_end_time, location, price, image_url,
      restaurant_id, age_min, age_max, points_min, points_max,
      notify_days_before, rebate_value, rebate_unit, rebate_first_n,
      max_participants, published, status, recurrence, recurrence_pattern,
      moderation_status, announced_at
    ) values (
      parent.title, parent.description, d, parent.event_time, parent.event_end_time,
      parent.location, parent.price, parent.image_url, parent.restaurant_id,
      parent.age_min, parent.age_max, parent.points_min, parent.points_max,
      parent.notify_days_before, parent.rebate_value, parent.rebate_unit,
      parent.rebate_first_n, parent.max_participants, parent.published,
      parent.status, parent.recurrence, parent.recurrence_pattern,
      parent.moderation_status, now()
    );
    inserted := inserted + 1;
  end loop;

  return inserted;
end;
$$;
grant execute on function public.vautcher_materialize_series(uuid, int) to authenticated;
