<script setup>
// /admin/discover — geo-discover nearby restaurants via OpenStreetMap
// (Overpass), auto-find their websites via the osm-website-search edge
// function for the ones OSM doesn't already have, let root multi-select
// the ones to scaffold, then push the batch into vautcher_scaffold_queue.
// The queue drains serially in the background (pg_cron → scaffold-queue-
// advance), so root can fire-and-forget a batch and come back later.
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { supabase } from '../lib/supabase'
import { useAuth } from '../composables/useAuth'
import { useDialog } from '../composables/useDialog'

const { t } = useI18n()
const { session } = useAuth()
const { alert } = useDialog()

const lat = ref(null)
const lng = ref(null)
const accuracy = ref(null)
const locationLabel = ref('')      // human-readable summary of the picked spot
const radius = ref(500)            // metres, default per product decision
const geoBusy = ref(false)
const geoError = ref('')

// Address-based location alternative for when root is planning the
// next demo from a desk instead of standing on the street corner.
const addressInput = ref('')
const addressBusy = ref(false)

const searchBusy = ref(false)
const searchError = ref('')
const candidates = ref([])         // [{ osm_id, name, address, phone, website, locality, lat, lng, selected, websiteBusy }]

const enqueueBusy = ref(false)

function formatAddr(tags) {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
  const city = [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' ')
  return [street, city].filter(Boolean).join(', ')
}

// Cheap country-code guess from the user's current location. Good
// enough as a TLD hint for the verifier — when the row itself carries
// addr:country we prefer that. Bounding boxes are loose; misses are
// harmless (the verifier just won't get the TLD bias).
function inferCountry(lat, lng) {
  if (lat == null || lng == null) return ''
  if (lat >= 45.8 && lat <= 47.85 && lng >= 5.95 && lng <= 10.55) return 'CH'
  if (lat >= 47.25 && lat <= 55.1 && lng >= 5.85 && lng <= 15.05) return 'DE'
  if (lat >= 36.5 && lat <= 47.1 && lng >= 6.6  && lng <= 18.55) return 'IT'
  if (lat >= 41.3 && lat <= 51.1 && lng >= -5   && lng <= 9.6)   return 'FR'
  if (lat >= 46.4 && lat <= 49.1 && lng >= 9.5  && lng <= 17.2)  return 'AT'
  if (lat >= 49.5 && lat <= 51.5 && lng >= 2.5  && lng <= 6.4)   return 'BE'
  return ''
}

async function getLocation() {
  if (!navigator.geolocation) {
    geoError.value = t('discover.noGeo')
    return
  }
  geoBusy.value = true
  geoError.value = ''
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lat.value = pos.coords.latitude
      lng.value = pos.coords.longitude
      accuracy.value = Math.round(pos.coords.accuracy)
      locationLabel.value = t('discover.locationFromGps')
      geoBusy.value = false
    },
    (err) => {
      geoError.value = err.message || t('discover.geoFailed')
      geoBusy.value = false
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  )
}

// Geocode the typed address via Nominatim (free, no API key). 1 req/sec
// limit per their policy; we wrap one call per click so we never burst.
// User-Agent must identify us — Nominatim asks every consumer to set
// one so they can reach out if a script misbehaves.
async function geocodeAddress() {
  const q = addressInput.value.trim()
  if (!q || addressBusy.value) return
  addressBusy.value = true
  geoError.value = ''
  try {
    const url = 'https://nominatim.openstreetmap.org/search'
      + '?format=json&limit=1&addressdetails=0&q=' + encodeURIComponent(q)
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'fr,en;q=0.7' }
    })
    if (!res.ok) throw new Error('Nominatim ' + res.status)
    const arr = await res.json()
    if (!Array.isArray(arr) || !arr.length) {
      geoError.value = t('discover.addressNotFound')
      return
    }
    const hit = arr[0]
    lat.value = parseFloat(hit.lat)
    lng.value = parseFloat(hit.lon)
    accuracy.value = null
    locationLabel.value = hit.display_name || q
  } catch (e) {
    geoError.value = (e && e.message) || String(e)
  } finally {
    addressBusy.value = false
  }
}

