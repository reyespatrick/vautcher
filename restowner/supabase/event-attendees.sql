-- ============================================================
--  vautcher_event_attendees(p_event_id)
--
--  Diners who have RSVPed to a specific event. Returns name, age,
--  RSVP timestamp, lock state — enough to power the owner's
--  "inscrits" list page.
--
--  Access:
--    - moderators always
--    - owners only for events whose restaurant_id they own
--      (and they aren't locked on that restaurant)
--    - everyone else: not authorized
--
--  Re-runnable (idempotent).
-- ============================================================

create or replace function public.vautcher_event_attendees(
  p_event_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email   text := lower(auth.jwt() ->> 'email');
  v_resto   uuid;
  v_allowed boolean;
begin
  select restaurant_id into v_resto
    from public.vautcher_events where id = p_event_id;
  if v_resto is null then
    raise exception 'event not found';
  end if;

  select public.vautcher_is_moderator()
      or exists (
        select 1 from public.vautcher_owners
         where restaurant_id = v_resto
           and lower(email)  = v_email
           and not locked
      )
    into v_allowed;
  if not v_allowed then
    raise exception 'not authorized';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',         p.id,
      'name',       p.name,
      'birth_date', p.birth_date,
      'locked',     p.locked,
      'rsvped_at',  r.created_at
    ) order by r.created_at)
    from public.vautcher_event_rsvps r
    join public.vautcher_profiles p on p.id = r.profile_id
    where r.event_id = p_event_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.vautcher_event_attendees(uuid) from public, anon;
grant execute on function public.vautcher_event_attendees(uuid) to authenticated;
