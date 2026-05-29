-- ============================================================
--  Owner subscription billing (Stripe-direct)
--
--  One row per restaurant — the paying restaurateur subscribes through
--  Stripe Checkout and the stripe-webhook edge function keeps this row in
--  sync with the live Stripe subscription. Status drives access:
--
--    none        — never subscribed; restowner shows the upsell. While we
--                  are still rolling the billing out, this counts as
--                  "active" for the diner (lenient default).
--    trialing    — Stripe trial period.
--    active      — paid + in good standing.
--    past_due    — most recent invoice failed; grace_until counts down
--                  3 days; restowner becomes read-only.
--    suspended   — grace expired; the diner app shows a blocking
--                  "L'abonnement de <name> a été suspendu" dialog.
--    canceled    — owner stopped the subscription (or cancel_at_period_end
--                  finally landed). Same gating as suspended.
--
--  Writes are service-role only — the stripe-webhook is the single source
--  of truth. Re-runnable (idempotent).
-- ============================================================

create table if not exists public.vautcher_subscriptions (
  restaurant_id          uuid primary key references public.vautcher_restaurants(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  stripe_price_id        text,
  plan                   text,                 -- 'monthly' | 'yearly'
  status                 text not null default 'none',
  current_period_end     timestamptz,
  grace_until            timestamptz,          -- set when status flips to past_due
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists vautcher_subscriptions_status_idx
  on public.vautcher_subscriptions (status);
create index if not exists vautcher_subscriptions_grace_idx
  on public.vautcher_subscriptions (grace_until)
  where status = 'past_due';

alter table public.vautcher_subscriptions enable row level security;

-- An owner reads only their own restaurant's subscription. Locked /
-- not-yet-approved owners see nothing.
drop policy if exists "vautcher: owner reads own subscription" on public.vautcher_subscriptions;
create policy "vautcher: owner reads own subscription"
  on public.vautcher_subscriptions for select
  to authenticated
  using (restaurant_id in (
    select o.restaurant_id from public.vautcher_owners o
     where lower(o.email) = lower(auth.jwt() ->> 'email')
       and not coalesce(o.locked, false)
       and coalesce(o.approved, true)
  ));

-- Moderators read everything (Admin dashboard / support).
drop policy if exists "vautcher: moderator reads all subscriptions" on public.vautcher_subscriptions;
create policy "vautcher: moderator reads all subscriptions"
  on public.vautcher_subscriptions for select
  to authenticated
  using (public.vautcher_is_moderator());

-- ---------- Diner gate ----------
-- Is the restaurant currently in good standing? The diner reads this to
-- decide whether to show the "suspended" dialog.
--   active / trialing  → true
--   none               → true (lenient pre-launch; flip when we enforce)
--   past_due           → true UNTIL grace_until passes
--   suspended/canceled → false
create or replace function public.vautcher_restaurant_active(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        when s.status in ('active', 'trialing', 'none') then true
        when s.status = 'past_due'
             and (s.grace_until is null or s.grace_until > now()) then true
        else false
      end
      from public.vautcher_subscriptions s
      where s.restaurant_id = p_restaurant_id
    ),
    true  -- no subscription row yet → active (pre-launch grace)
  );
$$;
revoke all on function public.vautcher_restaurant_active(uuid) from public;
grant execute on function public.vautcher_restaurant_active(uuid) to anon, authenticated;

-- ---------- Grace-period worker ----------
-- A daily cron flips past_due rows whose 3-day grace has run out into
-- 'suspended'. Service-role only; wired up to pg_cron in a follow-up.
create or replace function public.vautcher_subscription_grace_expire()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.vautcher_subscriptions
     set status = 'suspended', updated_at = now()
   where status = 'past_due'
     and grace_until is not null
     and grace_until <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.vautcher_subscription_grace_expire() from public, anon, authenticated;
