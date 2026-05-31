-- ============================================================
--  vautcher_subscriptions — per-restaurant billing state.
--
--  One row per restaurant. Created at scaffold time with
--  status = 'trialing' and trial_end = now() + 14 days. Stripe
--  webhook fills stripe_customer_id, stripe_subscription_id,
--  current_period_end and status afterwards.
--
--  Status values
--    trialing   — free trial period, no card on file yet
--    active     — paid, in good standing
--    past_due   — payment failed, Stripe retrying
--    suspended  — Stripe gave up (or admin paused) → diner takeover
--    cancelled  — owner cancelled → diner takeover
--
--  "Billing blocked" (treat the tenant as suspended) is true when:
--    - status in ('past_due','suspended','cancelled'), OR
--    - status = 'trialing' AND trial_end < now()  (trial expired)
--
--  Re-runnable. Safe to apply multiple times.
-- ============================================================

-- ---------- TABLE ----------
create table if not exists public.vautcher_subscriptions (
  restaurant_id            uuid primary key
                            references public.vautcher_restaurants(id)
                            on delete cascade,
  stripe_customer_id       text unique,
  stripe_subscription_id   text unique,
  status                   text not null default 'trialing'
                            check (status in (
                              'trialing','active','past_due','suspended','cancelled'
                            )),
  trial_end                timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  -- Last Stripe event we processed (for idempotency + audit).
  last_stripe_event_id     text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists vautcher_subscriptions_status_idx
  on public.vautcher_subscriptions (status);

-- Touch updated_at on any change.
create or replace function public.vautcher_subscriptions_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists vautcher_subscriptions_touch_trg
  on public.vautcher_subscriptions;
create trigger vautcher_subscriptions_touch_trg
  before update on public.vautcher_subscriptions
  for each row execute function public.vautcher_subscriptions_touch();

-- ---------- RLS ----------
-- Default: deny. We expose data through SECURITY DEFINER RPCs only,
-- never raw table reads from anon or end-user JWTs. The webhook (and
-- any other internal job) uses the service role key, which bypasses
-- RLS, so it can write freely without a policy.
alter table public.vautcher_subscriptions enable row level security;

drop policy if exists "vautcher: subs read own" on public.vautcher_subscriptions;
create policy "vautcher: subs read own"
  on public.vautcher_subscriptions for select
  to authenticated
  using (
    restaurant_id = public.vautcher_owner_restaurant()
    or public.vautcher_is_moderator()
  );

-- No insert / update / delete policy: only the service role writes
-- (webhook, scaffold-tenant). That bypasses RLS by design.

-- ---------- TRIGGER: auto-create a trialing subscription for new tenants ----------
-- Any future code path that inserts into vautcher_restaurants (scaffold
-- queue, manual root admin add, recovery script, ...) will get a
-- subscription row for free. No need to patch every caller.
create or replace function public.vautcher_subscriptions_on_restaurant_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vautcher_subscriptions (
    restaurant_id, status, trial_end
  ) values (
    new.id, 'trialing', now() + interval '14 days'
  )
  on conflict (restaurant_id) do nothing;
  return new;
end;
$$;

drop trigger if exists vautcher_subscriptions_seed_trg
  on public.vautcher_restaurants;
create trigger vautcher_subscriptions_seed_trg
  after insert on public.vautcher_restaurants
  for each row execute function public.vautcher_subscriptions_on_restaurant_insert();

-- ---------- HELPER: backfill missing rows for existing tenants ----------
-- Every tenant must have a subscription row -- the takeover check on
-- the diner side reads this. New tenants get one created by the scaffold
-- edge function; this backfill covers tenants that pre-date this
-- migration.
insert into public.vautcher_subscriptions (restaurant_id, status, trial_end)
select r.id, 'trialing', now() + interval '14 days'
from public.vautcher_restaurants r
where not exists (
  select 1 from public.vautcher_subscriptions s where s.restaurant_id = r.id
);

-- ---------- HELPER: is a tenant blocked from operating? ----------
-- The single source of truth for "should we render the suspended state".
-- Used by the diner takeover, the restowner read-only gating, and any
-- future server-side check (e.g. blocking new event inserts).
create or replace function public.vautcher_subscription_is_blocked(
  p_restaurant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.status in ('past_due','suspended','cancelled') then true
    when s.status = 'trialing'
         and (s.trial_end is null or s.trial_end < now())
      then true
    else false
  end
  from public.vautcher_subscriptions s
  where s.restaurant_id = p_restaurant_id;
$$;
revoke all on function public.vautcher_subscription_is_blocked(uuid) from public;
grant execute on function public.vautcher_subscription_is_blocked(uuid)
  to anon, authenticated, service_role;

-- ---------- RPC: subscription as the calling owner sees it ----------
-- Returns the owner's own subscription row. Used by restowner
-- AbonnementView to render the status badge + "S'abonner" or
-- "Gérer mon abonnement" buttons.
create or replace function public.vautcher_my_subscription()
returns table (
  restaurant_id          uuid,
  status                 text,
  trial_end              timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean,
  has_stripe_customer    boolean,
  is_blocked             boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select public.vautcher_owner_restaurant() as r_id
  )
  select
    s.restaurant_id,
    s.status,
    s.trial_end,
    s.current_period_end,
    s.cancel_at_period_end,
    s.stripe_customer_id is not null as has_stripe_customer,
    public.vautcher_subscription_is_blocked(s.restaurant_id) as is_blocked
  from public.vautcher_subscriptions s
  join me on me.r_id = s.restaurant_id;
$$;
revoke all on function public.vautcher_my_subscription() from public, anon;
grant execute on function public.vautcher_my_subscription() to authenticated;

-- ---------- RPC: public billing state (anon, for the diner takeover) ----------
-- The diner app is unauthenticated. It reads tenant config and then
-- needs to know whether to render the SuspendedView. We expose only
-- the fields the takeover screen needs -- no Stripe IDs, no trial_end
-- dates -- so a leaked status is informational, nothing more.
create or replace function public.vautcher_public_billing_state(
  p_restaurant_id uuid
)
returns table (
  status      text,
  is_blocked  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select s.status, public.vautcher_subscription_is_blocked(p_restaurant_id)
  from public.vautcher_subscriptions s
  where s.restaurant_id = p_restaurant_id;
$$;
revoke all on function public.vautcher_public_billing_state(uuid) from public;
grant execute on function public.vautcher_public_billing_state(uuid)
  to anon, authenticated, service_role;