async function runOverpass() {
  if (lat.value == null || lng.value == null) return
  if (searchBusy.value) return
  searchBusy.value = true
  searchError.value = ''
  candidates.value = []
  // amenity~restaurant|fast_food|cafe — covers a Swiss village's options
  // without dragging in every kebab counter as fast_food noise; tweakable
  // by editing this query.
  const q = `
[out:json][timeout:25];
nwr["amenity"~"restaurant|fast_food|cafe|bar|pub"](around:${radius.value},${lat.value},${lng.value});
out tags center;
  `.trim()
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q)
    })
    if (!res.ok) throw new Error('Overpass ' + res.status)
    const json = await res.json()
    const rows = (json.elements || [])
      .map((e) => {
        const tags = e.tags || {}
        if (!tags.name) return null
        return {
          osm_id: `${e.type}/${e.id}`,
          name: tags.name,
          address: formatAddr(tags),
          locality: tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || '',
          postcode: tags['addr:postcode'] || '',
          // OSM rarely tags addr:country directly; fall back to a cheap
          // bbox lookup from the search centre so the verifier still
          // gets a TLD bias.
          country: tags['addr:country'] || inferCountry(lat.value, lng.value),
          phone: tags.phone || tags['contact:phone'] || '',
          website: tags.website || tags['contact:website'] || '',
          lat: e.lat ?? e.center?.lat ?? null,
          lng: e.lon ?? e.center?.lon ?? null,
          selected: false,
          websiteBusy: false,
          websiteSearched: false
        }
      })
      .filter(Boolean)
      // Sort by name for predictable scan.
      .sort((a, b) => a.name.localeCompare(b.name))
    candidates.value = rows
    // Kick off background website lookups for every row missing one.
    for (const row of rows) {
      if (!row.website) findWebsite(row)
    }
  } catch (e) {
    searchError.value = e.message || String(e)
  } finally {
    searchBusy.value = false
  }
}

// Calls the osm-website-search edge function. Fires per-row in
// parallel; we throttle by simply not awaiting in the loop above.
async function findWebsite(row) {
  if (row.websiteBusy || row.website) return
  row.websiteBusy = true
  try {
    const { data } = await supabase.functions.invoke('osm-website-search', {
      body: {
        name: row.name,
        locality: row.locality,
        postcode: row.postcode,
        country: row.country
      }
    })
    if (data?.url) row.website = data.url
  } catch { /* leave website blank — root can paste manually */ }
  row.websiteBusy = false
  row.websiteSearched = true
}

const selectedRows = computed(() => candidates.value.filter((r) => r.selected && r.website))
const selectableCount = computed(() => candidates.value.filter((r) => !!r.website).length)

function selectAllReady() {
  for (const r of candidates.value) r.selected = !!r.website
}
function clearSelection() {
  for (const r of candidates.value) r.selected = false
}

async function enqueueSelected() {
  if (!selectedRows.value.length || enqueueBusy.value) return
  enqueueBusy.value = true
  const email = (session.value?.user?.email || '').toLowerCase()
  const rows = selectedRows.value.map((r) => ({
    osm_id: r.osm_id,
    name: r.name,
    address: r.address || null,
    phone: r.phone || null,
    website_url: r.website,
    lat: r.lat,
    lng: r.lng,
    enqueued_by: email
  }))
  const { error: insErr } = await supabase
    .from('vautcher_scaffold_queue')
    .insert(rows)
  if (insErr) {
    enqueueBusy.value = false
    await alert({ title: t('discover.enqueueFailed'), body: insErr.message })
    return
  }
  // Kick the queue immediately so the first row starts now — the cron
  // tick is once a minute and we don't want to make root wait.
  try {
    await supabase.functions.invoke('scaffold-queue-advance', { body: {} })
  } catch { /* the cron will catch up within the minute */ }
  await alert({
    title: t('discover.enqueueOkTitle'),
    body: t('discover.enqueueOkBody', { n: rows.length })
  })
  for (const r of selectedRows.value) r.selected = false
  enqueueBusy.value = false
}

