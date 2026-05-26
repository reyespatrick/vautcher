-- ============================================================
--  vautcher_admin_delete_restaurant(p_restaurant_id, p_confirm_slug)
--
--  Hard delete a tenant. Requires:
--    * caller is a moderator
--    * confirm_slug matches the restaurant's actual slug (typed in)
--
--  Cleanup order (FKs don't all cascade):
--    1. vautcher_event_rsvps — references vautcher_events
--    2. vautcher_events       — direct FK to restaurant
--    3. vautcher_owners       — direct FK to restaurant (no cascade)
--    Then:
--    4. vautcher_vouchers     — ON DELETE CASCADE (auto), takes cards
--                                with it, which take stamps via card_id
--    5. vautcher_cards        — ON DELETE CASCADE (auto, paranoia)
--    6. vautcher_push_subscriptions — ON DELETE SET NULL (auto)
--    7. vautcher_restaurants  — the row itself
--
--  No DB-level cleanup of the Cloudflare Pages project — that's
--  handled by the delete-tenant.yml workflow dispatched alongside
--  this RPC by the edge function.
--
--  Re-runnable (idempotent).
-- ============================================================

create or replace function public.vautcher_admin_delete_restaurant(
  p_restaurant_id uuid,
  p_confirm_slug  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.vautcher_restaurants;
  v_events int;
  v_owners int;
  v_voch   int;
begin
  if not public.vautcher_is_moderator() then
    raise exception 'not authorized';
  end if;

  select * into v_row from public.vautcher_restaurants where id = p_restaurant_id;
  if v_row.id is null then
    raise exception 'restaurant not found';
  end if;
  if v_row.slug is null or v_row.slug <> p_confirm_slug then
    raise exception 'slug mismatch (expected % got %)', v_row.slug, p_confirm_slug;
  end if;
  -- Safety: the bespoke scaffold workflow patches this row's config
  -- ~3-5 min after insert. Deleting mid-flight makes the workflow
  -- fail at the patch step with a confusing "restaurant not found".
  -- Make the moderator wait for the transient state to clear.
  if v_row.deploy_status in ('scaffolding', 'pending') then
    raise exception 'cannot delete while deploy_status = % — wait for the build to finish', v_row.deploy_status;
  end if;

  -- Snapshot counts for the response so the UI can summarise.
  select count(*) into v_events from public.vautcher_events where restaurant_id = p_restaurant_id;
  select count(*) into v_owners from public.vautcher_owners where restaurant_id = p_restaurant_id;
  select count(*) into v_voch   from public.vautcher_vouchers where restaurant_id = p_restaurant_id;

  -- Manual cleanup for tables without ON DELETE CASCADE.
  delete from public.vautcher_event_rsvps
   where event_id in (select id from public.vautcher_events where restaurant_id = p_restaurant_id);
  delete from public.vautcher_events where restaurant_id = p_restaurant_id;
  delete from public.vautcher_owners where restaurant_id = p_restaurant_id;

  -- vautcher_vouchers / cards / push_subscriptions cascade automatically.
  delete from public.vautcher_restaurants where id = p_restaurant_id;

  return jsonb_build_object(
    'id', p_restaurant_id,
    'slug', v_row.slug,
    'name', v_row.name,
    'deleted', jsonb_build_object(
      'events',   v_events,
      'owners',   v_owners,
      'vouchers', v_voch
    )
  );
end;
$$;
revoke all on function public.vautcher_admin_delete_restaurant(uuid, text) from public, anon;
grant execute on function public.vautcher_admin_delete_restaurant(uuid, text) to authenticated;
