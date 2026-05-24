-- ============================================================
--  Project source_url in vautcher_admin_restaurants()
--
--  The scaffold-tenant edge function stores the URL it crawled in
--  config.source_url. Surfacing it on the admin card lets the
--  moderator click through to the original website without
--  guessing where the row came from.
--
--  Re-runnable (idempotent).
-- ============================================================

create or replace function public.vautcher_admin_restaurants()
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'slug', r.slug,
      'source_url', r.config ->> 'source_url',
      'owners', coalesce((
        select jsonb_agg(jsonb_build_object(
          'email', o.email, 'name', o.name,
          'trusted', o.trusted, 'locked', o.locked,
          'claim_code', o.claim_code) order by o.email)
        from public.vautcher_owners o where o.restaurant_id = r.id
      ), '[]'::jsonb)
    ) order by r.name)
    from public.vautcher_restaurants r
  ), '[]'::jsonb);
end;
$$;
