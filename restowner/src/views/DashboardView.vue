<script setup>
import { ref, watch, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import { listEvents, cancelEvent } from '../lib/events'
import { today } from '../lib/format'
import EventRow from '../components/EventRow.vue'

const { restaurant } = useAuth()
const { t } = useI18n()
const events = ref([])
const loading = ref(true)

async function load() {
  loading.value = true
  if (restaurant.value) {
    const { data } = await listEvents(restaurant.value.id)
    events.value = data
  }
  loading.value = false
}
// Runs now and again if `restaurant` resolves after this view mounts.
watch(restaurant, load, { immediate: true })

// Upcoming = today or later. Past events live in History.
const upcoming = computed(() =>
  events.value
    .filter((e) => e.event_date >= today())
    .sort((a, b) => a.event_date.localeCompare(b.event_date))
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

    <p v-else-if="!upcoming.length" class="empty">
      {{ t('dashboard.empty') }}<br />{{ t('dashboard.emptyHint') }}
    </p>

    <div v-else class="ev-list">
      <EventRow v-for="ev in upcoming" :key="ev.id" :event="ev">
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
</style>
