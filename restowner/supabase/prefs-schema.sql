-- ============================================================
--  Owner UI preferences — language + text size
--
--  Stored on vautcher_owners so they follow the owner across
--  devices. Re-runnable (idempotent).
-- ============================================================

alter table public.vautcher_owners
  add column if not exists pref_lang       text,
  add column if not exists pref_font_scale numeric;

-- An owner may update their own row (used for the prefs above).
drop policy if exists "vautcher: owner updates self" on public.vautcher_owners;
create policy "vautcher: owner updates self"
  on public.vautcher_owners for update
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));
