-- ============================================================
--  Notify an owner by Web-Push when root approves their access
--
--  Pairs with owner-approval-schema.sql. A pending owner can subscribe
--  this device for push (vautcher_register_owner_push). When their row
--  flips approved false → true, a trigger pings the notify-owner-approved
--  edge function, which pushes every device registered for that e-mail.
--
--  Reuses the vautcher_admin_push table (push subscriptions keyed by
--  e-mail), so it MUST run after admin-push-schema.sql. Re-runnable.
-- ============================================================

-- A signed-in user (typically a pending owner) registers THIS device for
-- push. Unlike the admin variant this is NOT moderator-gated — the e-mail
-- is taken from the JWT, so a user can only ever register their own.
create or replace function public.vautcher_register_owner_push(
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
  if v_email is null or v_email = '' then
    raise exception 'not authenticated';
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
revoke all on function public.vautcher_register_owner_push(text, text, text, text) from public, anon;
grant execute on function public.vautcher_register_owner_push(text, text, text, text) to authenticated;

-- ---------- APPROVAL TRIGGER ----------
-- When an owner row goes approved false → true, ping notify-owner-approved
-- with the owner's e-mail (Vault cron secret, like the scaffold-done trigger).
create or replace function public.vautcher_owner_approved_trg()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  v_secret text;
begin
  if not (coalesce(new.approved, false) = true and coalesce(old.approved, false) = false) then
    return new;
  end if;
  v_secret := public.vautcher_cron_secret();
  if v_secret is null or v_secret = '' then return new; end if;
  perform net.http_post(
    url := 'https://yfyfoqrautdogivalimb.supabase.co/functions/v1/notify-owner-approved?email='
           || replace(new.email, '@', '%40'),
    headers := jsonb_build_object('X-Cron-Secret', v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  return new;
end;
$$;

drop trigger if exists vautcher_owner_approved on public.vautcher_owners;
create trigger vautcher_owner_approved
  after update of approved on public.vautcher_owners
  for each row execute function public.vautcher_owner_approved_trg();
