<script setup>
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useScope } from '../composables/useScope'
import { restaurantClients } from '../lib/clients'

const { activeRestaurantId, activeRestaurant } = useScope()
const { t, locale } = useI18n()

const clients = ref([])
const loading = ref(true)
const loadError = ref(false)
const query = ref('')

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
// Re-fetches when the header scope changes.
watch(activeRestaurantId, load, { immediate: true })

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return clients.value
  return clients.value.filter((c) => (c.name || '').toLowerCase().includes(q))
})

function fmtDate(d) {
  if (!d) return ''
  return new Intl.DateTimeFormat(locale.value, {
    day: 'numeric', month: 'short', year: 'numeric'
  }).format(new Date(d + 'T00:00:00'))
}
function age(d) {
  if (!d) return null
  const t = new Date()
  const b = new Date(d + 'T00:00:00')
  let a = t.getFullYear() - b.getFullYear()
  const m = t.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--
  return a
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('clients.title') }}</h1>
      <p>{{ activeRestaurant ? activeRestaurant.name : '' }}</p>
    </div>

    <input
      v-model="query"
      type="search"
      class="cl-search"
      :placeholder="t('clients.searchPlaceholder')"
      autocomplete="off"
      autocorrect="off"
      spellcheck="false"
    />

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <div v-else-if="loadError" class="empty">
      {{ t('common.loadError') }}
      <button class="btn btn--plain btn--sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <p v-else-if="!clients.length" class="empty">{{ t('clients.empty') }}</p>

    <p v-else-if="!filtered.length" class="empty">{{ t('clients.noMatch') }}</p>

    <div v-else class="cl-list">
      <div v-for="c in filtered" :key="c.id" class="card cl" :class="{ locked: c.locked }">
        <div class="cl-id">
          <strong>{{ c.name || '—' }}</strong>
          <span v-if="age(c.birth_date) != null" class="cl-age">
            {{ t('clients.ageYears', { n: age(c.birth_date) }) }}
          </span>
          <span v-if="c.locked" class="cl-locked">{{ t('clients.locked') }}</span>
        </div>
        <div class="cl-stats">
          <span class="cl-stat">
            <b>{{ c.stamps }}</b>
            <small>{{ t('clients.stamps') }}</small>
          </span>
          <span class="cl-stat">
            <b>{{ fmtDate(c.last_visit) || '—' }}</b>
            <small>{{ t('clients.lastVisit') }}</small>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cl-search {
  display: block;
  width: 100%;
  font-family: inherit;
  font-size: 0.94rem;
  padding: 11px 14px;
  margin: 0 0 16px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
}
.cl-search:focus { outline: none; border-color: var(--accent); }

.cl-list { display: flex; flex-direction: column; gap: 10px; }
.cl {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
}
.cl.locked { opacity: 0.5; }
.cl-id { flex: 1; min-width: 0; }
.cl-id strong {
  font-family: 'Rufina', serif;
  font-size: 1.02rem;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cl-age, .cl-locked {
  display: inline-block;
  font-size: 0.72rem;
  color: var(--mut);
  margin-top: 2px;
}
.cl-locked {
  background: var(--danger);
  color: #fff;
  border-radius: 6px;
  padding: 1px 7px;
  margin-left: 6px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 700;
}

.cl-stats {
  display: flex;
  gap: 14px;
  flex: 0 0 auto;
}
.cl-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.cl-stat b {
  font-family: 'Rufina', serif;
  font-size: 1.1rem;
  color: var(--accent);
  line-height: 1;
}
.cl-stat small {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mut);
  margin-top: 4px;
}

.retry { display: block; margin: 14px auto 0; }
</style>
