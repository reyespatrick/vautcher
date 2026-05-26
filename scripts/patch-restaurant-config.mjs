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
