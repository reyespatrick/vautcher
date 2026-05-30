-- ============================================================
--  vautcher_my_restaurants() — restaurants the caller can choose
--
--  Powers the global restaurant scope picker in the restowner
--  header. Moderators see every restaurant on the platform; plain
--  owners see only the restaurants they actually own (in case an
--  owner gets attached to more than one some day).
--
--  Re-runnable (idempotent).
-- ============================================================

-- Drop the prior signature so we can add the pages_url column without
-- a "cannot change return type" error.
drop function if exists public.vautcher_my_restaurants();

create or replace function public.vautcher_my_restaurants()
returns table(id uuid, name text, slug text, pages_url text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
begin
  if public.vautcher_is_moderator() then
    return query
      select r.id, r.name, r.slug, r.config->>'pages_url'
        from public.vautcher_restaurants r
       order by r.name;
  else
    return query
      select distinct r.id, r.name, r.slug, r.config->>'pages_url'
        from public.vautcher_restaurants r
        join public.vautcher_owners o on o.restaurant_id = r.id
       where lower(o.email) = v_email
         and not o.locked
       order by r.name;
  end if;
end;
$$;
revoke all on function public.vautcher_my_restaurants() from public, anon;
grant execute on function public.vautcher_my_restaurants() to authenticated;
