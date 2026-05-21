-- ============================================================
--  La Gioconda (vautcher app) — Supabase schema
--
--  IMPORTANT: this runs on a SHARED Supabase project that also
--  hosts the "restaurants" platform. To avoid colliding with its
--  tables, every object here is prefixed `vautcher_`. Keep it.
--
--  The MENU is intentionally NOT stored here — it lives in the
--  app (src/data/menu.js). Only profiles and reservations persist.
--
--  Run in the Supabase dashboard: SQL Editor → New query → Run
--  Re-runnable (idempotent).
-- ============================================================

-- ---------- VISITOR PROFILES ----------
-- Name + birth date captured by the first-launch dialog.
-- `id` is generated client-side so the app can re-save its own row.
create table if not exists public.vautcher_profiles (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  name        text not null,
  birth_date  date not null
);

alter table public.vautcher_profiles enable row level security;

-- No direct table policies: a SELECT policy would expose every visitor's
-- name + birth date (PII), and an UPDATE needs to read the row (its WHERE
-- clause), which a SELECT policy would also gate. Instead, all writes go
-- through the SECURITY DEFINER function below — anon can save its own
-- profile by id, but cannot read or tamper with the table directly.
drop policy if exists "vautcher: public can create profile" on public.vautcher_profiles;
drop policy if exists "vautcher: public can update profile" on public.vautcher_profiles;

-- Insert-or-update a profile by id. Runs as definer, so it is not blocked
-- by RLS; callers can only reach the table through this narrow entry point.
create or replace function public.vautcher_save_profile(
  p_id         uuid,
  p_name       text,
  p_birth_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vautcher_profiles (id, name, birth_date)
  values (p_id, p_name, p_birth_date)
  on conflict (id) do update
    set name       = excluded.name,
        birth_date = excluded.birth_date,
        updated_at = now();
end;
$$;

revoke all on function public.vautcher_save_profile(uuid, text, date) from public;
grant execute on function public.vautcher_save_profile(uuid, text, date) to anon, authenticated;


-- ---------- RESERVATIONS ----------
create table if not exists public.vautcher_reservations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  res_date    date not null,
  res_time    text not null,
  guests      int  not null check (guests between 1 and 20),
  name        text not null,
  phone       text not null,
  notes       text,
  status      text not null default 'pending'
              check (status in ('pending', 'confirmed', 'cancelled'))
);

alter table public.vautcher_reservations enable row level security;

-- Anyone may create a reservation (a plain insert needs no row read).
-- Reading them back is staff-only (Supabase dashboard / future admin role).
drop policy if exists "vautcher: public can create reservations" on public.vautcher_reservations;
create policy "vautcher: public can create reservations"
  on public.vautcher_reservations for insert
  to anon, authenticated
  with check (true);


-- ---------- LOYALTY CONFIG ----------
-- Single config row, maintained by the SEPARATE owner/restaurant app.
-- This app only reads it. `stamps_required` = stamps needed for the reward.
create table if not exists public.vautcher_config (
  id              int  primary key default 1 check (id = 1),
  stamps_required int  not null default 10 check (stamps_required between 1 and 100),
  reward          text not null default 'Une récompense offerte',
  updated_at      timestamptz not null default now()
);

alter table public.vautcher_config enable row level security;

-- Config is not sensitive — anyone may read it.
drop policy if exists "vautcher: config is public" on public.vautcher_config;
create policy "vautcher: config is public"
  on public.vautcher_config for select
  to anon, authenticated
  using (true);

-- Seed the singleton row if it does not exist yet.
insert into public.vautcher_config (id, stamps_required, reward)
values (1, 10, 'Un dessert maison offert')
on conflict (id) do nothing;


-- ---------- LOYALTY STAMPS ----------
-- One row per visit/order. Created by the SEPARATE owner/restaurant app.
create table if not exists public.vautcher_stamps (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.vautcher_profiles(id) on delete cascade,
  stamp_date  date not null default current_date,
  created_at  timestamptz not null default now()
);

create index if not exists vautcher_stamps_profile_idx
  on public.vautcher_stamps (profile_id);

alter table public.vautcher_stamps enable row level security;
-- No public table policies: a diner reads only their own stamps, via the
-- SECURITY DEFINER function below (so no one can list everyone's history).

create or replace function public.vautcher_get_stamps(p_profile_id uuid)
returns table (stamp_date date)
language sql
security definer
set search_path = public
as $$
  select stamp_date
  from public.vautcher_stamps
  where profile_id = p_profile_id
  order by stamp_date asc, created_at asc;
$$;

revoke all on function public.vautcher_get_stamps(uuid) from public;
grant execute on function public.vautcher_get_stamps(uuid) to anon, authenticated;


-- ---------- EVENTS ----------
-- Restaurant events / special evenings. Created by the SEPARATE owner app.
-- This app shows only published, today-or-future events.
create table if not exists public.vautcher_events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  title       text not null,
  description text not null default '',
  event_date  date not null,
  event_time  text,
  location    text,
  price       text,
  image_url   text,
  published   boolean not null default true,
  sort        int not null default 0
);

