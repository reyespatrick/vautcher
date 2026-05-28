-- ============================================================
--  vautcher_event_push_now — "send the push now" from the editor
--
--  After saving an event the restowner editor shows a dialog with the
--  scheduled push timing and a "Envoyer maintenant" button. That button
--  calls this RPC, which:
--    1. authorises the caller (a moderator, or an unlocked owner of the
--       event's restaurant),
--    2. fires the event-notifier edge function (kind=announce → broadcast
--       to every subscriber of the restaurant) using the Vault cron
--       secret, so the secret never leaves the database, and
--    3. cancels any scheduled reminder (reminded_at) and marks
--       announced_at, so nothing double-fires later.
--
--  Re-runnable (idempotent).
-- ============================================================
create or replace function public.vautcher_event_push_now(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, net
as $fn$
declare
  v_email   text := lower(auth.jwt() ->> 'email');
  v_rest    uuid;
  v_secret  text;
  v_allowed boolean;
begin
  select restaurant_id into v_rest
    from public.vautcher_events where id = p_event_id;
  if v_rest is null then
    raise exception 'event not found';
  end if;

  -- Caller must be a moderator OR an unlocked owner of this restaurant.
  v_allowed := public.vautcher_is_moderator() or exists(
    select 1 from public.vautcher_owners
     where restaurant_id = v_rest and lower(email) = v_email and not locked);
  if not v_allowed then
    raise exception 'not authorized';
  end if;

  v_secret := public.vautcher_cron_secret();
  if v_secret is null or v_secret = '' then
    raise exception 'push not configured';
  end if;

  perform net.http_post(
    url := 'https://yfyfoqrautdogivalimb.supabase.co/functions/v1/event-notifier?kind=announce&event_id=' || p_event_id::text,
    headers := jsonb_build_object('X-Cron-Secret', v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );

  -- Cancel the scheduled reminder and mark announced so neither the
  -- reminder cron nor the announce trigger re-sends.
  update public.vautcher_events
     set reminded_at  = now(),
         announced_at = coalesce(announced_at, now())
   where id = p_event_id;
end;
$fn$;

revoke all on function public.vautcher_event_push_now(uuid) from public, anon;
grant execute on function public.vautcher_event_push_now(uuid) to authenticated;
