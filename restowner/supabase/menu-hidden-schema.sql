-- ============================================================
--  Hide a tenant's menu section (config.hide_menu)
--
--  When the scaffolder's menu recognition is poor, the moderator can
--  hide the menu on the published site rather than ship a wrong one.
--  The diner app reads config.hide_menu at runtime and removes the menu
--  section (no redeploy needed). Moderator-only.
--
--  Re-runnable (idempotent).
-- ============================================================

create or replace function public.vautcher_admin_set_menu_hidden(
  p_restaurant_id uuid,
  p_hidden boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;
  update public.vautcher_restaurants
     set config = coalesce(config, '{}'::jsonb)
                || jsonb_build_object('hide_menu', coalesce(p_hidden, false))
   where id = p_restaurant_id;
end;
$$;
revoke all on function public.vautcher_admin_set_menu_hidden(uuid, boolean) from public, anon;
grant execute on function public.vautcher_admin_set_menu_hidden(uuid, boolean) to authenticated;
