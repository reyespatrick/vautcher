-- ============================================================
--  Recurring events
--
--  An event can be marked weekly / biweekly / monthly. On save the
--  editor calls vautcher_materialize_series() to insert the next N
--  occurrences (default 8) as separate event rows so the existing
--  events stack — RSVPs, scanning, etc. — keeps working per row.
--
--  recurrence values: 'none' | 'weekly' | 'biweekly' | 'monthly'
--
--  Re-runnable (idempotent).
-- ============================================================

alter table public.vautcher_events
  add column if not exists recurrence text not null default 'none';

alter table public.vautcher_events
  drop constraint if exists vautcher_events_recurrence_chk;
alter table public.vautcher_events
  add constraint vautcher_events_recurrence_chk
  check (recurrence in ('none', 'weekly', 'biweekly', 'monthly'));

-- Materialises N future occurrences of a recurring event.
-- - Pulls the parent row, copies it onto each future date.
-- - announced_at is set on the children so the announce trigger
--   doesn't re-fire 8 pushes when the series is created (the parent
--   row alone triggers the announce, if notify_days_before = 0).
-- - The trigger that forces moderation_status from the owner's
--   trust level still runs on each insert (per-row policy).
create or replace function public.vautcher_materialize_series(
  p_event_id uuid,
  p_count    int default 8
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  parent  public.vautcher_events;
  d       date;
  i       int;
  inserted int := 0;
begin
  select * into parent from public.vautcher_events where id = p_event_id;
  if parent.id is null then return 0; end if;
  if parent.recurrence is null or parent.recurrence = 'none' then return 0; end if;

  for i in 1 .. p_count loop
    if parent.recurrence = 'weekly' then
      d := parent.event_date + (i * 7);
    elsif parent.recurrence = 'biweekly' then
      d := parent.event_date + (i * 14);
    elsif parent.recurrence = 'monthly' then
      d := (parent.event_date + (i * interval '1 month'))::date;
    else
      exit;
    end if;

    insert into public.vautcher_events (
      title, description, event_date, event_time, location, price, image_url,
      restaurant_id, age_min, age_max, points_min, points_max,
      notify_days_before, rebate_value, rebate_unit, rebate_first_n,
      max_participants, published, status, recurrence,
      moderation_status, announced_at
    ) values (
      parent.title, parent.description, d, parent.event_time, parent.location,
      parent.price, parent.image_url, parent.restaurant_id,
      parent.age_min, parent.age_max, parent.points_min, parent.points_max,
      parent.notify_days_before, parent.rebate_value, parent.rebate_unit,
      parent.rebate_first_n, parent.max_participants, parent.published,
      parent.status, parent.recurrence,
      parent.moderation_status, now()  -- pre-marked so announce trigger is a no-op
    );
    inserted := inserted + 1;
  end loop;

  return inserted;
end;
$$;
revoke all on function public.vautcher_materialize_series(uuid, int) from public;
grant execute on function public.vautcher_materialize_series(uuid, int) to authenticated;
