#!/usr/bin/env node
// patch-restaurant-config.mjs — merge a bespoke-config JSON file into
// vautcher_restaurants.config (JSONB) for a given restaurant_id.
//
//   node patch-restaurant-config.mjs <restaurant_id> <bespoke-config.json>
//
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env. Used by the
// scaffold-tenant GitHub workflow after website-rewamp.mjs +
// extract-bespoke-config.mjs have produced the bespoke output.
//
// The script does a read-merge-write because Supabase REST doesn't
// expose a partial JSONB update in one call. We fetch the row's
// current config, merge in { home_html, home_css, google_fonts_url,
// theme, source_url, scaffolding:false }, then PATCH the whole config.

import { readFileSync } from 'fs'

const restaurantId = process.argv[2]
const bespokePath = process.argv[3]
if (!restaurantId || !bespokePath) {
  console.error('usage: node patch-restaurant-config.mjs <restaurant_id> <bespoke-config.json>')
  process.exit(1)
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars required')
  process.exit(1)
}

const bespoke = JSON.parse(readFileSync(bespokePath, 'utf8'))

const restEndpoint = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/vautcher_restaurants?id=eq.${encodeURIComponent(restaurantId)}`
const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
}

// 1. Fetch the current row.
const getRes = await fetch(`${restEndpoint}&select=id,name,slug,config`, { headers })
if (!getRes.ok) {
  console.error(`fetch restaurant ${restaurantId} → ${getRes.status} ${await getRes.text()}`)
  process.exit(1)
}
const rows = await getRes.json()
if (!rows.length) {
  console.error(`restaurant ${restaurantId} not found`)
  process.exit(1)
}
const row = rows[0]
const currentConfig = row.config || {}

// 2. Merge in bespoke fields. The bespoke generator produces:
//   home_html, home_css, google_fonts_url, theme
// Plus we lift a few diner-app config fields out of theme so the
// shared shell (header/footer/cards) themes correctly.
const merged = {
  ...currentConfig,
  scaffolding: false,
  home_html: bespoke.home_html,
  home_css: bespoke.home_css,
  google_fonts_url: bespoke.google_fonts_url || null,
  theme: bespoke.theme || null,
  // Source-site values that have to survive into the row so the diner
  // shell (AppHeader / About / Contact) doesn't fall back to the
  // bundled La Gioconda defaults.
  logo_url: bespoke.logo_url || currentConfig.logo_url || null,
  source_url: bespoke.source_url || currentConfig.source_url || null,
  // Picker gallery — only overwrite when the new bespoke pass produced
  // images, so a re-scaffold doesn't wipe a manually curated list.
  gallery: (bespoke.gallery && bespoke.gallery.length) ? bespoke.gallery : (currentConfig.gallery || []),
  // Flat fields the diner shell uses on shared pages (Contact,
  // Reservation, AppHeader/Footer). null-coalesced so a re-scaffold
  // doesn't clobber a value the moderator may have edited by hand.
  address: bespoke.address || currentConfig.address || null,
  phone: bespoke.phone || currentConfig.phone || null,
  phone_href: bespoke.phone_href || currentConfig.phone_href || null,
  email: bespoke.email || currentConfig.email || null,
  maps_href: bespoke.maps_href || currentConfig.maps_href || null,
  hours: (bespoke.hours && bespoke.hours.length) ? bespoke.hours : (currentConfig.hours || []),
  tagline: bespoke.tagline || currentConfig.tagline || null,
  // Backwards-compatibility — keep brand_primary / heading_font shape
  // that the diner expected from the old scaffolder so AppHeader etc.
  // can still pick them up if they don't read theme.* directly.
  brand_primary: bespoke.theme?.primary || currentConfig.brand_primary || null,
  brand_dark: bespoke.theme?.primary_dark || currentConfig.brand_dark || null,
  heading_font: bespoke.theme?.font_display || currentConfig.heading_font || null
}

// 3. PATCH the row.
const patchRes = await fetch(restEndpoint, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ config: merged })
})
if (!patchRes.ok) {
  console.error(`patch restaurant ${restaurantId} → ${patchRes.status} ${await patchRes.text()}`)
  process.exit(1)
}
const [updated] = await patchRes.json()
console.log(`✓ patched ${updated.slug} (${updated.id}) — home_html ${bespoke.home_html?.length || 0} chars, home_css ${bespoke.home_css?.length || 0} chars`)

// 4. Seed a default event with a real image + appetizing copy ONLY if
//    the restaurant has none. Without this the SQL fallback in
//    default-event-seed.sql kicks in on the next platform deploy with
//    no image and bland "Exemple --- modifiez..." text, which looks
//    cheap when the salesperson is demoing the deployed diner to a
//    prospective owner.
const eventsRes = await fetch(
  `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/vautcher_events?restaurant_id=eq.${encodeURIComponent(restaurantId)}&select=id&limit=1`,
  { headers }
)
const existingEvents = eventsRes.ok ? await eventsRes.json() : []
if (existingEvents.length === 0) {
  // Prefer the first half of the gallery -- the scaffolder ranks the
  // homepage hero / large gallery shots there; later items tend to be
  // small interior / team photos.
  const galleryUrls = (merged.gallery || []).map((g) => g && g.src).filter(Boolean)
  const front = galleryUrls.slice(0, Math.max(1, Math.ceil(galleryUrls.length / 2)))
  const imageUrl = front.length ? front[Math.floor(Math.random() * front.length)] : null

  // Five appetizing templates -- pick one at random so two adjacent
  // demo tenants don't show the exact same event copy.
  const DEMO_EVENTS = [
    {
      title: 'Soirée découverte',
      description: 'Notre chef vous propose une création originale autour des saveurs de la maison. Une soirée à partager — réservation conseillée.'
    },
    {
      title: 'Brunch du dimanche',
      description: 'Un brunch généreux dans une ambiance conviviale : viennoiseries fraîches, plats salés du jour et boissons chaudes à volonté.'
    },
    {
      title: 'Menu du marché',
      description: 'Chaque semaine, un menu unique composé à partir des produits frais du marché. Une cuisine de saison à redécouvrir à chaque visite.'
    },
    {
      title: 'Apéritif gourmand',
      description: 'Planches à partager, cocktails maison et bonne humeur — tous les jeudis dès 18h, dans une ambiance détendue.'
    },
    {
      title: 'Soirée à thème',
      description: 'Une fois par mois, nous mettons une région ou une saison à l’honneur : produits, plats et accords inattendus. Suivez-nous pour la prochaine.'
    }
  ]
  const demo = DEMO_EVENTS[Math.floor(Math.random() * DEMO_EVENTS.length)]
  // Two weeks out so the event is still upcoming when root drops in
  // for the demo (and the owner has time to edit it before then).
  const d = new Date()
  d.setDate(d.getDate() + 14)
  const dateStr = d.toISOString().slice(0, 10)

  const insertRes = await fetch(
    `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/vautcher_events`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        restaurant_id: restaurantId,
        title: demo.title,
        description: demo.description,
        event_date: dateStr,
        published: true,
        status: 'active',
        image_url: imageUrl
      })
    }
  )
  if (insertRes.ok) {
    console.log(`✓ seeded "${demo.title}"${imageUrl ? ' with gallery image' : ' (no gallery image available)'}`)
  } else {
    console.warn(`! seeding default event failed: ${insertRes.status} ${await insertRes.text()}`)
  }
} else {
  console.log('  default event seeding skipped (restaurant already has events)')
}