onMounted(() => {
  // Pre-request location on landing — the prompt only fires from a
  // user gesture on iOS, so this is a no-op there until the button is
  // tapped. Harmless on desktop.
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('discover.title') }}</h1>
      <p>{{ t('discover.subtitle') }}</p>
    </div>

    <!-- Step 1: location + radius -->
    <section class="card geo-card">
      <div class="geo-row">
        <button type="button" class="btn btn--primary" :disabled="geoBusy" @click="getLocation">
          {{ geoBusy ? t('discover.locating') : t('discover.useMyLocation') }}
        </button>
        <span class="geo-or">{{ t('discover.or') }}</span>
      </div>

      <div class="addr-row">
        <input
          v-model="addressInput"
          type="text"
          inputmode="search"
          autocomplete="off" autocorrect="off" spellcheck="false"
          :placeholder="t('discover.addressPlaceholder')"
          class="addr-input"
          @keydown.enter.prevent="geocodeAddress"
        />
        <button
          type="button" class="btn btn--ghost"
          :disabled="addressBusy || !addressInput.trim()"
          @click="geocodeAddress"
        >
          {{ addressBusy ? t('discover.geocoding') : t('discover.useAddress') }}
        </button>
      </div>

      <div class="geo-meta" v-if="lat != null">
        <small>
          📍 {{ locationLabel || `${lat.toFixed(5)} · ${lng.toFixed(5)}` }}
          <span v-if="accuracy != null"> (±{{ accuracy }} m)</span>
        </small>
      </div>
      <div v-if="geoError" class="err">{{ geoError }}</div>

      <label class="radius-row">
        <span>{{ t('discover.radius') }} : <strong>{{ radius }} m</strong></span>
        <input v-model.number="radius" type="range" min="200" max="3000" step="100" />
      </label>

      <button
        type="button"
        class="btn btn--primary"
        :disabled="searchBusy || lat == null"
        @click="runOverpass"
      >
        {{ searchBusy ? t('discover.searching') : t('discover.search') }}
      </button>
      <div v-if="searchError" class="err">{{ searchError }}</div>
    </section>

    <!-- Step 2: candidate list -->
    <section v-if="candidates.length" class="results">
      <div class="results-head">
        <strong>{{ t('discover.foundN', { n: candidates.length }) }}</strong>
        <div class="results-actions">
          <button type="button" class="btn btn--plain btn--sm"
            :disabled="!selectableCount" @click="selectAllReady">
            {{ t('discover.selectAllReady', { n: selectableCount }) }}
          </button>
          <button type="button" class="btn btn--plain btn--sm"
            :disabled="!selectedRows.length" @click="clearSelection">
            {{ t('discover.clearSelection') }}
          </button>
        </div>
      </div>

      <ul class="cand-list">
        <li v-for="r in candidates" :key="r.osm_id" class="card cand-row"
            :class="{ 'cand-row--off': !r.website }">
          <label class="cand-check">
            <input
              type="checkbox"
              v-model="r.selected"
              :disabled="!r.website"
            />
          </label>
          <div class="cand-body">
            <div class="cand-name">{{ r.name }}</div>
            <div v-if="r.address" class="cand-addr">{{ r.address }}</div>
            <div class="cand-web">
              <span v-if="r.websiteBusy" class="cand-web-status">{{ t('discover.searchingWebsite') }}</span>
              <input
                v-else
                type="url"
                v-model="r.website"
                :placeholder="t('discover.websitePlaceholder')"
                inputmode="url"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
              />
              <button
                v-if="!r.websiteBusy && !r.website && r.websiteSearched"
                type="button" class="btn btn--plain btn--sm"
                @click="findWebsite(r)"
              >{{ t('discover.retryWebsite') }}</button>
            </div>
          </div>
        </li>
      </ul>

      <div class="enqueue-bar">
        <button
          type="button"
          class="btn btn--primary btn--full"
          :disabled="!selectedRows.length || enqueueBusy"
          @click="enqueueSelected"
        >
          {{ enqueueBusy
            ? t('discover.enqueueRunning')
            : t('discover.enqueueBtn', { n: selectedRows.length }) }}
        </button>
        <RouterLink :to="{ name: 'admin' }" class="btn btn--plain btn--sm">
          {{ t('discover.backToAdmin') }}
        </RouterLink>
      </div>
    </section>

    <p v-else-if="!searchBusy && lat != null" class="empty">
      {{ t('discover.noResults') }}
    </p>
  </div>
