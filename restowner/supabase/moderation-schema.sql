-- ============================================================
--  Event moderation
--
--  Owner-created events are reviewed by a root moderator before
--  they reach diners.
--    moderation_status : 'pending' | 'approved' | 'refused'
--    refusal_reason    : text shown to the owner when refused
--  vautcher_moderators lists the root email(s).
--
--  NOTE: deploying this alone makes every existing event 'pending'
--  (it disappears from the diner app until a moderator approves it)
--  — apply it together with the restowner approval UI.
--  Re-runnable (idempotent).
-- ============================================================

-- ---------- MODERATORS ----------
create table if not exists public.vautcher_moderators (
  email      text primary key,
  created_at timestamptz not null default now()
);

alter table public.vautcher_moderators enable row level security;

-- A logged-in user may check whether they themselves are a moderator.
drop policy if exists "vautcher: moderator reads self" on public.vautcher_moderators;
create policy "vautcher: moderator reads self"
  on public.vautcher_moderators for select
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- Seed the root moderator.
insert into public.vautcher_moderators (email) values
  ('preyes@dpcsolutions.com')
on conflict (email) do nothing;

-- Definer helper — true if the caller is a moderator (bypasses RLS).
create or replace function public.vautcher_is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.vautcher_moderators
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;
grant execute on function public.vautcher_is_moderator() to authenticated;

-- ---------- EVENT MODERATION COLUMNS ----------
alter table public.vautcher_events
  add column if not exists moderation_status text not null default 'pending',
  add column if not exists refusal_reason    text,
  add column if not exists submitted_at      timestamptz not null default now();

alter table public.vautcher_events
  drop constraint if exists vautcher_events_moderation_chk;
alter table public.vautcher_events
  add constraint vautcher_events_moderation_chk
  check (moderation_status in ('pending', 'approved', 'refused'));

-- ---------- MODERATOR RLS ON EVENTS ----------
-- A moderator may read every event (to staff the approval queue)...
drop policy if exists "vautcher: moderator reads all events" on public.vautcher_events;
create policy "vautcher: moderator reads all events"
  on public.vautcher_events for select
  to authenticated
  using (public.vautcher_is_moderator());

-- ...and update them (approve / refuse).
drop policy if exists "vautcher: moderator updates events" on public.vautcher_events;
create policy "vautcher: moderator updates events"
  on public.vautcher_events for update
  to authenticated
  using (public.vautcher_is_moderator())
  with check (public.vautcher_is_moderator());

-- ---------- DINER APP: approved events only ----------
-- Recreate vautcher_upcoming_events so diners see only approved events.
drop function if exists public.vautcher_upcoming_events(uuid);
create function public.vautcher_upcoming_events(p_profile_id uuid)
returns table (
  id uuid, title text, description text, event_date date, event_time text,
  location text, price text, image_url text, attendees bigint, joined boolean,
  rebate_value numeric, rebate_unit text, rebate_first_n int
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
                 where r.event_id = e.id and r.profile_id = p_profile_id),
         e.rebate_value, e.rebate_unit, e.rebate_first_n
  from public.vautcher_events e
  where e.published = true
    and e.moderation_status = 'approved'
    and e.event_date >= current_date
  order by e.event_date asc, e.sort asc;
$$;

revoke all on function public.vautcher_upcoming_events(uuid) from public;
grant execute on function public.vautcher_upcoming_events(uuid) to anon, authenticated;
