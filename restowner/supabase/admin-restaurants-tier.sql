-- ============================================================
--  Project scaffold_tier + scaffold_tokens_used in
--  vautcher_admin_restaurants().
--
--  The Admin tenant card shows the current scaffold tier as a badge
--  and lets the moderator promote to a higher tier. Both fields are
--  read-only from the moderator's perspective — they're set by the
--  scaffold-tenant edge function.
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
      'scaffold_tier', r.scaffold_tier,
      'scaffold_tokens_used', r.scaffold_tokens_used,
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
