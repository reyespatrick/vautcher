-- ============================================================
--  Root admin — update a restaurant's identity + config
--
--  Lets the restowner Admin UI author what the diner app reads from
--  vautcher_restaurants.config (brand tokens, hero, about, specialties,
--  hours, gallery, contact). Gated on vautcher_is_moderator().
--  Re-runnable (idempotent).
-- ============================================================

create or replace function public.vautcher_admin_update_restaurant(
  p_restaurant_id uuid,
  p_name          text,
  p_slug          text,
  p_config        jsonb
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
     set name   = p_name,
         slug   = p_slug,
         config = coalesce(p_config, '{}'::jsonb)
   where id = p_restaurant_id;
end;
$$;
grant execute on function public.vautcher_admin_update_restaurant(uuid, text, text, jsonb) to authenticated;
