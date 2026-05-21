-- ============================================================
--  Apple Wallet loyalty pass — schema additions
--
--  Live-updating .pkpass. Two parts:
--   1. vautcher_pass_registrations — Apple's PassKit web service
--      stores one row per (device, pass) so we know which devices
--      to push to. Written/read only by the vautcher-pass edge fn.
--   2. A trigger on vautcher_stamps: when the restowner scanner adds
--      a stamp, fire an APNs push so the diner's pass refreshes.
--
--  Runs on the same project; objects stay `vautcher_` prefixed.
--  Re-runnable (idempotent).
-- ============================================================

-- pg_net lets the trigger make an outbound HTTP call to the edge fn.
create extension if not exists pg_net;

-- ---------- PASS DEVICE REGISTRATIONS ----------
-- One row per device that has added a given pass. `serial_number`
-- is the diner's vautcher_profiles.id (the pass serial == profile id).
create table if not exists public.vautcher_pass_registrations (
  device_library_id text        not null,
  serial_number     text        not null,   -- = vautcher_profiles.id
  pass_type_id      text        not null,
  push_token        text        not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (device_library_id, serial_number)
);

create index if not exists vautcher_pass_reg_serial_idx
  on public.vautcher_pass_registrations (serial_number);

alter table public.vautcher_pass_registrations enable row level security;
-- No public policies: the edge function reaches this table with the
-- service-role key, so anon/authenticated get no direct access.

-- ---------- STAMP -> PUSH TRIGGER ----------
-- After a stamp row is inserted, POST the changed serial to the edge
-- function's push route; it sends the APNs notification. The auth token
-- is read from Supabase Vault (set by deploy-pass.sh) so this file
-- carries no secret.
create or replace function public.vautcher_pass_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'vautcher_pass_push_key';

  -- Not configured yet (e.g. local/dev) — skip silently.
  if v_key is null then
    return new;
  end if;

  perform net.http_post(
    url     := 'https://yfyfoqrautdogivalimb.supabase.co/functions/v1/vautcher-pass/push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('serialNumber', new.profile_id::text)
  );
  return new;
exception when others then
  return new;  -- a push hiccup must never block the stamp write
end;
$$;

drop trigger if exists vautcher_stamps_push on public.vautcher_stamps;
create trigger vautcher_stamps_push
  after insert on public.vautcher_stamps
  for each row execute function public.vautcher_pass_notify();

-- ---------- ONE-TIME SETUP ----------
-- The trigger reads its auth token from Vault. deploy-pass.sh sets it:
--   select vault.create_secret('<service-role-key>', 'vautcher_pass_push_key');
