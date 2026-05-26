<script setup>
// Bespoke home — renders the Claude-designed HTML stored at
// site.homeHtml. The CSS that goes with it has already been scoped
// under .bespoke-home by extract-bespoke-config.mjs, so it can't leak
// into AppHeader, AppFooter, EventsView, etc.
//
// Two runtime jobs Vue keeps:
//   1. Replace the <!-- @EVENTS --> marker with cards built from
//      vautcher_events (live data). The cards use the rw-event*
//      classes Claude prepared so they inherit the bespoke styling.
//   2. Re-write anchor hrefs that pointed at the source site
//      (https://www.pavillonversoix.ch/...) into in-app routes
//      (/evenements, /reservation, /contact, etc.).
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { site } from '../../data/site'
import { fetchEvents } from '../../lib/api'

const rootRef = ref(null)
const events = ref([])

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
function fmtDate(d) {
  try { const dt = new Date(d + 'T00:00:00'); return `${dt.getDate()} ${MONTHS[dt.getMonth()]}` } catch { return d }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderEventsHtml(list) {
  if (!list.length) return ''
  const cards = list.slice(0, 2).map((ev) => `
    <a class="rw-event" href="/evenements/${esc(ev.id)}">
      ${ev.image_url ? `<div class="rw-event-img" style="background-image:url('${esc(ev.image_url)}')"></div>` : ''}
      <div class="rw-event-body">
        <div class="rw-event-date">${esc(fmtDate(ev.event_date))}</div>
        <h3 class="rw-event-title">${esc(ev.title || '')}</h3>
        <p class="rw-event-meta">${esc(ev.event_time || '')}${ev.location ? ' · ' + esc(ev.location) : ''}</p>
      </div>
    </a>`).join('')
  return `<div class="rw-events">${cards}</div>`
}

// Inject events + rewrite source-site links once the HTML is in the DOM.
async function hydrate() {
  await nextTick()
  if (!rootRef.value) return

  // 1. Events marker → render with the bespoke classes.
  const markers = rootRef.value.querySelectorAll('[data-events-marker], comment')
  // v-html keeps HTML comments — find the @EVENTS marker by walking text nodes.
  const walker = document.createTreeWalker(rootRef.value, NodeFilter.SHOW_COMMENT, null)
  let node, eventsAnchor = null
  while ((node = walker.nextNode())) {
    if (/@EVENTS/i.test(node.textContent || '')) { eventsAnchor = node; break }
  }
  if (eventsAnchor && events.value.length) {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = renderEventsHtml(events.value)
    eventsAnchor.parentNode.replaceChild(wrapper.firstChild, eventsAnchor)
  } else if (eventsAnchor) {
    // No events yet — remove the marker so we don't leave a comment.
    eventsAnchor.remove()
  }

  // 2. Rewrite owner-site hrefs (e.g. pointing at pavillonversoix.ch/reservation)
  //    to the diner's own routes so navigation stays in-app.
  const ROUTE_MAP = [
    { pat: /\/(reservation|reservations|book)\b/i, route: '/reservation' },
    { pat: /\/(carte|menu|dishes|plats)\b/i, route: '/' },
    { pat: /\/(contact|infos?|horaires)\b/i, route: '/contact' },
    { pat: /\/(gallery|galerie|photos)\b/i, route: '/galerie' },
    { pat: /\/(evenement|agenda|events?)\b/i, route: '/evenements' }
  ]
  rootRef.value.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || ''
    // External http(s) links → check if they're the owner's own domain.
    if (/^https?:\/\//i.test(href)) {
      for (const r of ROUTE_MAP) if (r.pat.test(href)) { a.setAttribute('href', r.route); return }
    }
  })
}

onMounted(async () => {
  try { const { events: list } = await fetchEvents(); events.value = (list || []).slice(0, 2) } catch { events.value = [] }
  hydrate()
})
watch(() => site.homeHtml, hydrate)
</script>

<template>
  <div ref="rootRef" class="bespoke-home" v-html="site.homeHtml"></div>
</template>

<style>
/* No styles here — every visual concern lives inside the scoped CSS
   injected by site.js (via the home_css extracted by
   extract-bespoke-config.mjs). This file just provides the wrapper. */
</style>
