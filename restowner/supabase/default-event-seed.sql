-- ============================================================
--  Default starter event (fallback)
--
--  The PRIMARY default-event seed runs inside the scaffolder
--  (scripts/patch-restaurant-config.mjs) and pulls a real image from
--  the scaffolded gallery. This SQL is the fallback for restaurants
--  that exist without ever passing through the scaffolder (manual
--  inserts, dev fixtures), so the copy here is intentionally similar
--  to the JS templates so a salesperson never lands on the cheap
--  "Exemple --- modifiez..." text when demoing the diner.
--
--  Idempotent: only fills restaurants with zero events. moderation_status
--  is set by the BEFORE trigger (approved for tenants with a trusted
--  owner). Uses config.gallery[0].src for the image when the scaffolder
--  populated one; otherwise the event ships without an image.
-- ============================================================
insert into public.vautcher_events (restaurant_id, title, description, event_date, published, status, image_url)
select r.id,
       'Soirée découverte',
       'Notre chef vous propose une création originale autour des saveurs de la maison. Une soirée à partager — réservation conseillée.',
       current_date + 14,
       true,
       'active',
       nullif(r.config -> 'gallery' -> 0 ->> 'src', '')
from public.vautcher_restaurants r
where not exists (select 1 from public.vautcher_events e where e.restaurant_id = r.id);
