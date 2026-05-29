-- ============================================================
--  Set a tenant's home template (classic / modern / …).
--
--  Lives inside config.template so the diner app's site.js reads it
--  through the existing reactive pipeline. Moderator-only — the RPC
--  refuses if the caller isn't in vautcher_moderators.
--
--  The diner page also accepts ?preview=<name> as a runtime override
--  for before/after demos; that does NOT call this RPC.
--
--  Re-runnable (idempotent).
-- ============================================================

create or replace function public.vautcher_admin_set_template(
  p_restaurant_id uuid,
  p_template      text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;
  if p_template not in ('classic', 'modern') then
    raise exception 'unknown template: %', p_template;
  end if;
  update public.vautcher_restaurants
     set config = jsonb_set(coalesce(config, '{}'::jsonb), '{template}', to_jsonb(p_template), true),
         deploy_status = 'pending'
   where id = p_restaurant_id;
end;
$$;

revoke all on function public.vautcher_admin_set_template(uuid, text) from public, anon;
grant execute on function public.vautcher_admin_set_template(uuid, text) to authenticated;

-- Project the current template on the admin listing so the UI can
-- highlight the active option without re-fetching the whole config.
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
      'deploy_status', r.deploy_status,
      'menu_hidden', coalesce((r.config ->> 'hide_menu')::boolean, false),
      'template', coalesce(r.config ->> 'template', 'classic'),
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
