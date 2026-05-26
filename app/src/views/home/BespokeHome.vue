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
  const cards = list.slice(0, 2).map((ev) => {
    const attendees = ev.attendees || 0
    const max = ev.max_participants ?? null
    const full = max != null && attendees >= max && !ev.joined
    const timeStr = [ev.event_time, ev.event_end_time].filter(Boolean).join(' – ')
    const meta = [timeStr, ev.location, ev.price].filter(Boolean).map((s) => `<li>${esc(s)}</li>`).join('')
    const rebate = (() => {
      const v = ev.rebate_value
      if (!v) return ''
      const amount = ev.rebate_unit === 'chf' ? `${v} CHF` : `${v} %`
      const n = ev.rebate_first_n
      const label = n ? `${amount} pour les ${n} premiers` : `Offre ${amount}`
      return `<span class="rw-event-rebate">🎟 ${esc(label)}</span>`
    })()
    return `
    <a class="rw-event${ev.joined ? ' is-joined' : ''}${full ? ' is-full' : ''}" href="/evenements/${esc(ev.id)}">
      <div class="rw-event-img"${ev.image_url ? ` style="background-image:url('${esc(ev.image_url)}')"` : ''}>
        <div class="rw-event-date">${esc(fmtDate(ev.event_date))}</div>
        ${ev.joined ? '<div class="rw-event-badge rw-event-badge--joined">Inscrit</div>' : ''}
        ${full ? '<div class="rw-event-badge rw-event-badge--full">Complet</div>' : ''}
      </div>
      <div class="rw-event-body">
        <h3 class="rw-event-title">${esc(ev.title || '')}</h3>
        ${meta ? `<ul class="rw-event-meta">${meta}</ul>` : ''}
        ${ev.description ? `<p class="rw-event-desc">${esc(ev.description)}</p>` : ''}
        ${rebate}
      </div>
    </a>`
  }).join('')
  return `<div class="rw-events">${cards}</div>`
}

// Find the best place to drop the events teaser when Claude didn't
// leave a <!-- @EVENTS --> marker. Heuristic: after the first hero-
// like element (section/header/div whose first child is an h1 or
// whose class contains "hero"). Falls back to the first direct child
// of the bespoke-home wrapper.
function findHeroAnchor(root) {
  const direct = Array.from(root.children)
  for (const el of direct) {
    const cls = (el.className || '').toString().toLowerCase()
    if (/hero|header|cover|banner|landing/.test(cls)) return el
    if (el.tagName === 'HEADER') return el
    if (el.querySelector('h1')) return el
  }
  return direct[0] || null
}

// Inject events + rewrite source-site links once the HTML is in the DOM.
async function hydrate() {
  await nextTick()
  if (!rootRef.value) return

  // 1. Events: prefer Claude's <!-- @EVENTS --> marker. Walk text
  //    nodes that are HTML comments to find it.
  const walker = document.createTreeWalker(rootRef.value, NodeFilter.SHOW_COMMENT, null)
  let node, eventsAnchor = null
  while ((node = walker.nextNode())) {
    if (/@EVENTS/i.test(node.textContent || '')) { eventsAnchor = node; break }
  }
  if (eventsAnchor) {
    if (events.value.length) {
      const wrapper = document.createElement('div')
      wrapper.innerHTML = renderEventsHtml(events.value)
      eventsAnchor.parentNode.replaceChild(wrapper.firstChild, eventsAnchor)
    } else {
      eventsAnchor.remove()
    }
  } else if (events.value.length) {
    // No marker — drop the teaser right after the hero so it's
    // visible without scrolling much. Owner has events but Claude's
    // design didn't reserve a slot for them.
    const hero = findHeroAnchor(rootRef.value)
    if (hero) {
      const wrapper = document.createElement('div')
      wrapper.innerHTML = renderEventsHtml(events.value)
      hero.insertAdjacentElement('afterend', wrapper.firstChild)
    }
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
/* Default styling for the auto-injected events teaser. Themes through
   --primary / --primary-dark / --font-display, which are set by
   site.js from the bespoke theme tokens. Claude can override any of
   this if it ships its own .rw-event rules in home_css. */
.bespoke-home .rw-events {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 18px;
  padding: 24px clamp(20px, 5vw, 56px) 28px;
  max-width: 1100px;
  margin: 0 auto;
}
.bespoke-home .rw-event {
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 6px;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  box-shadow: 0 6px 20px -10px rgba(0, 0, 0, 0.18);
  transition: transform .18s ease, box-shadow .18s ease;
}
.bespoke-home .rw-event:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 36px -12px rgba(0, 0, 0, 0.28);
}
.bespoke-home .rw-event-img {
  aspect-ratio: 16 / 10;
  background-size: cover;
  background-position: center;
  background-color: color-mix(in srgb, var(--primary, var(--burgundy, #9e053d)) 12%, #eee);
  position: relative;
}
.bespoke-home .rw-event-date {
  position: absolute;
  top: 14px; left: 14px;
  background: rgba(255, 255, 255, 0.96);
  color: var(--primary, var(--burgundy, #9e053d));
  font-weight: 700;
  font-size: .76rem;
  letter-spacing: .04em;
  text-transform: uppercase;
  padding: 5px 10px;
  border-radius: 3px;
}
.bespoke-home .rw-event-body {
  padding: 18px 22px 22px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bespoke-home .rw-event-title {
  font-family: var(--font-display, 'Playfair Display', Georgia, serif);
  font-size: 1.2rem;
  font-weight: 500;
  margin: 0;
  line-height: 1.25;
  color: var(--ink, #1b1b1b);
}
.bespoke-home .rw-event-meta {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  color: rgba(0, 0, 0, 0.6);
  font-size: .88rem;
}
.bespoke-home .rw-event-meta li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.bespoke-home .rw-event-meta li + li::before {
  content: '·';
  margin-right: 8px;
  color: rgba(0, 0, 0, 0.3);
}
.bespoke-home .rw-event-desc {
  font-size: .9rem;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.7);
  margin: 4px 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.bespoke-home .rw-event-rebate {
  align-self: flex-start;
  margin-top: 8px;
  background: color-mix(in srgb, var(--primary, var(--burgundy, #9e053d)) 8%, transparent);
  color: var(--primary, var(--burgundy, #9e053d));
  font-size: .78rem;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
}
.bespoke-home .rw-event-badge {
  position: absolute;
  top: 14px;
  right: 14px;
  font-size: .7rem;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  padding: 5px 10px;
  border-radius: 3px;
}
.bespoke-home .rw-event-badge--joined {
  background: var(--primary, var(--burgundy, #9e053d));
  color: #fff;
}
.bespoke-home .rw-event-badge--full {
  background: rgba(0, 0, 0, 0.82);
  color: #fff;
}
.bespoke-home .rw-event.is-joined { border-color: var(--primary, var(--burgundy, #9e053d)); }
.bespoke-home .rw-event.is-full .rw-event-img { filter: grayscale(0.4) brightness(0.95); }
</style>
