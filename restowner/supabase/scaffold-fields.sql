-- ============================================================
--  Per-restaurant deploy state for the scaffold-tenant pipeline.
--
--  Restowner's new "Nouveau restaurant à partir d'une URL" flow
--  inserts a row via the scaffold-tenant edge function, then
--  triggers a GitHub Actions workflow that builds + deploys the
--  diner app to <slug>.pages.dev. These columns let the UI poll
--  for the result.
--
--  deploy_status values:
--    null / 'idle' — never deployed (manual deploy still works)
--    'pending'     — workflow_dispatch fired, build in progress
--    'success'     — pages.dev is live
--    'failed'      — last attempt failed; see deploy_log_url
--
--  Re-runnable (idempotent).
-- ============================================================

alter table public.vautcher_restaurants
  add column if not exists deploy_status   text,
  add column if not exists deployed_at     timestamptz,
  add column if not exists deploy_log_url  text;

alter table public.vautcher_restaurants
  drop constraint if exists vautcher_restaurants_deploy_status_chk;
alter table public.vautcher_restaurants
  add constraint vautcher_restaurants_deploy_status_chk
  check (deploy_status is null
      or deploy_status in ('idle', 'pending', 'success', 'failed'));
