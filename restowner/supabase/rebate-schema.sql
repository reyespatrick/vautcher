-- ============================================================
--  Event rebates
--
--  An event may advertise a rebate: X percent or X CHF off, for
--  the first Z people who sign up. Stored on vautcher_events and
--  surfaced to the diner app via vautcher_upcoming_events.
--  Re-runnable (idempotent).
-- ============================================================

alter table public.vautcher_events
  add column if not exists rebate_value   numeric,
  add column if not exists rebate_unit    text,
  add column if not exists rebate_first_n int;

-- rebate_unit is 'percent' or 'chf' when a rebate is set.
alter table public.vautcher_events
  drop constraint if exists vautcher_events_rebate_unit_chk;
alter table public.vautcher_events
  add constraint vautcher_events_rebate_unit_chk
  check (rebate_unit is null or rebate_unit in ('percent', 'chf'));

-- Recreate vautcher_upcoming_events so the diner app receives the
-- rebate fields (return-type change requires a drop first).
drop function if exists public.vautcher_upcoming_events(uuid);
create function public.vautcher_upcoming_events(p_profile_id uuid)
returns table (
  id uuid, title text, description text, event_date date, event_time text,
  location text, price text, image_url text, attendees bigint, joined boolean,
  rebate_value numeric, rebate_unit text, rebate_first_n int
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.title, e.description, e.event_date, e.event_time,
         e.location, e.price, e.image_url,
         (select count(*) from public.vautcher_event_rsvps r where r.event_id = e.id),
         exists (select 1 from public.vautcher_event_rsvps r
                 where r.event_id = e.id and r.profile_id = p_profile_id),
         e.rebate_value, e.rebate_unit, e.rebate_first_n
  from public.vautcher_events e
  where e.published = true
    and e.event_date >= current_date
  order by e.event_date asc, e.sort asc;
$$;

revoke all on function public.vautcher_upcoming_events(uuid) from public;
grant execute on function public.vautcher_upcoming_events(uuid) to anon, authenticated;