</template>

<style scoped>
.geo-card { padding: 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 14px; }
.geo-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.geo-or { font-size: 0.75rem; font-weight: 700; color: var(--mut); letter-spacing: 0.06em; text-transform: uppercase; }
.addr-row { display: flex; gap: 8px; align-items: stretch; flex-wrap: wrap; }
.addr-input {
  flex: 1 1 180px; min-width: 0;
  font-family: inherit; font-size: 0.92rem;
  padding: 10px 12px; border: 1.4px solid var(--line); border-radius: 11px;
  background: var(--surface); color: var(--ink); box-sizing: border-box;
}
.addr-input:focus { outline: none; border-color: var(--accent); }
.geo-meta { font-size: 0.85rem; color: var(--ink); }
.radius-row { display: flex; flex-direction: column; gap: 6px; font-size: 0.88rem; color: var(--ink); }
.radius-row input[type="range"] { width: 100%; }

.results { display: flex; flex-direction: column; gap: 14px; }
.results-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
}
.results-actions { display: flex; gap: 6px; }

.cand-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.cand-row {
  display: flex; gap: 12px; padding: 12px 14px; align-items: flex-start;
}
.cand-row--off { opacity: 0.62; }
.cand-check { flex: 0 0 auto; padding-top: 2px; }
.cand-check input { width: 20px; height: 20px; cursor: pointer; }
.cand-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.cand-name { font-family: 'Rufina', serif; font-size: 1.02rem; color: var(--ink); }
.cand-addr { font-size: 0.82rem; color: var(--mut); }
.cand-web { display: flex; align-items: center; gap: 8px; }
.cand-web input {
  flex: 1 1 auto; min-width: 0;
  font-family: inherit; font-size: 0.85rem;
  padding: 7px 10px; border: 1.2px solid var(--line); border-radius: 9px;
  background: var(--surface); color: var(--ink); box-sizing: border-box;
}
.cand-web input:focus { outline: none; border-color: var(--accent); }
.cand-web-status { font-size: 0.8rem; color: var(--mut); font-style: italic; }

/* Sticks to the bottom of the scrolling viewport, sitting flush against
   the top of the bottom tabbar. The previous offset matched the tabbar
   height which left the bar floating mid-viewport. */
.enqueue-bar {
  position: sticky; bottom: 0;
  margin: 8px -16px 0;
  padding: 10px 16px;
  background: var(--surface);
  border-top: 1px solid var(--line);
  box-shadow: 0 -8px 22px rgba(0, 0, 0, 0.05);
  display: flex; flex-direction: column; gap: 6px; align-items: stretch;
  z-index: 5;
}
.btn--full { width: 100%; }

.err { color: var(--danger); font-size: 0.85rem; font-weight: 600; margin-top: 6px; }
.empty { text-align: center; color: var(--mut); padding: 30px 12px; }
</style>
