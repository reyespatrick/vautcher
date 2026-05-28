<script setup>
// List of diners who have RSVPed to one event. Owner / moderator only.
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getEvent, eventAttendees } from '../lib/events'
import BackBar from '../components/BackBar.vue'

const route = useRoute()
const { t, locale } = useI18n()

const event = ref(null)
const attendees = ref([])
const loading = ref(true)
const loadError = ref(false)
const query = ref('')

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const [{ data: ev }, { data, error }] = await Promise.all([
      getEvent(route.params.id),
      eventAttendees(route.params.id)
    ])
    if (error) throw error
    event.value = ev
    attendees.value = data
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => route.params.id, load)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return attendees.value
  return attendees.value.filter((c) => (c.name || '').toLowerCase().includes(q))
})

function fmtDate(d) {
  if (!d) return ''
  return new Intl.DateTimeFormat(locale.value, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(d))
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
    <BackBar
      :to="{ name: 'event-detail', params: { id: route.params.id } }"
      :label="t('attendees.title')"
    />

    <div class="page-head">
      <p v-if="!loading && !loadError">
        <strong>{{ attendees.length }}</strong>
        {{ attendees.length === 1 ? t('event.attendeesOne') : t('event.attendeesMany') }}
      </p>
    </div>

    <input
      v-if="attendees.length > 1"
      v-model="query"
      type="search"
      class="att-search"
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

    <p v-else-if="!attendees.length" class="empty">{{ t('attendees.empty') }}</p>

    <p v-else-if="!filtered.length" class="empty">{{ t('clients.noMatch') }}</p>

    <div v-else class="att-list">
      <div
        v-for="c in filtered"
        :key="c.id"
        class="card att"
        :class="{ locked: c.locked }"
      >
        <div class="att-id">
          <strong>{{ c.name || '—' }}</strong>
          <div class="att-meta">
            <span v-if="age(c.birth_date) != null">{{ t('clients.ageYears', { n: age(c.birth_date) }) }}</span>
            <span v-if="c.locked" class="att-locked">{{ t('clients.locked') }}</span>
          </div>
        </div>
        <div class="att-when">
          <small>{{ t('attendees.rsvpedAt') }}</small>
          <span>{{ fmtDate(c.rsvped_at) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-head h1 { margin-bottom: 4px; }
.page-head p { color: var(--mut); font-size: 0.92rem; margin-bottom: 14px; }
.page-head strong {
  font-family: 'Rufina', serif;
  font-size: 1.05rem;
  color: var(--accent);
  margin-right: 4px;
}

.att-search {
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
.att-search:focus { outline: none; border-color: var(--accent); }

.att-list { display: flex; flex-direction: column; gap: 10px; }
.att {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
}
.att.locked { opacity: 0.55; }
.att-id { flex: 1; min-width: 0; }
.att-id strong {
  font-family: 'Rufina', serif;
  font-size: 1.02rem;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.att-meta { display: flex; gap: 8px; align-items: center; margin-top: 2px; }
.att-meta span { font-size: 0.72rem; color: var(--mut); }
.att-locked {
  background: var(--danger);
  color: #fff !important;
  border-radius: 6px;
  padding: 1px 7px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 700;
}

.att-when {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
  flex: 0 0 auto;
}
.att-when small {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mut);
}
.att-when span {
  font-size: 0.84rem;
  color: var(--ink);
  margin-top: 2px;
}

.retry { display: block; margin: 14px auto 0; }
</style>
