-- ============================================================
--  Combinable notifications: announce_now + reminder are independent
--
--  Before: a single `notify_days_before` field was overloaded —
--    0    = "announce now to all subscribers on approval"
--    N>=1 = "remind N days before" (to RSVPed profiles)
--    null = nothing
--  so an event could be announced OR reminded, never both.
--
--  After: a dedicated boolean `announce_now` drives the on-approval
--  broadcast; `notify_days_before` (>=1) drives the reminder. Both can
--  be set at once. The reminder is also now a broadcast to every
--  subscriber of the restaurant (Option A) — see the event-notifier
--  edge function, doRemind().
--
--  Re-runnable (idempotent). Apply once to the live DB, then deploy the
--  edge function (event-notifier) and the restowner UI.
-- ============================================================

-- 1) New flag.
alter table public.vautcher_events
  add column if not exists announce_now boolean not null default false;

-- 2) One-time data migration: the old "0 = announce now" rows become
--    announce_now = true with no reminder.
update public.vautcher_events
   set announce_now = true, notify_days_before = null
 where notify_days_before = 0;

-- 3) Announce trigger fires on announce_now (legacy 0 kept as a fallback
--    for the gap before the new editor ships). Vault-secret edition.
create or replace function public.vautcher_events_announce_trg()
returns trigger language plpgsql security definer
set search_path = public, extensions, net as $fn$
declare
  v_secret text;
begin
  if new.moderation_status is distinct from 'approved' then return new; end if;
  if new.announced_at is not null then return new; end if;
  if not (coalesce(new.announce_now, false) or new.notify_days_before = 0) then return new; end if;
  if tg_op = 'UPDATE' and old.moderation_status = 'approved' then return new; end if;

  v_secret := public.vautcher_cron_secret();
  if v_secret is null or v_secret = '' then return new; end if;

  perform net.http_post(
    url := 'https://yfyfoqrautdogivalimb.supabase.co/functions/v1/event-notifier?kind=announce&event_id=' || new.id::text,
    headers := jsonb_build_object('X-Cron-Secret', v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  return new;
end;
$fn$;

drop trigger if exists vautcher_events_announce on public.vautcher_events;
create trigger vautcher_events_announce
  after insert or update of moderation_status on public.vautcher_events
  for each row execute function public.vautcher_events_announce_trg();