alter table public.vautcher_events enable row level security;

drop policy if exists "vautcher: events are public" on public.vautcher_events;
create policy "vautcher: events are public"
  on public.vautcher_events for select
  to anon, authenticated
  using (published = true);


-- ---------- EVENT RSVPs ----------
-- One row = one visitor signalling they will join an event.
create table if not exists public.vautcher_event_rsvps (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.vautcher_events(id) on delete cascade,
  profile_id  uuid not null references public.vautcher_profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (event_id, profile_id)
);

alter table public.vautcher_event_rsvps enable row level security;
-- No public table policies: all RSVP access is through the functions below,
-- so no visitor can list who else is attending.

-- Today-or-future published events, enriched with the attendee count and
-- whether THIS visitor has joined. Definer, so it can read the rsvp table.
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
  select e.id, e.title, e.description, e.event_date, e.event_time,
         e.location, e.price, e.image_url,
         (select count(*) from public.vautcher_event_rsvps r where r.event_id = e.id),
         exists (select 1 from public.vautcher_event_rsvps r
                 where r.event_id = e.id and r.profile_id = p_profile_id)
  from public.vautcher_events e
  where e.published = true
    and e.event_date >= current_date
  order by e.event_date asc, e.sort asc;
$$;

revoke all on function public.vautcher_upcoming_events(uuid) from public;
grant execute on function public.vautcher_upcoming_events(uuid) to anon, authenticated;

-- Join an event (idempotent).
create or replace function public.vautcher_join_event(p_event_id uuid, p_profile_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.vautcher_event_rsvps (event_id, profile_id)
  values (p_event_id, p_profile_id)
  on conflict (event_id, profile_id) do nothing;
$$;

revoke all on function public.vautcher_join_event(uuid, uuid) from public;
grant execute on function public.vautcher_join_event(uuid, uuid) to anon, authenticated;

-- Cancel a join.
create or replace function public.vautcher_leave_event(p_event_id uuid, p_profile_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.vautcher_event_rsvps
  where event_id = p_event_id and profile_id = p_profile_id;
$$;

revoke all on function public.vautcher_leave_event(uuid, uuid) from public;
grant execute on function public.vautcher_leave_event(uuid, uuid) to anon, authenticated;

-- Seed demo events the first time only (when the table is still empty).
insert into public.vautcher_events (title, description, event_date, event_time, location, price, image_url, sort)
select v.title, v.description, v.event_date::date, v.event_time, v.location, v.price, v.image_url, v.sort
from (values
  ('Aperitivo Italiano',
   'Chaque vendredi soir, un apéritif à l''italienne : planches de charcuteries et fromages, spritz maison et ambiance napolitaine au bar. L''occasion idéale de commencer la soirée en douceur.',
   '2026-05-30', '18h30', 'Le Bar', 'Entrée libre', '/assets/photo2.jpg', 1),
  ('Soirée Pizza au feu de bois',
   'Notre pizzaïolo revisite les grands classiques napolitains le temps d''une soirée : pâte maturée 48 heures, mozzarella di bufala et produits du marché. Menu pizza + dessert inclus.',
   '2026-06-13', '19h00', 'Salle principale', '45 CHF / personne', '/assets/photo1.jpg', 2),
  ('Fête de la Musique',
   'Musique live sur la terrasse pour célébrer l''arrivée de l''été, accompagnée d''un menu spécial et d''une sélection de vins d''Italie. Places limitées.',
   '2026-06-21', '19h30', 'La Terrasse', 'Entrée libre', '/assets/photo3.jpg', 3),
  ('Dégustation de vins italiens',
   'Une soirée au Bar à Vin Da Vinci pour découvrir notre sélection de vins italiens, guidée par notre sommelier et accompagnée d''assiettes gourmandes.',
   '2026-06-27', '18h30', 'Bar à Vin Da Vinci', '38 CHF / personne', '/assets/photo4.jpg', 4)
) as v(title, description, event_date, event_time, location, price, image_url, sort)
where not exists (select 1 from public.vautcher_events);


-- ---------- CLEANUP ----------
-- The menu is no longer kept in the database.
drop table if exists public.vautcher_menu_items;
