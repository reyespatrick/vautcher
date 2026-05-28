-- ============================================================
--  Durable owner claim codes
--
--  A moderator generates a permanent access code for a restaurant. The
--  code is handed to the restaurateur, who activates their account on
--  the public /activer page by entering their e-mail + the code. Unlike
--  a magic link, the code does NOT expire — it stays valid until used.
--
--  The activation itself (validate code, bind the real e-mail, mint a
--  session) is done by the `claim-owner` edge function with the service
--  role, so no anon-exposed rebind RPC is needed.
--
--  Re-runnable (idempotent). Relies on vautcher_owners.claim_code from
--  scaffold-owner.sql.
-- ============================================================

create or replace function public.vautcher_admin_create_owner_code(
  p_restaurant_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_slug text;
  v_placeholder text;
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;

  select slug into v_slug from public.vautcher_restaurants where id = p_restaurant_id;
  if v_slug is null then
    raise exception 'restaurant introuvable';
  end if;

  -- 8-char code (hex, uppercased) — unique across all owners.
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from public.vautcher_owners where claim_code = v_code);
  end loop;

  -- Placeholder e-mail keeps the (email) primary key unique until the
  -- restaurateur binds their real address via the claim-owner function.
  v_placeholder := 'pending+' || lower(v_code) || '@' || v_slug || '.vautcher.local';

  insert into public.vautcher_owners (email, restaurant_id, name, claim_code, trusted, locked)
  values (v_placeholder, p_restaurant_id, nullif(btrim(p_name), ''), v_code, false, false);

  return jsonb_build_object('code', v_code, 'restaurant_id', p_restaurant_id);
end;
$$;
revoke all on function public.vautcher_admin_create_owner_code(uuid, text) from public, anon;
grant execute on function public.vautcher_admin_create_owner_code(uuid, text) to authenticated;

-- Root: (re)issue an access code for an existing owner — e.g. the code was
-- lost, or you want to let them re-activate (with the same or a new e-mail).
-- The old code stops working; the new one is returned to hand over.
create or replace function public.vautcher_admin_regenerate_owner_code(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_found boolean;
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;
  select true into v_found from public.vautcher_owners
   where email = lower(btrim(p_email)) limit 1;
  if not found then
    raise exception 'owner introuvable';
  end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from public.vautcher_owners where claim_code = v_code);
  end loop;
  update public.vautcher_owners
     set claim_code = v_code
   where email = lower(btrim(p_email));
  return jsonb_build_object('code', v_code);
end;
$$;
revoke all on function public.vautcher_admin_regenerate_owner_code(text) from public, anon;
grant execute on function public.vautcher_admin_regenerate_owner_code(text) to authenticated;
