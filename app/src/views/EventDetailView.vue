<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useProfile } from '../composables/useProfile'
import { fetchEvent, joinEvent, leaveEvent } from '../lib/api'
import { formatPrice } from '../lib/format'

const route = useRoute()
const router = useRouter()
const { profile } = useProfile()

const event = ref(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')

const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                     'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

const fullDate = computed(() => {
  if (!event.value?.event_date) return ''
  const d = new Date(event.value.event_date + 'T00:00:00')
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`
})
const attendees = computed(() => event.value?.attendees || 0)
const max = computed(() => event.value?.max_participants ?? null)
const full = computed(() => max.value != null && attendees.value >= max.value)
const rebateText = computed(() => {
  const ev = event.value
  if (!ev?.rebate_value) return ''
  const amount = ev.rebate_unit === 'chf' ? `${ev.rebate_value} CHF` : `${ev.rebate_value} %`
  return ev.rebate_first_n
    ? `Rabais de ${amount} pour les ${ev.rebate_first_n} premiers inscrits`
    : `Rabais de ${amount}`
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { event: e } = await fetchEvent(route.params.id, profile.value?.id)
    if (!e) {
      error.value = "Cet événement est introuvable — il a peut-être été annulé."
    } else {
      event.value = e
    }
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => route.params.id, load)

async function onJoin() {
  if (!event.value || busy.value) return
  busy.value = true
  try {
    const res = await joinEvent(event.value.id, profile.value?.id)
    if (res.ok) {
      event.value.joined = true
      event.value.attendees = (event.value.attendees || 0) + 1
    }
  } finally {
    busy.value = false
  }
}
async function onLeave() {
  if (!event.value || busy.value) return
  busy.value = true
  try {
    const res = await leaveEvent(event.value.id, profile.value?.id)
    if (res.ok) {
      event.value.joined = false
      event.value.attendees = Math.max(0, (event.value.attendees || 0) - 1)
    }
  } finally {
    busy.value = false
  }
}
function goBack() {
  // If there's history, pop. Otherwise land on the Agenda list.
  if (window.history.length > 1) router.back()
  else router.push({ name: 'events' })
}

// ---- Add to calendar ----
// One .ics per single occurrence — recurring events are already split
// into separate DB rows server-side, so the diner only adds the dates
// they actually plan to attend (no fifty-entry series dump).
function escIcs(s) {
  return (s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}
function parseHM(timeStr) {
  // Accepts "19h30", "19:30", "19h", "19h 30" — common Swiss/French formats.
  const m = (timeStr || '').match(/(\d{1,2})\s*[h:]\s*(\d{2})?/)
  if (!m) return null
  return { hh: m[1].padStart(2, '0'), mm: (m[2] || '00').padStart(2, '0') }
}
function buildIcs(ev) {
  const dateStr = ev.event_date.replace(/-/g, '') // YYYYMMDD
  const hm = parseHM(ev.event_time)
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'

  // DTSTART/DTEND — timed or all-day.
  let dtStart, dtEnd
  if (hm) {
    dtStart = `DTSTART:${dateStr}T${hm.hh}${hm.mm}00`
    // Prefer the explicit end time when the owner provided one;
    // otherwise default to a 2-hour slot.
    const endHm = ev.event_end_time ? parseHM(ev.event_end_time) : null
    if (endHm) {
      dtEnd = `DTEND:${dateStr}T${endHm.hh}${endHm.mm}00`
    } else {
      const endHH = String((+hm.hh + 2) % 24).padStart(2, '0')
      dtEnd = `DTEND:${dateStr}T${endHH}${hm.mm}00`
    }
  } else {
    dtStart = `DTSTART;VALUE=DATE:${dateStr}`
    dtEnd = ''
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vautcher//Events//FR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:event-${ev.id}@vautcher`,
    `DTSTAMP:${dtStamp}`,
    dtStart,
    dtEnd,
    `SUMMARY:${escIcs(ev.title)}`,
    ev.description ? `DESCRIPTION:${escIcs(ev.description)}` : '',
    ev.location ? `LOCATION:${escIcs(ev.location)}` : '',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean)
  return lines.join('\r\n')
}

const calBusy = ref(false)
async function addToCalendar() {
  if (!event.value || calBusy.value) return
  calBusy.value = true
  try {
    const ics = buildIcs(event.value)
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const slug = (event.value.title || 'evenement')
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'evenement'
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}-${event.value.event_date}.ics`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Revoke later — Safari sometimes needs the URL alive briefly.
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  } finally {
    calBusy.value = false
  }
}
</script>

<template>
  <div class="page">
    <button type="button" class="ed-back" @click="goBack" aria-label="Retour">‹ Agenda</button>

    <p v-if="loading" class="state">Chargement…</p>

    <div v-else-if="error" class="state">
      <p>{{ error }}</p>
      <RouterLink :to="{ name: 'events' }" class="ed-link">← Retour à l'agenda</RouterLink>
    </div>

    <article v-else-if="event" class="ed">
      <div class="ed-hero">
        <img
          v-if="event.image_url"
          :src="event.image_url"
          :alt="event.title"
          decoding="async"
          class="ed-hero-img"
        />
        <div v-if="event.joined" class="ed-stamp" aria-label="Inscrit·e">
          <span>Inscrit·e</span>
        </div>
        <span v-if="full && !event.joined" class="ed-flag ed-flag--full">Complet</span>
      </div>

      <div class="ed-body">
        <h1>{{ event.title }}</h1>

        <ul class="ed-meta">
          <li><span class="ic">📅</span>{{ fullDate }}</li>
          <li v-if="event.event_time">
            <span class="ic">🕖</span>{{ event.event_time }}<template v-if="event.event_end_time"> – {{ event.event_end_time }}</template>
          </li>
          <li v-if="event.location"><span class="ic">📍</span>{{ event.location }}</li>
          <li v-if="event.price"><span class="ic">🪙</span>{{ formatPrice(event.price) }}</li>
        </ul>

        <p v-if="rebateText" class="ed-rebate">🎁 {{ rebateText }}</p>

        <p v-if="event.description" class="ed-desc">{{ event.description }}</p>

        <!-- Attendee count is owner-only — see restowner. The Complet
             flag on the hero still signals a full event to diners. -->

        <div class="ed-actions">
          <button
            v-if="event.joined"
            type="button"
            class="ed-btn ed-btn--leave"
            :disabled="busy"
            @click="onLeave"
          >Annuler ma participation</button>
          <button
            v-else-if="full"
            type="button"
            class="ed-btn ed-btn--join"
            disabled
          >Complet</button>
          <button
            v-else
            type="button"
            class="ed-btn ed-btn--join"
            :disabled="busy"
            @click="onJoin"
          >Je participe</button>
        </div>

        <button
          type="button"
          class="ed-btn-secondary"
          :disabled="calBusy"
          @click="addToCalendar"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true">
            <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
            <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
            <path d="M9 14h6M12 11v6" />
          </svg>
          Ajouter à mon calendrier
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.page { background: var(--paper); min-height: 100%; padding-bottom: 32px; }
.state { text-align: center; color: var(--grey); padding: 44px 20px; }
.ed-link { color: var(--burgundy); font-weight: 600; }

.ed-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 0;
  color: var(--burgundy);
  font-weight: 600;
  font-size: 0.92rem;
  padding: 16px 20px;
  cursor: pointer;
}

.ed {
  max-width: 760px;
  margin: 0 auto;
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.08);
}
.ed-hero {
  position: relative;
  height: 260px;
  background: #e9e3d4;
  overflow: hidden;
}
.ed-hero-img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  z-index: 0;
}
.ed-hero > :not(.ed-hero-img) { position: absolute; z-index: 2; }
.ed-flag {
  position: absolute;
  bottom: 14px;
  left: 16px;
  background: var(--burgundy);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 6px 12px;
  border-radius: 20px;
}
.ed-flag--full {
  top: 14px; bottom: auto; right: 16px; left: auto;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
}

/* Passport-style "Inscrit·e" stamp — larger than the card variant
   because the hero image gives us the room. Same diagonal rotation
   and double-border for visual continuity between list and detail. */
.ed-stamp {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-14deg);
  border: 4px double var(--burgundy);
  background: rgba(255, 255, 255, 0.82);
  color: var(--burgundy);
  font-family: 'Rufina', serif;
  font-weight: 800;
  font-size: 2.4rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 12px 32px;
  border-radius: 6px;
  pointer-events: none;
  white-space: nowrap;
  opacity: 0.96;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  animation: ed-stamp-in 0.35s cubic-bezier(0.18, 1.2, 0.4, 1) both;
}
.ed-stamp::after {
  content: '';
  position: absolute;
  inset: 5px;
  border: 1px solid color-mix(in srgb, var(--burgundy) 35%, transparent);
  border-radius: 3px;
  pointer-events: none;
}
@keyframes ed-stamp-in {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) rotate(-14deg) scale(1.4);
  }
  to {
    opacity: 0.96;
    transform: translate(-50%, -50%) rotate(-14deg) scale(1);
  }
}

.ed-body { padding: 22px 22px 28px; }
.ed-body h1 {
  font-size: clamp(1.5rem, 5vw, 2rem);
  line-height: 1.15;
  margin-bottom: 14px;
}

.ed-meta {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 14px;
  padding: 0;
}
.ed-meta li {
  font-size: 0.92rem;
  color: var(--grey);
  display: flex;
  align-items: center;
  gap: 6px;
}
.ed-meta .ic { font-size: 1rem; }

.ed-rebate {
  display: inline-block;
  background: linear-gradient(135deg, #fbeec4, #f3d98c);
  color: #6e5414;
  font-size: 0.88rem;
  font-weight: 700;
  padding: 8px 14px;
  border-radius: 10px;
  margin-bottom: 16px;
}

.ed-desc {
  color: var(--ink);
  font-size: 1rem;
  line-height: 1.65;
  white-space: pre-wrap;
  margin-bottom: 22px;
}

.ed-count {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--burgundy);
  margin-bottom: 18px;
}

.ed-actions { display: flex; }
.ed-btn {
  flex: 1;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 700;
  font-size: 0.92rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 16px 22px;
  transition: background 0.15s, opacity 0.15s;
}
.ed-btn--join { background: var(--burgundy); color: #fff; }
.ed-btn--join:hover { background: var(--burgundy-dark); }
.ed-btn--leave {
  background: #fff;
  color: var(--burgundy);
  border: 2px solid var(--burgundy);
}
.ed-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.ed-btn-secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  margin-top: 12px;
  border: 1px solid var(--burgundy);
  background: transparent;
  color: var(--burgundy);
  border-radius: 10px;
  font-family: inherit;
  font-weight: 600;
  font-size: 0.9rem;
  padding: 13px 18px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ed-btn-secondary svg { width: 18px; height: 18px; flex: 0 0 auto; }
.ed-btn-secondary:hover { background: color-mix(in srgb, var(--burgundy) 7%, transparent); }
.ed-btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
