-- ============================================================
--  Scaffold-provisioned owners — claim-code + email rebind
--
--  When a restaurant is scaffolded from a URL we want an admin user
--  row created immediately, even before the real owner's email is
--  known. The row carries:
--    - email     = 'pending+<CODE>@<slug>.vautcher.local'
--    - claim_code = <6-char uppercase code>
--
--  Email stays the primary key (loads of code looks up owners by
--  email), so we use a unique placeholder until the moderator binds
--  the real address with vautcher_admin_set_owner_email().
--
--  Re-runnable (idempotent).
-- ============================================================

alter table public.vautcher_owners
  add column if not exists claim_code text unique;

-- ---------- Moderator: rebind a scaffold-provisioned owner row ----------
-- Updates the email PK. Since nothing FKs to vautcher_owners.email
-- this is a plain UPDATE on a unique key (Postgres will refuse if the
-- new email already exists in another row).
create or replace function public.vautcher_admin_set_owner_email(
  p_old_email text,
  p_new_email text
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
  if p_new_email is null or btrim(p_new_email) = '' then
    raise exception 'new email required';
  end if;
  update public.vautcher_owners
     set email = lower(btrim(p_new_email))
   where email = p_old_email;
end;
$$;
revoke all on function public.vautcher_admin_set_owner_email(text, text) from public, anon;
grant execute on function public.vautcher_admin_set_owner_email(text, text) to authenticated;
