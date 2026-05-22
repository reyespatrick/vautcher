-- ============================================================
--  Event capacity — optional maximum number of participants
--
--  vautcher_events.max_participants : null = unlimited.
--  When a cap is set and reached, the diner app shows a "Complet"
--  banner and vautcher_join_event refuses further RSVPs.
--
--  NOTE: this file recreates vautcher_upcoming_events to add the
--  max_participants column — it supersedes the copy in
--  moderation-schema.sql, so it must run after it (it does, per
--  the deploy.yml migrate order).
--  Re-runnable (idempotent).
-- ============================================================

alter table public.vautcher_events
  add column if not exists max_participants int
  check (max_participants is null or max_participants > 0);

-- ---------- JOIN: enforce the cap server-side ----------
create or replace function public.vautcher_join_event(p_event_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max   int;
  v_count int;
begin
  if public.vautcher_profile_locked(p_profile_id) then
    raise exception 'this client is locked';
  end if;

  select max_participants into v_max
  from public.vautcher_events where id = p_event_id;

  -- A cap only blocks NEW joins — re-joining (idempotent) is fine.
  if v_max is not null
     and not exists (
       select 1 from public.vautcher_event_rsvps
       where event_id = p_event_id and profile_id = p_profile_id) then
    select count(*) into v_count
    from public.vautcher_event_rsvps where event_id = p_event_id;
    if v_count >= v_max then
      raise exception 'event is full';
    end if;
  end if;

  insert into public.vautcher_event_rsvps (event_id, profile_id)
  values (p_event_id, p_profile_id)
  on conflict (event_id, profile_id) do nothing;
end;
$$;

revoke all on function public.vautcher_join_event(uuid, uuid) from public;
grant execute on function public.vautcher_join_event(uuid, uuid) to anon, authenticated;

-- ---------- DINER APP: expose max_participants ----------
-- Recreate vautcher_upcoming_events with the extra column.
drop function if exists public.vautcher_upcoming_events(uuid);
create function public.vautcher_upcoming_events(p_profile_id uuid)
returns table (
  id uuid, title text, description text, event_date date, event_time text,
  location text, price text, image_url text, attendees bigint, joined boolean,
  rebate_value numeric, rebate_unit text, rebate_first_n int,
  max_participants int
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
         e.rebate_value, e.rebate_unit, e.rebate_first_n,
         e.max_participants
  from public.vautcher_events e
  where e.published = true
    and e.moderation_status = 'approved'
    and e.event_date >= current_date
  order by e.event_date asc, e.sort asc;
$$;

revoke all on function public.vautcher_upcoming_events(uuid) from public;
grant execute on function public.vautcher_upcoming_events(uuid) to anon, authenticated;
