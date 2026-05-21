-- ============================================================
--  Owner dashboard — per-event attendee counts
--
--  vautcher_event_rsvps has RLS enabled with NO policies, so a
--  restaurant owner cannot read it directly. This definer function
--  returns RSVP counts scoped to the caller's OWN restaurant only —
--  the restaurant is derived from the caller's email via
--  vautcher_owners, so it cannot be used to read another venue.
--  Re-runnable (idempotent).
-- ============================================================

create or replace function public.vautcher_owner_event_stats()
returns table (event_id uuid, attendees bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.id,
         (select count(*) from public.vautcher_event_rsvps r where r.event_id = e.id)
  from public.vautcher_events e
  join public.vautcher_owners o on o.restaurant_id = e.restaurant_id
  where lower(o.email) = lower(auth.jwt() ->> 'email');
$$;

revoke all on function public.vautcher_owner_event_stats() from public;
grant execute on function public.vautcher_owner_event_stats() to authenticated;
