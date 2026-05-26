-- ============================================================
--  Vautchers — owner-defined loyalty vouchers
--
--  An owner defines one or more "vautchers" (templates): a label,
--  a number of stamps to collect, and a reward text. Diners fill
--  a CARD per vautcher; when a card is full it auto-completes and
--  the next vautcher in sequence starts (the last one repeats).
--  A completed card is REDEEMED when the owner scans it — that is
--  the count of vautchers "actually used".
--
--    vautcher_vouchers : the owner's templates (one shared,
--                        ordered sequence per restaurant)
--    vautcher_cards    : a diner's instance of a vautcher
--    vautcher_stamps   : + card_id — each stamp attaches to a card
--
--  Phase 1 of the rollout: purely ADDITIVE. The old single-card
--  path (vautcher_config / vautcher_get_stamps) still works; the
--  scanner's vautcher_add_stamp keeps its old return shape.
--  Re-runnable (idempotent).
-- ============================================================

-- ---------- VAUTCHER TEMPLATES ----------
create table if not exists public.vautcher_vouchers (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.vautcher_restaurants(id) on delete cascade,
  label           text not null,
  stamps_required int  not null check (stamps_required between 1 and 100),
  reward_text     text not null,
  sequence        int  not null default 1,
  archived        boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists vautcher_vouchers_restaurant_idx
  on public.vautcher_vouchers (restaurant_id, sequence);

alter table public.vautcher_vouchers enable row level security;

-- Templates are not sensitive — anyone may read them.
drop policy if exists "vautcher: vouchers readable" on public.vautcher_vouchers;
create policy "vautcher: vouchers readable"
  on public.vautcher_vouchers for select
  to anon, authenticated
  using (true);

-- Only an owner of the restaurant may create / edit / delete its vautchers.
drop policy if exists "vautcher: owner writes vouchers" on public.vautcher_vouchers;
create policy "vautcher: owner writes vouchers"
  on public.vautcher_vouchers for all
  to authenticated
  using (restaurant_id in (
    select restaurant_id from public.vautcher_owners
    where lower(email) = lower(auth.jwt() ->> 'email')))
  with check (restaurant_id in (
    select restaurant_id from public.vautcher_owners
    where lower(email) = lower(auth.jwt() ->> 'email')));

-- ---------- VAUTCHER CARDS ----------
-- A diner's running instance of a vautcher.
--   active    : being collected
--   completed : full — reward unlocked, awaiting redemption
--   redeemed  : owner scanned the completed card; reward given
create table if not exists public.vautcher_cards (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.vautcher_profiles(id) on delete cascade,
  restaurant_id uuid not null references public.vautcher_restaurants(id) on delete cascade,
  voucher_id    uuid not null references public.vautcher_vouchers(id),
  card_no       int  not null default 1,
  status        text not null default 'active'
                 check (status in ('active', 'completed', 'redeemed')),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  redeemed_at   timestamptz
);

create index if not exists vautcher_cards_profile_idx
  on public.vautcher_cards (profile_id, restaurant_id, status);

alter table public.vautcher_cards enable row level security;
-- No table policies: cards are private. Diners read their own via
-- vautcher_get_voucher(); owners read aggregates via vautcher_voucher_stats().
-- Both are SECURITY DEFINER and bypass RLS.

-- ---------- STAMPS: attach to a card ----------
alter table public.vautcher_stamps
  add column if not exists card_id uuid references public.vautcher_cards(id) on delete set null;

create index if not exists vautcher_stamps_card_idx
  on public.vautcher_stamps (card_id);

-- ---------- HELPERS ----------
-- The restaurant the calling authenticated owner belongs to (or null).
create or replace function public.vautcher_owner_restaurant()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select restaurant_id from public.vautcher_owners
  where lower(email) = lower(auth.jwt() ->> 'email')
  limit 1;
$$;
grant execute on function public.vautcher_owner_restaurant() to authenticated;

-- ---------- REALTIME BROADCAST ----------
-- A diner's app subscribes to the public topic `vautcher:<profile_id>`
-- (the profile id is itself the bearer secret — same as the QR code) and
-- re-fetches its card whenever a stamp or card change is broadcast.
create or replace function public.vautcher_on_loyalty_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := coalesce(new.profile_id, old.profile_id);
begin
  -- A realtime hiccup must never abort the stamp / card write.
  begin
    perform realtime.send(
      jsonb_build_object('profile_id', v_profile),
      'voucher_changed',
      'vautcher:' || v_profile::text,
      false
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;

drop trigger if exists vautcher_stamps_loyalty_bcast on public.vautcher_stamps;
create trigger vautcher_stamps_loyalty_bcast
  after insert on public.vautcher_stamps
  for each row execute function public.vautcher_on_loyalty_change();

drop trigger if exists vautcher_cards_loyalty_bcast on public.vautcher_cards;
create trigger vautcher_cards_loyalty_bcast
  after insert or update on public.vautcher_cards
  for each row execute function public.vautcher_on_loyalty_change();

-- ---------- OWNER: add a stamp by scanning a diner QR ----------
-- Adds a stamp to the diner's active card, rolling to the next card
-- when one fills, and reports card progress + the redemption count
-- back to the scanner.
drop function if exists public.vautcher_add_stamp(uuid);
create function public.vautcher_add_stamp(p_profile_id uuid)
returns table (
  name              text,
  lifetime_visits   bigint,
  card_label        text,
  card_count        bigint,
  card_required     int,
  card_completed    boolean,
  vouchers_redeemed bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest    uuid;
  v_card    public.vautcher_cards;
  v_voucher public.vautcher_vouchers;
  v_count   bigint;
  v_next    uuid;
begin
  v_rest := public.vautcher_owner_restaurant();
  if v_rest is null then
    raise exception 'caller is not a restaurant owner';
  end if;
  if public.vautcher_profile_locked(p_profile_id) then
    raise exception 'this client is locked';
  end if;

  -- The diner's active card for this restaurant (most recent).
  select * into v_card from public.vautcher_cards
   where profile_id = p_profile_id and restaurant_id = v_rest and status = 'active'
   order by card_no desc
   limit 1;

  if v_card.id is null then
    -- No active card — open one from the first vautcher in the sequence.
    select * into v_voucher from public.vautcher_vouchers
     where restaurant_id = v_rest and not archived
     order by sequence asc, created_at asc
     limit 1;
    if v_voucher.id is null then
      raise exception 'no vautcher defined for this restaurant';
    end if;
    insert into public.vautcher_cards (profile_id, restaurant_id, voucher_id, card_no)
    values (
      p_profile_id, v_rest, v_voucher.id,
      coalesce((select max(card_no) from public.vautcher_cards
                 where profile_id = p_profile_id and restaurant_id = v_rest), 0) + 1)
    returning * into v_card;
  else
    select * into v_voucher from public.vautcher_vouchers where id = v_card.voucher_id;
  end if;

  insert into public.vautcher_stamps (profile_id, stamp_date, card_id)
  values (p_profile_id, current_date, v_card.id);

  select count(*) into v_count from public.vautcher_stamps where card_id = v_card.id;

  -- Card full → complete it and open the next one (last vautcher repeats).
  if v_count >= v_voucher.stamps_required then
    update public.vautcher_cards
       set status = 'completed', completed_at = now()
     where id = v_card.id;

    select id into v_next from public.vautcher_vouchers
     where restaurant_id = v_rest and not archived and sequence > v_voucher.sequence
     order by sequence asc, created_at asc
     limit 1;
    v_next := coalesce(v_next, v_voucher.id);

    insert into public.vautcher_cards (profile_id, restaurant_id, voucher_id, card_no)
    values (p_profile_id, v_rest, v_next, v_card.card_no + 1);
  end if;

  return query
    select p.name,
           (select count(*) from public.vautcher_stamps s where s.profile_id = p.id),
           v_voucher.label,
           v_count,
           v_voucher.stamps_required,
           (v_count >= v_voucher.stamps_required),
           (select count(*) from public.vautcher_cards c
             where c.restaurant_id = v_rest and c.status = 'redeemed')
    from public.vautcher_profiles p
    where p.id = p_profile_id;
end;
$$;

revoke all on function public.vautcher_add_stamp(uuid) from public;
grant execute on function public.vautcher_add_stamp(uuid) to authenticated;

-- ---------- OWNER: redeem a completed card by scanning it ----------
create or replace function public.vautcher_redeem_card(p_card_id uuid)
returns table (name text, reward_text text, vouchers_redeemed bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest uuid;
  v_card public.vautcher_cards;
begin
  v_rest := public.vautcher_owner_restaurant();
  if v_rest is null then
    raise exception 'caller is not a restaurant owner';
  end if;

  select * into v_card from public.vautcher_cards
   where id = p_card_id and restaurant_id = v_rest;
  if v_card.id is null then
    raise exception 'vautcher card not found';
  end if;
  if public.vautcher_profile_locked(v_card.profile_id) then
    raise exception 'this client is locked';
  end if;
  if v_card.status = 'redeemed' then
    raise exception 'this vautcher has already been redeemed';
  end if;
  if v_card.status <> 'completed' then
    raise exception 'this vautcher is not complete yet';
  end if;

  update public.vautcher_cards
     set status = 'redeemed', redeemed_at = now()
   where id = p_card_id;

  return query
    select p.name, d.reward_text,
           (select count(*) from public.vautcher_cards c
             where c.restaurant_id = v_rest and c.status = 'redeemed')
    from public.vautcher_profiles p
    join public.vautcher_vouchers d on d.id = v_card.voucher_id
    where p.id = v_card.profile_id;
end;
$$;

revoke all on function public.vautcher_redeem_card(uuid) from public;
grant execute on function public.vautcher_redeem_card(uuid) to authenticated;

-- ---------- DINER: read the loyalty state ----------
-- Returns the active card + any completed-not-yet-redeemed cards, the
-- two counters, and the first vautcher as a template (for diners with
-- no card yet). Redeemed cards are collapsed into `vouchers_redeemed`.
create or replace function public.vautcher_get_voucher(
  p_profile_id   uuid,
  p_restaurant_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'locked', public.vautcher_profile_locked(p_profile_id),
    'lifetime_visits', (
      select count(*) from public.vautcher_stamps s
      where s.profile_id = p_profile_id),
    'vouchers_redeemed', (
      select count(*) from public.vautcher_cards c
      where c.profile_id = p_profile_id
        and c.restaurant_id = p_restaurant_id
        and c.status = 'redeemed'),
    'template', (
      select jsonb_build_object(
        'label', d.label,
        'reward_text', d.reward_text,
        'stamps_required', d.stamps_required)
      from public.vautcher_vouchers d
      where d.restaurant_id = p_restaurant_id and not d.archived
      order by d.sequence asc, d.created_at asc
      limit 1),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'card_no', c.card_no,
        'status', c.status,
        'label', d.label,
        'reward_text', d.reward_text,
        'stamps_required', d.stamps_required,
        'stamps', coalesce((
          select jsonb_agg(s.stamp_date order by s.stamp_date, s.created_at)
          from public.vautcher_stamps s where s.card_id = c.id), '[]'::jsonb)
      ) order by c.card_no desc)
      from public.vautcher_cards c
      join public.vautcher_vouchers d on d.id = c.voucher_id
      where c.profile_id = p_profile_id
        and c.restaurant_id = p_restaurant_id
        and c.status in ('active', 'completed')
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.vautcher_get_voucher(uuid, uuid) from public;
grant execute on function public.vautcher_get_voucher(uuid, uuid) to anon, authenticated;

-- ---------- OWNER: vautcher statistics ----------
-- `completed` counts every card that reached full (redeemed ones were
-- completed too); `redeemed` is the headline "vautchers actually used".
create or replace function public.vautcher_voucher_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with r as (select public.vautcher_owner_restaurant() as rid)
  select jsonb_build_object(
    'completed', (
      select count(*) from public.vautcher_cards c, r
      where c.restaurant_id = r.rid and c.status in ('completed', 'redeemed')),
    'redeemed', (
      select count(*) from public.vautcher_cards c, r
      where c.restaurant_id = r.rid and c.status = 'redeemed'),
    'active_cards', (
      select count(*) from public.vautcher_cards c, r
      where c.restaurant_id = r.rid and c.status = 'active'),
    'stamps_total', (
      select count(*) from public.vautcher_stamps s
      join public.vautcher_cards c on c.id = s.card_id, r
      where c.restaurant_id = r.rid),
    'per_voucher', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'label', d.label,
        'stamps_required', d.stamps_required,
        'completed', (
          select count(*) from public.vautcher_cards c
          where c.voucher_id = d.id and c.status in ('completed', 'redeemed')),
        'redeemed', (
          select count(*) from public.vautcher_cards c
          where c.voucher_id = d.id and c.status = 'redeemed'))
        order by d.sequence asc, d.created_at asc)
      from public.vautcher_vouchers d, r
      where d.restaurant_id = r.rid and not d.archived
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.vautcher_voucher_stats() from public;
grant execute on function public.vautcher_voucher_stats() to authenticated;

-- ---------- ONE-TIME BACKFILL ----------
-- Give every restaurant a default vautcher (from the old global
-- vautcher_config) so scanning never fails for want of a template.
-- Idempotent: skipped once a restaurant already has one.
insert into public.vautcher_vouchers (restaurant_id, label, stamps_required, reward_text, sequence)
select r.id, 'Carte de fidélité',
       coalesce((select stamps_required from public.vautcher_config where id = 1), 10),
       coalesce((select reward from public.vautcher_config where id = 1), 'Une récompense offerte'),
       1
from public.vautcher_restaurants r
where not exists (
  select 1 from public.vautcher_vouchers v where v.restaurant_id = r.id);

-- Migrate existing loose stamps into cards. The diner app is single-
-- restaurant, so every pre-existing stamp belongs to La Gioconda.
-- Runs once: it is a no-op as soon as every stamp has a card_id.
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';  -- La Gioconda
  v_voucher uuid;
  v_req  int;
begin
  if not exists (select 1 from public.vautcher_stamps where card_id is null) then
    return;
  end if;

  select id, stamps_required into v_voucher, v_req
  from public.vautcher_vouchers
  where restaurant_id = v_rest
  order by sequence asc, created_at asc
  limit 1;
  if v_voucher is null then
    raise exception 'backfill: no vautcher for La Gioconda';
  end if;

  -- One card per chunk of v_req stamps, in chronological order.
  with ranked as (
    select id, profile_id,
           (row_number() over (partition by profile_id
                                order by stamp_date, created_at) - 1) / v_req as card_idx
    from public.vautcher_stamps
    where card_id is null
  ),
  chunk as (
    select profile_id, card_idx, count(*) as n
    from ranked group by profile_id, card_idx
  )
  insert into public.vautcher_cards
    (profile_id, restaurant_id, voucher_id, card_no, status, completed_at)
  select profile_id, v_rest, v_voucher, card_idx + 1,
         case when n >= v_req then 'completed' else 'active' end,
         case when n >= v_req then now() end
  from chunk;

  -- Attach each stamp to its chunk's card.
  with ranked as (
    select id, profile_id,
           (row_number() over (partition by profile_id
                                order by stamp_date, created_at) - 1) / v_req as card_idx
    from public.vautcher_stamps
    where card_id is null
  )
  update public.vautcher_stamps st
     set card_id = cd.id
  from ranked r
  join public.vautcher_cards cd
    on cd.profile_id = r.profile_id
   and cd.card_no = r.card_idx + 1
   and cd.restaurant_id = v_rest
  where st.id = r.id;
end $$;

-- Moderators acting on behalf of any tenant (admin / demo flows
-- where the row exists but no real owner has claimed it yet) get the
-- same CRUD as an owner. The owner policy above stays unchanged.
drop policy if exists "vautcher: moderator writes vouchers" on public.vautcher_vouchers;
create policy "vautcher: moderator writes vouchers"
  on public.vautcher_vouchers for all
  to authenticated
  using (public.vautcher_is_moderator())
  with check (public.vautcher_is_moderator());
