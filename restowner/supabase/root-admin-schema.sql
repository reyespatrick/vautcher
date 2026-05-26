-- ============================================================
--  Root admin — owner trust, lockout, and admin functions
--
--  "root" = an email in vautcher_moderators. Root can:
--    - trust an owner so their events skip the approval queue
--    - lock an owner (access revoked) or a client (full block)
--    - list restaurants / owners / clients across the whole DB
--    - create restaurants (owners are created by the
--      provision-owner edge function)
--
--  Runs BEFORE voucher-schema.sql / event-capacity-schema.sql so
--  those can use vautcher_profile_locked(). Re-runnable (idempotent).
-- ============================================================

-- ---------- FLAGS ----------
alter table public.vautcher_owners
  add column if not exists trusted boolean not null default false,
  add column if not exists locked  boolean not null default false;

alter table public.vautcher_profiles
  add column if not exists locked boolean not null default false;

-- True if a diner profile is locked — used by the loyalty/event
-- functions to refuse a locked client.
create or replace function public.vautcher_profile_locked(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select locked from public.vautcher_profiles
                   where id = p_profile_id), false);
$$;
grant execute on function public.vautcher_profile_locked(uuid) to anon, authenticated;

-- ---------- EVENT MODERATION: trust trigger ----------
-- Forces moderation_status on every event insert/edit so it can't be
-- bypassed client-side. Rules:
--
--  1. A moderator's explicit approve/refuse from the moderation queue
--     (UPDATE that flips status to 'approved' or 'refused') is kept as-is.
--  2. Otherwise (INSERT or any other UPDATE) auto-approve when the
--     tenant has at least one trusted, unlocked owner; pending otherwise.
--
-- The previous version only checked the *caller's* trust flag. That
-- broke the common moderator-as-admin path: a moderator creating an
-- event on behalf of a trusted tenant left the event 'pending'
-- because the moderator's own email isn't in vautcher_owners with
-- trusted=true. Now the check is per-tenant, not per-caller.
create or replace function public.vautcher_events_set_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_any_trusted boolean;
  v_is_mod boolean := public.vautcher_is_moderator();
begin
  -- Moderator setting an explicit verdict via the approval queue.
  if v_is_mod and tg_op = 'UPDATE'
     and new.moderation_status in ('approved', 'refused')
     and old.moderation_status is distinct from new.moderation_status
  then
    return new;
  end if;

  -- Auto-approve when the tenant has any trusted unlocked owner.
  select exists(
    select 1 from public.vautcher_owners
     where restaurant_id = new.restaurant_id
       and trusted and not locked
  ) into v_any_trusted;
  new.moderation_status := case when v_any_trusted
                                then 'approved' else 'pending' end;
  if new.moderation_status <> 'refused' then
    new.refusal_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists vautcher_events_moderation_trg on public.vautcher_events;
create trigger vautcher_events_moderation_trg
  before insert or update on public.vautcher_events
  for each row execute function public.vautcher_events_set_moderation();

-- ---------- ROOT: read functions ----------
-- Every admin function is gated on vautcher_is_moderator().

create or replace function public.vautcher_admin_restaurants()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'slug', r.slug,
      'owners', coalesce((
        select jsonb_agg(jsonb_build_object(
          'email', o.email, 'name', o.name,
          'trusted', o.trusted, 'locked', o.locked) order by o.email)
        from public.vautcher_owners o where o.restaurant_id = r.id
      ), '[]'::jsonb)
    ) order by r.name)
    from public.vautcher_restaurants r
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.vautcher_admin_restaurants() to authenticated;

create or replace function public.vautcher_admin_clients()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'birth_date', p.birth_date,
      'locked', p.locked,
      'stamps', (select count(*) from public.vautcher_stamps s
                 where s.profile_id = p.id)
    ) order by p.name)
    from public.vautcher_profiles p
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.vautcher_admin_clients() to authenticated;

-- ---------- ROOT: mutations ----------
create or replace function public.vautcher_admin_create_restaurant(
  p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;
  insert into public.vautcher_restaurants (name, slug)
  values (p_name, p_slug)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.vautcher_admin_create_restaurant(text, text) to authenticated;

create or replace function public.vautcher_admin_set_owner_flags(
  p_email text, p_trusted boolean, p_locked boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;
  update public.vautcher_owners
     set trusted = p_trusted, locked = p_locked
   where lower(email) = lower(p_email);
end;
$$;
grant execute on function public.vautcher_admin_set_owner_flags(text, boolean, boolean) to authenticated;

create or replace function public.vautcher_admin_set_client_locked(
  p_profile_id uuid, p_locked boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;
  update public.vautcher_profiles set locked = p_locked
   where id = p_profile_id;
end;
$$;
grant execute on function public.vautcher_admin_set_client_locked(uuid, boolean) to authenticated;
