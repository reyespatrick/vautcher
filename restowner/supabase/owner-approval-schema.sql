-- ============================================================
--  Owner self-service signup + root approval
--
--  A walk-up restaurateur signs into restowner with their real e-mail
--  (normal Supabase OTP — a code IS mailed). Once the code verifies they
--  have a session but are not yet an owner. They tap "Demander un accès",
--  which creates a PENDING owner row (approved=false, no restaurant). Root
--  sees it under "En attente" in the Admin tab, picks the restaurant and
--  approves — so root never has to create owner rows, only approve them.
--
--  Existing owners default to approved=true so nobody is locked out, and
--  restaurant_id becomes nullable so a pending row can exist before root
--  assigns a restaurant.
--
--  Re-runnable (idempotent). Depends on vautcher_is_moderator()
--  (moderation-schema.sql) and the trusted/locked columns.
-- ============================================================

alter table public.vautcher_owners
  add column if not exists approved boolean not null default true;

-- Pending owners have no restaurant yet — root assigns one on approval.
alter table public.vautcher_owners
  alter column restaurant_id drop not null;

-- ---------- Owner: request access for my own verified e-mail ----------
-- Creates a pending row if none exists for the caller. Idempotent —
-- re-requesting just reports the current status.
create or replace function public.vautcher_request_owner_access()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_row   public.vautcher_owners%rowtype;
begin
  v_email := lower(btrim(auth.jwt() ->> 'email'));
  if v_email is null or v_email = '' then
    raise exception 'not authenticated';
  end if;

  -- Moderators already have access; no owner row needed.
  if exists (select 1 from public.vautcher_moderators where lower(email) = v_email) then
    return jsonb_build_object('status', 'moderator');
  end if;

  select * into v_row from public.vautcher_owners where email = v_email;
  if found then
    return jsonb_build_object('status', case when v_row.approved then 'approved' else 'pending' end);
  end if;

  insert into public.vautcher_owners (email, restaurant_id, name, approved, trusted, locked)
  values (v_email, null, null, false, false, false);
  return jsonb_build_object('status', 'pending');
end;
$$;
revoke all on function public.vautcher_request_owner_access() from public, anon;
grant execute on function public.vautcher_request_owner_access() to authenticated;

-- ---------- Root: list owners awaiting approval ----------
create or replace function public.vautcher_admin_pending_owners()
returns table (email text, name text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;
  return query
    select o.email, o.name, o.created_at
      from public.vautcher_owners o
     where o.approved = false
     order by o.created_at desc;
end;
$$;
revoke all on function public.vautcher_admin_pending_owners() from public, anon;
grant execute on function public.vautcher_admin_pending_owners() to authenticated;

-- ---------- Root: approve a pending owner, assigning their restaurant ----------
create or replace function public.vautcher_admin_approve_owner(
  p_email text,
  p_restaurant_id uuid,
  p_trusted boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;
  if p_restaurant_id is null then
    raise exception 'restaurant requis';
  end if;
  if not exists (select 1 from public.vautcher_restaurants where id = p_restaurant_id) then
    raise exception 'restaurant introuvable';
  end if;
  update public.vautcher_owners
     set approved = true,
         restaurant_id = p_restaurant_id,
         trusted = coalesce(p_trusted, false)
   where lower(email) = lower(btrim(p_email))
     and approved = false;
  if not found then
    raise exception 'demande introuvable';
  end if;
end;
$$;
revoke all on function public.vautcher_admin_approve_owner(text, uuid, boolean) from public, anon;
grant execute on function public.vautcher_admin_approve_owner(text, uuid, boolean) to authenticated;

-- ---------- Root: reject (delete) a pending owner request ----------
create or replace function public.vautcher_admin_reject_owner(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;
  delete from public.vautcher_owners
   where lower(email) = lower(btrim(p_email))
     and approved = false;
end;
$$;
revoke all on function public.vautcher_admin_reject_owner(text) from public, anon;
grant execute on function public.vautcher_admin_reject_owner(text) to authenticated;
