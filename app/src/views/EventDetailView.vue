<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useProfile } from '../composables/useProfile'
import { fetchEvent, joinEvent, leaveEvent } from '../lib/api'

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
      <div class="ed-hero" :style="{ backgroundImage: `url(${event.image_url})` }">
        <span v-if="event.joined" class="ed-flag">✓ Inscrit·e</span>
        <span v-if="full" class="ed-flag ed-flag--full">Complet</span>
      </div>

      <div class="ed-body">
        <h1>{{ event.title }}</h1>

        <ul class="ed-meta">
          <li><span class="ic">📅</span>{{ fullDate }}</li>
          <li v-if="event.event_time"><span class="ic">🕖</span>{{ event.event_time }}</li>
          <li v-if="event.location"><span class="ic">📍</span>{{ event.location }}</li>
          <li v-if="event.price"><span class="ic">🎟️</span>{{ event.price }}</li>
        </ul>

        <p v-if="rebateText" class="ed-rebate">🎁 {{ rebateText }}</p>

        <p v-if="event.description" class="ed-desc">{{ event.description }}</p>

        <p class="ed-count">
          <template v-if="max != null">{{ attendees }} / {{ max }} participants</template>
          <template v-else>
            {{ attendees }} {{ attendees > 1 ? 'personnes intéressées' : 'personne intéressée' }}
          </template>
        </p>

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
  background: #e9e3d4 center/cover no-repeat;
}
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
</style>
