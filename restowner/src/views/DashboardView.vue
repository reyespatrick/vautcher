<script setup>
import { ref, watch, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import { listEvents, listEventStats, cancelEvent } from '../lib/events'
import { today } from '../lib/format'
import EventRow from '../components/EventRow.vue'

const { restaurant } = useAuth()
const { t } = useI18n()
const events = ref([])
const stats = ref({})        // { [eventId]: attendee count }
const loading = ref(true)
const loadError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false
  // Watchdog — never leave the screen stuck on "Chargement…".
  const watchdog = setTimeout(() => {
    if (loading.value) { loading.value = false; loadError.value = true }
  }, 9000)
  try {
    if (restaurant.value) {
      const { data, error } = await listEvents(restaurant.value.id)
      if (error) throw error
      events.value = data
      // Attendee counts are best-effort — never block the list on them.
      stats.value = await listEventStats()
    }
  } catch (e) {
    loadError.value = true
  } finally {
    clearTimeout(watchdog)
    loading.value = false
  }
}
// Runs now and again if `restaurant` resolves after this view mounts.
watch(restaurant, load, { immediate: true })

// Upcoming = today or later. Past events live in History.
// Latest event first.
const upcoming = computed(() =>
  events.value
    .filter((e) => e.event_date >= today())
    .sort((a, b) => b.event_date.localeCompare(a.event_date))
)

async function onCancel(ev) {
  if (!confirm(t('event.confirmCancel', { title: ev.title }))) return
  await cancelEvent(ev.id)
  load()
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('dashboard.title') }}</h1>
      <p>{{ restaurant ? restaurant.name : '' }}</p>
    </div>

    <RouterLink to="/event/new" class="btn btn--full create-btn">
      <span class="plus">+</span> {{ t('dashboard.create') }}
    </RouterLink>

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <div v-else-if="loadError" class="empty">
      {{ t('common.loadError') }}
      <button class="btn btn--plain btn--sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <p v-else-if="!upcoming.length" class="empty">
      {{ t('dashboard.empty') }}<br />{{ t('dashboard.emptyHint') }}
    </p>

    <div v-else class="ev-list">
      <EventRow v-for="ev in upcoming" :key="ev.id" :event="ev" :attendees="stats[ev.id] || 0">
        <RouterLink :to="`/event/${ev.id}`" class="btn btn--plain btn--sm">{{ t('event.edit') }}</RouterLink>
        <button
          v-if="ev.status !== 'cancelled'"
          class="btn btn--danger btn--sm"
          @click="onCancel(ev)"
        >{{ t('event.cancel') }}</button>
      </EventRow>
    </div>
  </div>
</template>

<style scoped>
.create-btn { margin-bottom: 22px; }
.plus { font-size: 1.15rem; font-weight: 700; line-height: 0; }
.ev-list { display: flex; flex-direction: column; gap: 12px; }
.retry { display: block; margin: 14px auto 0; }
</style>
