-- ============================================================
--  Scope vautcher_admin_clients() to a single restaurant
--
--  When p_restaurant_id is provided, return only diners who have at
--  least one stamp at that restaurant, with their stamp count for
--  that restaurant (not the global count). Powers the admin panel's
--  restaurant filter: pick a restaurant from the dropdown, the
--  Clients tab is scoped accordingly.
--
--  When p_restaurant_id is null, behaviour is identical to the
--  previous global version.
--
--  Re-runnable (idempotent).
-- ============================================================

create or replace function public.vautcher_admin_clients(
  p_restaurant_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;

  if p_restaurant_id is null then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'birth_date', p.birth_date,
        'locked', p.locked,
        'stamps', (select count(*) from public.vautcher_stamps s
                    where s.profile_id = p.id)
      ) order by p.name)
      from public.vautcher_profiles p
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'birth_date', p.birth_date,
      'locked', p.locked,
      'stamps', s.cnt
    ) order by p.name)
    from public.vautcher_profiles p
    join lateral (
      select count(*) as cnt
        from public.vautcher_stamps s
       where s.profile_id    = p.id
         and s.restaurant_id = p_restaurant_id
    ) s on s.cnt > 0
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.vautcher_admin_clients(uuid) to authenticated;
