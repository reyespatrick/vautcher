-- ============================================================
--  Multi-tenant: per-restaurant identity + content config
--
--  Adds a `config jsonb` column to vautcher_restaurants holding
--  everything that's currently hardcoded in the diner app's
--  src/data/site.js: brand tokens, hero copy, about, specialties,
--  gallery, hours, contact. The diner app reads its tenant's
--  config from this column at runtime and renders accordingly.
--
--  Also adds a 2-arg overload of vautcher_upcoming_events that
--  filters by restaurant_id, so a tenant's diner app only sees
--  its own events.
--
--  Re-runnable (idempotent).
-- ============================================================

alter table public.vautcher_restaurants
  add column if not exists config jsonb not null default '{}'::jsonb;

-- Seed La Gioconda's current site.js content into its config row.
-- Unconditional overwrite while we phase out the hardcoded copy —
-- restowner edits will eventually authoring this directly.
update public.vautcher_restaurants
   set config = '{
     "tagline": "Votre restaurant napolitain à Cointrin",
     "address": "Avenue Louis-Casaï 81, 1216 Cointrin",
     "phone": "+41 22 798 96 05",
     "phone_href": "tel:+41227989605",
     "email": "nicola.cassella@gmail.com",
     "maps_href": "https://www.google.com/maps/search/?api=1&query=Avenue+Louis-Casa%C3%AF+81+1216+Cointrin",
     "logo_url": "/assets/logo.jpg",
     "brand_primary": "#9e053d",
     "brand_dark": "#6f032b",
     "theme_color": "#9e053d",
     "pwa_name": "La Gioconda — Restaurant Pizzeria",
     "pwa_short_name": "La Gioconda",
     "pwa_description": "Restaurant napolitain à Cointrin, Genève.",
     "hours": [
       {"days": "Lundi – Dimanche", "service": "Midi", "time": "11h30 – 14h00"},
       {"days": "Lundi – Dimanche", "service": "Soir", "time": "18h30 – 23h30"}
     ],
     "reservation_slots": [
       "11:30", "12:00", "12:30", "13:00", "13:30",
       "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30"
     ],
     "hero": {
       "eyebrow": "Cointrin · Genève",
       "title": "Une part de Naples au cœur de Genève",
       "lead": "Votre restaurant napolitain à Cointrin — cuisine italienne authentique, pâtes fraîches et pizzas au feu de bois."
     },
     "about": {
       "kicker": "Notre Maison",
       "title": "Bienvenue à La Gioconda",
       "image_url": "/assets/photo1.jpg",
       "paragraphs": [
         "Située à Cointrin, notre maison représente une véritable part de Naples au sein de Genève. Dans un cadre chaleureux et lumineux, nous vous accueillons midi et soir, 7 jours sur 7.",
         "Produits frais, recettes traditionnelles et accueil familial : chaque assiette est préparée avec passion."
       ]
     },
     "specialties": [
       {"icon": "🧀", "title": "Risotto à la meule", "text": "Préparé et flambé en salle dans une meule de parmesan."},
       {"icon": "🍝", "title": "Pâtes fraîches", "text": "Préparées à la commande, dans la tradition artisanale."},
       {"icon": "🍷", "title": "Vins d''Italie", "text": "Une sélection pour accompagner et sublimer chaque plat."}
     ],
     "gallery": [
       {"src": "/assets/photo1.jpg", "caption": "La salle vitrée"},
       {"src": "/assets/photo2.jpg", "caption": "Le bar"},
       {"src": "/assets/photo3.jpg", "caption": "La terrasse"},
       {"src": "/assets/photo4.jpg", "caption": "Da Vinci, bar à vin"}
     ]
   }'::jsonb
 where id = '11111111-1111-1111-1111-111111111111';

-- Fetch one restaurant's full identity + config in a single call.
-- Anon-callable: the config is public-facing content for the diner app.
create or replace function public.vautcher_get_restaurant(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',     id,
    'name',   name,
    'slug',   slug,
    'config', config
  )
  from public.vautcher_restaurants
  where id = p_restaurant_id;
$$;
revoke all on function public.vautcher_get_restaurant(uuid) from public;
grant execute on function public.vautcher_get_restaurant(uuid) to anon, authenticated;

-- Multi-tenant overload of vautcher_upcoming_events: filters by
-- restaurant_id so each tenant's diner app sees only its own events.
-- The legacy 1-arg version remains for backward compat.
create or replace function public.vautcher_upcoming_events(
  p_profile_id    uuid,
  p_restaurant_id uuid
)
returns table (
  id uuid, title text, description text, event_date date, event_time text,
  location text, price text, image_url text, attendees bigint, joined boolean,
  rebate_value numeric, rebate_unit text, rebate_first_n int,
  max_participants int
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
         e.rebate_value, e.rebate_unit, e.rebate_first_n,
         e.max_participants
  from public.vautcher_events e
  where e.published = true
    and e.moderation_status = 'approved'
    and e.event_date >= current_date
    and e.restaurant_id = p_restaurant_id
  order by e.event_date asc, e.sort asc;
$$;
revoke all on function public.vautcher_upcoming_events(uuid, uuid) from public;
grant execute on function public.vautcher_upcoming_events(uuid, uuid) to anon, authenticated;
