-- ============================================================
--  Project deploy_status + deploy_log_url in vautcher_admin_restaurants().
--
--  The new bespoke scaffold pipeline writes deploy_status =
--  'scaffolding' immediately, then transitions through 'pending' →
--  'success' as the GitHub workflows progress. Restowner's Admin
--  list shows a status badge per tenant so the moderator can see
--  the design generation finish without watching the logs.
--
--  Re-runnable (CREATE OR REPLACE).
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
      'template', coalesce(r.config ->> 'template', 'classic'),
      'scaffold_tier', r.scaffold_tier,
      'scaffold_tokens_used', r.scaffold_tokens_used,
      'deploy_status', r.deploy_status,
      'deploy_log_url', r.deploy_log_url,
      'deployed_at', r.deployed_at,
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
