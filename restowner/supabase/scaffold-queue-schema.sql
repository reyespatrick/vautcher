-- ============================================================
--  vautcher_scaffold_queue — serial scaffold queue
--
--  Root discovers nearby restaurants on /admin/discover (Overpass +
--  DuckDuckGo) and enqueues a batch. A pg_cron tick calls the
--  scaffold-queue-advance edge function once a minute, which:
--    1. Rolls in-flight rows forward by inspecting the linked
--       vautcher_restaurants.deploy_status.
--    2. If nothing is scaffolding, claims the oldest pending row and
--       hands it to the scaffold-tenant edge function.
--
--  Strict serial: only one row is in "scaffolding" at a time. Per the
--  product decision, batches drain unattended so root can come back to
--  a queue of ready tenants.
--
--  Re-runnable.
-- ============================================================

create extension if not exists pg_net;

-- ---------- TABLE ----------
create table if not exists public.vautcher_scaffold_queue (
  id            uuid primary key default gen_random_uuid(),
  osm_id        text,                                       -- nullable; for de-dup if root enqueues the same OSM node twice
  name          text not null,
  address       text,
  phone         text,
  website_url   text not null,                              -- the URL handed to scaffold-tenant
  lat           double precision,
  lng           double precision,
  status        text not null default 'pending'
                  check (status in ('pending','scaffolding','done','failed')),
  restaurant_id uuid references public.vautcher_restaurants(id) on delete set null,
  enqueued_by   text,                                       -- email (root)
  enqueued_at   timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  error         text
);

create index if not exists vautcher_scaffold_queue_status_idx
  on public.vautcher_scaffold_queue (status, enqueued_at);

create index if not exists vautcher_scaffold_queue_restaurant_idx
  on public.vautcher_scaffold_queue (restaurant_id);

-- ---------- RLS ----------
alter table public.vautcher_scaffold_queue enable row level security;

-- Root only. Mirrors the Admin tab gate in useAuth.isRoot.
drop policy if exists "vautcher: root reads queue" on public.vautcher_scaffold_queue;
create policy "vautcher: root reads queue"
  on public.vautcher_scaffold_queue for select
  to authenticated
  using (lower(auth.jwt() ->> 'email') = 'root@dpcsolutions.com');

drop policy if exists "vautcher: root writes queue" on public.vautcher_scaffold_queue;
create policy "vautcher: root writes queue"
  on public.vautcher_scaffold_queue for all
  to authenticated
  using (lower(auth.jwt() ->> 'email') = 'root@dpcsolutions.com')
  with check (lower(auth.jwt() ->> 'email') = 'root@dpcsolutions.com');

grant select, insert, update, delete on public.vautcher_scaffold_queue to authenticated;

-- ---------- TRIGGER: roll the queue forward on deploy_status change ----------
-- When the diner deploy completes (success / scaffold_failed / failed),
-- flip the matching queue row to done / failed. The cron tick will then
-- claim the next pending row on its next pass.
create or replace function public.vautcher_scaffold_queue_on_deploy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deploy_status is distinct from old.deploy_status
     and new.deploy_status in ('success', 'failed', 'scaffold_failed') then
    update public.vautcher_scaffold_queue
       set status      = case when new.deploy_status = 'success' then 'done' else 'failed' end,
           finished_at = now(),
           error       = case when new.deploy_status = 'success' then null
                              else coalesce((new.config ->> 'deploy_error'), new.deploy_status) end
     where restaurant_id = new.id
       and status = 'scaffolding';
  end if;
  return new;
end;
$$;

drop trigger if exists vautcher_scaffold_queue_deploy on public.vautcher_restaurants;
create trigger vautcher_scaffold_queue_deploy
  after update of deploy_status on public.vautcher_restaurants
  for each row execute function public.vautcher_scaffold_queue_on_deploy();

-- ---------- CRON TICK ----------
-- Calls scaffold-queue-advance once a minute. The function is a no-op
-- if a row is already scaffolding, so it's safe to fire blindly.
do $$
declare
  v_secret text := public.vautcher_cron_secret();
begin
  if v_secret is null or v_secret = '' then
    raise notice 'cron secret not set — skipping scaffold-queue cron';
    return;
  end if;

  perform cron.unschedule(jobid)
  from cron.job where jobname = 'vautcher-scaffold-queue-advance';

  perform cron.schedule(
    'vautcher-scaffold-queue-advance',
    '* * * * *',
    format(
      $job$
      select net.http_post(
        url := 'https://yfyfoqrautdogivalimb.supabase.co/functions/v1/scaffold-queue-advance',
        headers := jsonb_build_object('X-Cron-Secret', %L, 'Content-Type', 'application/json'),
        body := '{}'::jsonb
      );
      $job$,
      v_secret
    )
  );
end$$;
