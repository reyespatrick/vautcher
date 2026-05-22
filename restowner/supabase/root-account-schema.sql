-- ============================================================
--  Dev "root" account
--
--  Creates the root@dpcsolutions.com auth user with a fixed dev
--  password so restowner's "root" login shortcut works without an
--  email OTP. root@dpcsolutions.com is already a moderator (seeded
--  by moderation-schema.sql), so this login lands straight in the
--  root tabs.
--
--  ⚠️ DEV BACKDOOR — hard-coded password. Before production: drop
--  this user, delete this file (+ its deploy.yml line) and remove
--  the "root" shortcut from restowner's LoginView.
--
--  Re-runnable (idempotent): seeds the user only if missing — it
--  never updates the password, so to change it, delete the user
--  and re-run.
-- ============================================================

do $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users
  where email = 'root@dpcsolutions.com';

  if v_uid is null then
    v_uid := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated',
      'root@dpcsolutions.com',
      extensions.crypt('vautcher-root-2026', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'root@dpcsolutions.com'),
      'email', v_uid::text, now(), now(), now()
    );
  end if;
end $$;
