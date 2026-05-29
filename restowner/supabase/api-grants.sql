-- ============================================================
--  Data API grants — explicit GRANTs for tables reached directly
--  via supabase-js / PostgREST.
--
--  Why: Supabase is moving to NOT auto-expose new public-schema tables
--  to the Data API (default flips 2026-10-30; brand-new projects
--  already). Without an explicit GRANT a table is unreachable through
--  PostgREST/supabase-js even with RLS policies. GRANT controls
--  reachability; RLS still controls which rows. Both are required.
--
--  Scope: ONLY tables the apps hit directly with `.from(...)`. Tables
--  used solely through SECURITY DEFINER RPCs (vautcher_stamps,
--  vautcher_cards, vautcher_push_subscriptions, vautcher_profiles, …)
--  do NOT need grants — the definer runs as table owner.
--
--  When you add a NEW table that an app queries directly, add a line
--  here (least privilege: only the verbs the app actually uses).
--
--  Re-runnable and safe before a table exists (to_regclass guard).
-- ============================================================
do $$
begin
  -- restowner (authenticated) reads
  if to_regclass('public.vautcher_restaurants') is not null then
    grant select on public.vautcher_restaurants to authenticated;
  end if;
  if to_regclass('public.vautcher_owners') is not null then
    grant select on public.vautcher_owners to authenticated;
  end if;
  if to_regclass('public.vautcher_moderators') is not null then
    grant select on public.vautcher_moderators to authenticated;
  end if;

  -- restowner (authenticated) full management
  if to_regclass('public.vautcher_vouchers') is not null then
    grant select, insert, update on public.vautcher_vouchers to authenticated;
  end if;
  if to_regclass('public.vautcher_events') is not null then
    grant select, insert, update, delete on public.vautcher_events to authenticated;
  end if;

  -- diner app submits a reservation (no login → anon)
  if to_regclass('public.vautcher_reservations') is not null then
    grant insert on public.vautcher_reservations to anon, authenticated;
  end if;
end $$;
