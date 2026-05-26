-- ============================================================
--  Scaffold tier tracking. The scaffold-tenant edge function
--  runs in escalating tiers — moderator promotes a tenant up
--  the ladder if a cheaper tier didn't extract enough.
--
--    T1 — structured-only (JSON-LD + OG + brand/CSS + gallery).
--         No AI call, no menu extraction. ~$0, ~10s.
--    T2 — T1 + a single Claude call against a structural-markdown
--         outline of every crawled page. Adds menu, hours, specs.
--    T3 — T2 + vision-mode (headless screenshot per menu page).
--         Built only if T2 isn't enough in practice.
--
--  Re-runnable (idempotent).
-- ============================================================

alter table public.vautcher_restaurants
  add column if not exists scaffold_tier        smallint not null default 1,
  add column if not exists scaffold_tokens_used integer  not null default 0;

alter table public.vautcher_restaurants
  drop constraint if exists vautcher_restaurants_scaffold_tier_chk;
alter table public.vautcher_restaurants
  add constraint vautcher_restaurants_scaffold_tier_chk
  check (scaffold_tier between 1 and 3);
