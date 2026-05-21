<script setup>
import { ref, watch, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import { listEvents } from '../lib/events'
import { today } from '../lib/format'
import EventRow from '../components/EventRow.vue'

const { restaurant } = useAuth()
const { t } = useI18n()
const events = ref([])
const loading = ref(true)
const loadError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false
  const watchdog = setTimeout(() => {
    if (loading.value) { loading.value = false; loadError.value = true }
  }, 9000)
  try {
    if (restaurant.value) {
      const { data, error } = await listEvents(restaurant.value.id)
      if (error) throw error
      events.value = data
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

// History = past events OR cancelled events, most recent first.
const past = computed(() =>
  events.value
    .filter((e) => e.event_date < today() || e.status === 'cancelled')
    .sort((a, b) => b.event_date.localeCompare(a.event_date))
)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('history.title') }}</h1>
      <p>{{ t('history.subtitle') }}</p>
    </div>

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <div v-else-if="loadError" class="empty">
      {{ t('common.loadError') }}
      <button class="btn btn--plain btn--sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <p v-else-if="!past.length" class="empty">{{ t('history.empty') }}</p>

    <div v-else class="ev-list">
      <EventRow v-for="ev in past" :key="ev.id" :event="ev">
        <RouterLink :to="`/event/new?from=${ev.id}`" class="btn btn--ghost btn--sm">
          {{ t('history.duplicate') }}
        </RouterLink>
      </EventRow>
    </div>
  </div>
</template>

<style scoped>
.ev-list { display: flex; flex-direction: column; gap: 12px; }
.retry { display: block; margin: 14px auto 0; }
</style>
