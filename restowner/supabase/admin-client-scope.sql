-- ============================================================
--  Scope vautcher_admin_clients() to a single restaurant
--
--  When p_restaurant_id is provided, return only diners who have at
--  least one stamp at that restaurant, with their stamp count for
--  that restaurant (not the global count).
--
--  Stamps don't carry a restaurant_id directly — the link goes
--  vautcher_stamps.card_id → vautcher_cards.restaurant_id, so the
--  scoped branch joins through the cards table.
--
--  When p_restaurant_id is null, behaviour is identical to the
--  original global version.
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
      'stamps', agg.cnt
    ) order by p.name)
    from public.vautcher_profiles p
    join lateral (
      select count(*) as cnt
        from public.vautcher_stamps s
        join public.vautcher_cards c on c.id = s.card_id
       where s.profile_id    = p.id
         and c.restaurant_id = p_restaurant_id
    ) agg on agg.cnt > 0
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.vautcher_admin_clients(uuid) to authenticated;
