-- ============================================================
--  vautcher_restaurant_clients(p_restaurant_id)
--
--  Diners who have stamped at the given restaurant, with their
--  per-restaurant stamp count and last-visit date. Powers the
--  new Clients tab in restowner — both for plain owners (their
--  own restaurant only) and for moderators (any restaurant via
--  the scope picker).
--
--  Access:
--    - moderators always
--    - owners only for restaurants they own and aren't locked on
--    - everyone else: not authorized
--
--  Re-runnable (idempotent).
-- ============================================================

create or replace function public.vautcher_restaurant_clients(
  p_restaurant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email   text := lower(auth.jwt() ->> 'email');
  v_allowed boolean;
begin
  select public.vautcher_is_moderator()
      or exists (
        select 1 from public.vautcher_owners
         where restaurant_id = p_restaurant_id
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
      'stamps',     s.cnt,
      'last_visit', s.last_visit
    ) order by s.last_visit desc nulls last, lower(p.name))
    from public.vautcher_profiles p
    join lateral (
      select count(*)        as cnt,
             max(stamp_date) as last_visit
        from public.vautcher_stamps s
       where s.profile_id    = p.id
         and s.restaurant_id = p_restaurant_id
    ) s on s.cnt > 0
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.vautcher_restaurant_clients(uuid) from public, anon;
grant execute on function public.vautcher_restaurant_clients(uuid) to authenticated;
