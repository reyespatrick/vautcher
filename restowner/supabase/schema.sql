-- ============================================================
--  restowner — restaurant-owner console schema additions
--
--  Runs on the SAME shared Supabase project. All objects stay
--  `vautcher_` prefixed. Re-runnable (idempotent).
--  Run in the Supabase dashboard: SQL Editor → New query → Run.
-- ============================================================

-- ---------- RESTAURANTS ----------
create table if not exists public.vautcher_restaurants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique not null,
  created_at timestamptz not null default now()
);

alter table public.vautcher_restaurants enable row level security;

drop policy if exists "vautcher: restaurants readable" on public.vautcher_restaurants;
create policy "vautcher: restaurants readable"
  on public.vautcher_restaurants for select
  to anon, authenticated
  using (true);

insert into public.vautcher_restaurants (id, name, slug) values
  ('11111111-1111-1111-1111-111111111111', 'La Gioconda', 'la-gioconda'),
  ('22222222-2222-2222-2222-222222222222', 'Trattoria Bella Vista', 'bella-vista')
on conflict (id) do nothing;


-- ---------- OWNERS ----------
-- Maps an owner's email to the restaurant they manage. Pre-seeded;
-- a person becomes an owner only if their email is listed here.
create table if not exists public.vautcher_owners (
  email         text primary key,
  restaurant_id uuid not null references public.vautcher_restaurants(id),
  name          text,
  created_at    timestamptz not null default now()
);

alter table public.vautcher_owners enable row level security;

-- A logged-in user may read only their own owner row.
drop policy if exists "vautcher: owner reads self" on public.vautcher_owners;
create policy "vautcher: owner reads self"
  on public.vautcher_owners for select
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

insert into public.vautcher_owners (email, restaurant_id, name) values
  ('preyes@dpcsolutions.com', '11111111-1111-1111-1111-111111111111', 'Propriétaire La Gioconda')
on conflict (email) do nothing;


-- ---------- EVENTS: owner-console columns ----------
alter table public.vautcher_events
  add column if not exists restaurant_id      uuid references public.vautcher_restaurants(id),
  add column if not exists age_min            int,
  add column if not exists age_max            int,
  add column if not exists status             text not null default 'active',
  add column if not exists notify_days_before int;

-- Existing events belong to La Gioconda.
update public.vautcher_events
  set restaurant_id = '11111111-1111-1111-1111-111111111111'
  where restaurant_id is null;

alter table public.vautcher_events drop constraint if exists vautcher_events_status_chk;
alter table public.vautcher_events add constraint vautcher_events_status_chk
  check (status in ('active', 'cancelled'));

-- Owners get full CRUD over their own restaurant's events.
drop policy if exists "vautcher: owner manages events" on public.vautcher_events;
create policy "vautcher: owner manages events"
  on public.vautcher_events for all
  to authenticated
  using (restaurant_id in (
    select restaurant_id from public.vautcher_owners
    where lower(email) = lower(auth.jwt() ->> 'email')))
  with check (restaurant_id in (
    select restaurant_id from public.vautcher_owners
    where lower(email) = lower(auth.jwt() ->> 'email')));


-- ---------- Diner feed: respect status + age targeting ----------
-- Same return signature as before; body now filters cancelled events
-- and events outside the visitor's age range.
create or replace function public.vautcher_upcoming_events(p_profile_id uuid)
returns table (
  id uuid, title text, description text, event_date date, event_time text,
  location text, price text, image_url text, attendees bigint, joined boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select date_part('year', age(birth_date))::int as age
    from public.vautcher_profiles where id = p_profile_id
  )
  select e.id, e.title, e.description, e.event_date, e.event_time,
         e.location, e.price, e.image_url,
         (select count(*) from public.vautcher_event_rsvps r where r.event_id = e.id),
         exists (select 1 from public.vautcher_event_rsvps r
                 where r.event_id = e.id and r.profile_id = p_profile_id)
  from public.vautcher_events e
  left join v on true
  where e.published = true
    and e.status = 'active'
    and e.event_date >= current_date
    and (e.age_min is null or (v.age is not null and v.age >= e.age_min))
    and (e.age_max is null or (v.age is not null and v.age <= e.age_max))
  order by e.event_date asc, e.sort asc;
$$;


-- ---------- Loyalty: owner adds a stamp by scanning a QR ----------
create or replace function public.vautcher_add_stamp(p_profile_id uuid)
returns table (name text, stamps bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vautcher_stamps (profile_id, stamp_date)
  values (p_profile_id, current_date);
  return query
    select p.name,
           (select count(*) from public.vautcher_stamps s where s.profile_id = p.id)
    from public.vautcher_profiles p
    where p.id = p_profile_id;
end;
$$;

revoke all on function public.vautcher_add_stamp(uuid) from public;
grant execute on function public.vautcher_add_stamp(uuid) to authenticated;
