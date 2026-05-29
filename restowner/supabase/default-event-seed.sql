-- ============================================================
--  Default starter event
--
--  Give every restaurant one placeholder event if it has none, so a
--  freshly scaffolded restaurant shows a starter the owner can edit or
--  delete (mirrors the default loyalty card backfill).
--
--  Idempotent: only fills restaurants with zero events. moderation_status
--  is set by the BEFORE trigger (approved for tenants with a trusted owner).
-- ============================================================
insert into public.vautcher_events (restaurant_id, title, description, event_date, published, status)
select r.id,
       'Votre premier événement',
       'Exemple — modifiez ou supprimez cet événement depuis la console restowner.',
       current_date + 14,
       true,
       'active'
from public.vautcher_restaurants r
where not exists (select 1 from public.vautcher_events e where e.restaurant_id = r.id);
