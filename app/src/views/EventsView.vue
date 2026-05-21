<script setup>
import { ref, onMounted } from 'vue'
import { useProfile } from '../composables/useProfile'
import { fetchEvents, joinEvent, leaveEvent } from '../lib/api'
import EventCard from '../components/EventCard.vue'
import NotifyBanner from '../components/NotifyBanner.vue'

const { profile } = useProfile()
const events = ref([])
const loading = ref(true)
const busyId = ref(null)

onMounted(async () => {
  const { events: list } = await fetchEvents(profile.value?.id)
  events.value = list
  loading.value = false
})

async function onJoin(ev) {
  busyId.value = ev.id
  const res = await joinEvent(ev.id, profile.value?.id)
  if (res.ok) {
    ev.joined = true
    ev.attendees = (ev.attendees || 0) + 1
  }
  busyId.value = null
}

async function onLeave(ev) {
  busyId.value = ev.id
  const res = await leaveEvent(ev.id, profile.value?.id)
  if (res.ok) {
    ev.joined = false
    ev.attendees = Math.max(0, (ev.attendees || 0) - 1)
  }
  busyId.value = null
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <span class="kicker">Agenda</span>
      <h1>Nos événements</h1>
      <p>Soirées, dégustations et rendez-vous à venir à La Gioconda. Indiquez-nous si vous souhaitez y participer.</p>
    </header>

    <div class="container list">
      <NotifyBanner />

      <p v-if="loading" class="state">Chargement des événements…</p>
      <p v-else-if="!events.length" class="state">
        Aucun événement à venir pour le moment — revenez bientôt&nbsp;!
      </p>
      <EventCard
        v-for="ev in events"
        :key="ev.id"
        :event="ev"
        :busy="busyId === ev.id"
        @join="onJoin"
        @leave="onLeave"
      />
    </div>
  </div>
</template>

<style scoped>
.page { background: var(--paper); min-height: 100%; padding-bottom: 54px; }
.page-head { text-align: center; padding: 36px 20px 20px; }
.kicker {
  color: var(--burgundy);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.page-head h1 { font-size: clamp(2rem, 6vw, 2.8rem); margin: 6px 0; }
.page-head p { color: var(--grey); max-width: 560px; margin: 0 auto; }

.list {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 760px;
}
.state { text-align: center; color: var(--grey); padding: 44px 0; }
</style>
