<script setup>
// Per-restaurant clients page. Thin wrapper around <ClientList />.
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import { useScope } from '../composables/useScope'
import { restaurantClients } from '../lib/clients'
import { setClientLocked } from '../lib/admin'
import ClientList from '../components/ClientList.vue'

const { isModerator } = useAuth()
const { activeRestaurantId, activeRestaurant } = useScope()
const { t } = useI18n()

const clients = ref([])
const loading = ref(true)
const loadError = ref(false)
const busy = ref(false)

async function load() {
  loading.value = true
  loadError.value = false
  const watchdog = setTimeout(() => {
    if (loading.value) { loading.value = false; loadError.value = true }
  }, 9000)
  try {
    const { data, error } = await restaurantClients(activeRestaurantId.value)
    if (error) throw error
    clients.value = data
  } catch (e) {
    loadError.value = true
  } finally {
    clearTimeout(watchdog)
    loading.value = false
  }
}
watch(activeRestaurantId, load, { immediate: true })

// Moderators can lock / unlock a diner from the list. setClientLocked
// is gated server-side on moderator status (the lib RPC checks).
async function onToggleLock(c) {
  if (busy.value) return
  busy.value = true
  try {
    const next = !c.locked
    const { error } = await setClientLocked(c.id, next)
    if (!error) c.locked = next
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('clients.title') }}</h1>
      <p>{{ activeRestaurant ? activeRestaurant.name : '' }}</p>
    </div>

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <div v-else-if="loadError" class="empty">
      {{ t('clients.loadError') }}
      <button class="btn btn--plain btn--sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <ClientList
      v-else
      :clients="clients"
      :show-lock="isModerator"
      :busy="busy"
      :empty-text="t('clients.empty')"
      @toggle-lock="onToggleLock"
    />
  </div>
</template>

<style scoped>
.retry { display: block; margin: 14px auto 0; }
</style>
