-- ============================================================
--  Admin/moderator Web-Push subscriptions + scaffold-done notifier
--
--  Lets a moderator (root) receive a push on their restowner device when
--  a site they scaffolded finishes building. Separate from the diner
--  vautcher_push_subscriptions table (those are keyed by profile_id;
--  admins have an email, not a diner profile).
--
--  Re-runnable (idempotent).
-- ============================================================

create table if not exists public.vautcher_admin_push (
  endpoint    text primary key,
  email       text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists vautcher_admin_push_email_idx
  on public.vautcher_admin_push (lower(email));

alter table public.vautcher_admin_push enable row level security;
-- No public policies: writes go through the SECURITY DEFINER RPC below;
-- reads are service-role only (the notify-scaffold edge function).

-- A signed-in moderator registers THIS device's subscription. The email is
-- taken from the JWT (not trusted from the client).
create or replace function public.vautcher_register_admin_push(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;
  insert into public.vautcher_admin_push (endpoint, email, p256dh, auth, user_agent)
  values (p_endpoint, v_email, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update set
    email      = excluded.email,
    p256dh     = excluded.p256dh,
    auth       = excluded.auth,
    user_agent = excluded.user_agent;
end;
$$;
revoke all on function public.vautcher_register_admin_push(text, text, text, text) from public, anon;
grant execute on function public.vautcher_register_admin_push(text, text, text, text) to authenticated;

-- ---------- SCAFFOLD-DONE TRIGGER ----------
-- When a row goes scaffolding → success, ping the notify-scaffold edge
-- function (Vault secret, like the announce trigger). Only that exact
-- transition fires it, so ordinary redeploys don't notify.
create or replace function public.vautcher_scaffold_done_trg()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  v_secret text;
begin
  if not (new.deploy_status = 'success' and old.deploy_status = 'scaffolding') then
    return new;
  end if;
  v_secret := public.vautcher_cron_secret();
  if v_secret is null or v_secret = '' then return new; end if;
  perform net.http_post(
    url := 'https://yfyfoqrautdogivalimb.supabase.co/functions/v1/notify-scaffold?restaurant_id=' || new.id::text,
    headers := jsonb_build_object('X-Cron-Secret', v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  return new;
end;
$$;

drop trigger if exists vautcher_scaffold_done on public.vautcher_restaurants;
create trigger vautcher_scaffold_done
  after update of deploy_status on public.vautcher_restaurants
  for each row execute function public.vautcher_scaffold_done_trg();
