-- ============================================================
--  Auto-rescaffold on source_url change
--
--  When the editable "Site source" field on the Admin restaurant
--  detail page changes, the tenant should be re-generated from the new
--  URL automatically instead of waiting for root to remember the
--  Régénérer button. This file installs a trigger that:
--
--    1. Detects when config.source_url is different from what it was.
--    2. Skips no-op changes (same URL), empty new URLs, and updates
--       that happen while a scaffold is already in flight (avoids
--       firing during the CI patching pass on the same row).
--    3. Flips deploy_status to 'scaffolding' immediately so the UI
--       shows progress.
--    4. POSTs the existing scaffold-tenant edge fn with
--       { restaurant_id, rescaffold: true } via pg_net, using the
--       shared cron secret so the request is authorised without a
--       moderator JWT.
--
--  Re-runnable.
-- ============================================================

create extension if not exists pg_net;

create or replace function public.vautcher_restaurants_source_url_changed()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  v_secret     text;
  v_old_source text := coalesce(old.config->>'source_url', '');
  v_new_source text := coalesce(new.config->>'source_url', '');
begin
  if v_old_source = v_new_source then return new; end if;
  if v_new_source = ''           then return new; end if;
  -- Don't restart while a scaffold is already in flight; the CI
  -- workflow patches the config row mid-run and would otherwise
  -- retrigger us on every patch.
  if coalesce(new.deploy_status, '') in ('scaffolding', 'pending') then
    return new;
  end if;

  v_secret := public.vautcher_cron_secret();
  if v_secret is null or v_secret = '' then return new; end if;

  -- Show the user something is happening straight away. This UPDATE
  -- only touches deploy_status, not config, so it does NOT re-fire
  -- this trigger (we are only watching `update of config`).
  update public.vautcher_restaurants
     set deploy_status = 'scaffolding'
   where id = new.id;

  perform net.http_post(
    url := 'https://yfyfoqrautdogivalimb.supabase.co/functions/v1/scaffold-tenant',
    headers := jsonb_build_object('X-Cron-Secret', v_secret, 'Content-Type', 'application/json'),
    body := jsonb_build_object('restaurant_id', new.id::text, 'rescaffold', true)
  );

  return new;
end;
$$;

drop trigger if exists vautcher_restaurants_source_url_changed on public.vautcher_restaurants;
create trigger vautcher_restaurants_source_url_changed
  after update of config on public.vautcher_restaurants
  for each row execute function public.vautcher_restaurants_source_url_changed();
