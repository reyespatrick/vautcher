-- ============================================================
--  Web-Push subscriptions + event notification metadata
--
--  Each diner-device push subscription is stored here once the
--  diner grants notification permission. The event-notifier edge
--  function reads these to send Web-Push payloads:
--    - "announce" pushes go to every subscription of a restaurant
--      shortly after one of its events is approved (when announce_now)
--    - "remind" pushes go to every subscription of the restaurant,
--      fired daily via pg_cron when event_date − notify_days_before
--      = today (broadcast, not RSVP-only)
--
--  Re-runnable (idempotent).
-- ============================================================

create table if not exists public.vautcher_push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.vautcher_profiles(id) on delete cascade,
  restaurant_id uuid references public.vautcher_restaurants(id) on delete set null,
  endpoint      text unique not null,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index if not exists vautcher_push_sub_profile_idx
  on public.vautcher_push_subscriptions (profile_id);
create index if not exists vautcher_push_sub_restaurant_idx
  on public.vautcher_push_subscriptions (restaurant_id);

alter table public.vautcher_push_subscriptions enable row level security;
-- No public policies: subscriptions are read only by the edge function
-- (service-role bypasses RLS). Writes go through the SECURITY DEFINER
-- RPCs below; the profile_id is the bearer secret (same trust model as
-- vautcher-stamp QR codes / the rest of the diner app).

-- ---------- TRACKING SENDS ----------
-- Per-kind columns so an event can be announced AND later reminded
-- without one blocking the other.
alter table public.vautcher_events
  add column if not exists announced_at timestamptz,
  add column if not exists reminded_at  timestamptz,
  -- Announce ("Nouvel événement") and the N-days-before reminder are now
  -- INDEPENDENT. announce_now drives the on-approval broadcast; the
  -- reminder is driven solely by notify_days_before >= 1. The old
  -- convention (notify_days_before = 0 meaning "announce now") is gone.
  add column if not exists announce_now boolean not null default false;

-- ---------- RPCs ----------
-- Diner calls this after a successful pushManager.subscribe(). Upsert
-- on endpoint so re-subscribes on the same device replace the row.
create or replace function public.vautcher_register_push(
  p_profile_id    uuid,
  p_restaurant_id uuid,
  p_endpoint      text,
  p_p256dh        text,
  p_auth          text,
  p_user_agent    text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.vautcher_push_subscriptions
    (profile_id, restaurant_id, endpoint, p256dh, auth, user_agent)
  values
    (p_profile_id, p_restaurant_id, p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update set
    profile_id    = excluded.profile_id,
    restaurant_id = excluded.restaurant_id,
    p256dh        = excluded.p256dh,
    auth          = excluded.auth,
    user_agent    = excluded.user_agent;
$$;
revoke all on function public.vautcher_register_push(uuid, uuid, text, text, text, text) from public;
grant execute on function public.vautcher_register_push(uuid, uuid, text, text, text, text) to anon, authenticated;

-- Diner calls this when the browser tells it the subscription is gone
-- (or the edge function cleans up 410/404 responses via service role).
create or replace function public.vautcher_unregister_push(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.vautcher_push_subscriptions where endpoint = p_endpoint;
$$;
grant execute on function public.vautcher_unregister_push(text) to anon, authenticated;

-- ---------- NOTIFIER HELPERS ----------
-- Events scheduled to be REMINDED today: notify_days_before is set,
-- event_date − notify_days_before = today, and we haven't reminded yet.
-- Reminder is ONLY for notify_days_before >= 1. The 0 case
-- ("notify now") is handled by the announce trigger on save.
create or replace function public.vautcher_events_due_for_reminder()
returns table (
  id uuid, restaurant_id uuid, title text, event_date date,
  event_time text, notify_days_before int
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.restaurant_id, e.title, e.event_date, e.event_time, e.notify_days_before
  from public.vautcher_events e
  where e.published = true
    and e.moderation_status = 'approved'
    and e.status = 'active'
    and e.notify_days_before is not null
    and e.notify_days_before >= 1
    and e.reminded_at is null
    and e.event_date = current_date + (e.notify_days_before * interval '1 day');
$$;
revoke all on function public.vautcher_events_due_for_reminder() from public, anon, authenticated;

-- ---------- AUTO-ANNOUNCE TRIGGER ----------
-- When an event transitions to moderation_status='approved' (either on
-- insert or on update), call the event-notifier edge function with
-- kind=announce. The CRON_SECRET is read from a Postgres GUC
-- (`app.cron_secret`) so it never lives in code; if the GUC isn't set
-- yet, the trigger is a no-op rather than a failure.
create or replace function public.vautcher_events_announce_trg()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  v_secret text;
begin
  -- Only fire on the transition INTO approved, and only when the owner
  -- ticked "announce now". The reminder (notify_days_before >= 1) is a
  -- separate path (daily cron) and the two are independent/combinable.
  -- The legacy notify_days_before = 0 is still honoured for safety during
  -- the deploy gap before the editor starts writing announce_now.
  if new.moderation_status is distinct from 'approved' then return new; end if;
  if new.announced_at is not null then return new; end if;
  if not (coalesce(new.announce_now, false) or new.notify_days_before = 0) then return new; end if;
  if tg_op = 'UPDATE' and old.moderation_status = 'approved' then
    return new;
  end if;

  v_secret := nullif(current_setting('app.cron_secret', true), '');
  if v_secret is null then
    -- Not configured yet. Don't block the event save.
    return new;
  end if;

  perform net.http_post(
    url := 'https://yfyfoqrautdogivalimb.supabase.co/functions/v1/event-notifier?kind=announce&event_id=' || new.id::text,
    headers := jsonb_build_object('X-Cron-Secret', v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  return new;
end;
$$;

drop trigger if exists vautcher_events_announce on public.vautcher_events;
create trigger vautcher_events_announce
  after insert or update of moderation_status on public.vautcher_events
  for each row execute function public.vautcher_events_announce_trg();
