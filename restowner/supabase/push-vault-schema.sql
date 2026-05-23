-- ============================================================
--  Push pipeline — Vault-backed secret + pg_cron reminder
--
--  Replaces the original GUC-based plumbing:
--    - The Supabase-managed `postgres` role can no longer ALTER
--      DATABASE … SET app.cron_secret, so we read the cron secret
--      from Supabase Vault (vault.decrypted_secrets) instead.
--    - A helper RPC `vautcher_cron_secret()` returns that secret to
--      both the announce trigger and the daily reminder cron.
--    - pg_cron is enabled and a daily job calls the event-notifier
--      edge function with kind=remind.
--
--  Re-runnable (idempotent). Safe to apply repeatedly.
-- ============================================================

create extension if not exists supabase_vault;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- SECRET LOOKUP HELPER ----------
-- Reads the cron secret from Vault. Returns NULL if it isn't set yet
-- so callers can fail soft (the trigger already handles NULL).
create or replace function public.vautcher_cron_secret()
returns text
language sql
stable
security definer
set search_path = public, vault, extensions
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'vautcher_cron_secret'
  limit 1
$$;
revoke all on function public.vautcher_cron_secret() from public, anon, authenticated;

-- ---------- ANNOUNCE TRIGGER — Vault edition ----------
-- Same behaviour as the GUC version, but reads from Vault.
create or replace function public.vautcher_events_announce_trg()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  v_secret text;
begin
  if new.moderation_status is distinct from 'approved' then return new; end if;
  if new.announced_at is not null then return new; end if;
  if new.notify_days_before is distinct from 0 then return new; end if;
  if tg_op = 'UPDATE' and old.moderation_status = 'approved' then
    return new;
  end if;

  v_secret := public.vautcher_cron_secret();
  if v_secret is null or v_secret = '' then return new; end if;

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

-- ---------- DAILY REMINDER CRON ----------
-- Runs once a day at 09:00 UTC (11:00 Europe/Zurich in summer). The
-- edge function picks up every event whose event_date − N = today,
-- pushes the RSVPed profiles, and marks reminded_at.
do $$
declare
  v_secret text := public.vautcher_cron_secret();
begin
  if v_secret is null or v_secret = '' then
    raise notice 'cron secret not set — skipping pg_cron schedule';
    return;
  end if;

  -- Unschedule the prior job if it exists, so we can re-create with a
  -- fresh secret on every migration run.
  perform cron.unschedule(jobid)
  from cron.job where jobname = 'vautcher-daily-reminder';

  perform cron.schedule(
    'vautcher-daily-reminder',
    '0 9 * * *',
    format(
      $job$
      select net.http_post(
        url := 'https://yfyfoqrautdogivalimb.supabase.co/functions/v1/event-notifier?kind=remind',
        headers := jsonb_build_object('X-Cron-Secret', %L, 'Content-Type', 'application/json'),
        body := '{}'::jsonb
      );
      $job$,
      v_secret
    )
  );
end$$;
