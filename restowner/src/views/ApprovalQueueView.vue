<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import { listPendingEvents, approveEvent, refuseEvent } from '../lib/events'

const { isModerator } = useAuth()
const { t, locale } = useI18n()

const events = ref([])
const loading = ref(true)
const loadError = ref(false)
const busyId = ref(null)

// Refuse modal state.
const refusing = ref(null)   // the event being refused
const checked = ref([])      // selected default-reason keys
const otherText = ref('')
const REASON_KEYS = ['r1', 'r2', 'r3', 'r4', 'r5']

async function load() {
  loading.value = true
  loadError.value = false
  const watchdog = setTimeout(() => {
    if (loading.value) { loading.value = false; loadError.value = true }
  }, 9000)
  try {
    const { data, error } = await listPendingEvents()
    if (error) throw error
    events.value = data
  } catch (e) {
    loadError.value = true
  } finally {
    clearTimeout(watchdog)
    loading.value = false
  }
}
watch(isModerator, (v) => { if (v) load() }, { immediate: true })

function fmtDate(d) {
  if (!d) return ''
  return new Intl.DateTimeFormat(locale.value, {
    day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(d + 'T00:00:00'))
}

async function onApprove(ev) {
  if (busyId.value) return
  busyId.value = ev.id
  try {
    const { error } = await approveEvent(ev.id)
    if (!error) events.value = events.value.filter((e) => e.id !== ev.id)
  } catch (e) { /* leave it in the queue to retry */ }
  finally { busyId.value = null }
}

function openRefuse(ev) {
  refusing.value = ev
  checked.value = []
  otherText.value = ''
}

async function confirmRefuse() {
  const reasons = checked.value.map((k) => t('refuse.' + k))
  if (otherText.value.trim()) reasons.push(otherText.value.trim())
  if (!reasons.length || busyId.value) return
  const ev = refusing.value
  busyId.value = ev.id
  try {
    const { error } = await refuseEvent(ev.id, reasons.join(' · '))
    if (!error) {
      events.value = events.value.filter((e) => e.id !== ev.id)
      refusing.value = null
    }
  } catch (e) { /* keep the modal open to retry */ }
  finally { busyId.value = null }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('approve.title') }}</h1>
    </div>

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <div v-else-if="loadError" class="empty">
      {{ t('common.loadError') }}
      <button class="btn btn--plain btn--sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <p v-else-if="!events.length" class="empty">{{ t('approve.empty') }}</p>

    <div v-else class="q-list">
      <article v-for="ev in events" :key="ev.id" class="card q-card">
        <div
          class="q-thumb"
          :style="ev.image_url ? { backgroundImage: `url(${ev.image_url})` } : null"
        ></div>
        <div class="q-body">
          <h3>{{ ev.title }}</h3>
          <p class="q-meta">
            {{ t('approve.at') }} <strong>{{ ev.restaurant ? ev.restaurant.name : '—' }}</strong>
            · {{ fmtDate(ev.event_date) }}<template v-if="ev.event_time"> · {{ ev.event_time }}</template>
          </p>
          <p v-if="ev.description" class="q-desc">{{ ev.description }}</p>
        </div>
        <div class="q-actions">
          <button
            class="btn btn--sm"
            :disabled="busyId === ev.id"
            @click="onApprove(ev)"
          >{{ t('approve.approveBtn') }}</button>
          <button
            class="btn btn--danger btn--sm"
            :disabled="busyId === ev.id"
            @click="openRefuse(ev)"
          >{{ t('approve.refuseBtn') }}</button>
        </div>
      </article>
    </div>

    <!-- Refuse modal -->
    <div v-if="refusing" class="r-overlay" @click.self="refusing = null">
      <div class="r-modal card">
        <h3>{{ t('refuse.title') }}</h3>
        <p class="r-intro">{{ t('refuse.intro') }}</p>
        <label v-for="k in REASON_KEYS" :key="k" class="r-reason">
          <input type="checkbox" :value="k" v-model="checked" />
          <span>{{ t('refuse.' + k) }}</span>
        </label>
        <label class="r-other-label">{{ t('refuse.other') }}</label>
        <textarea
          v-model="otherText"
          rows="2"
          :placeholder="t('refuse.otherPlaceholder')"
        ></textarea>
        <div class="r-actions">
          <button class="btn btn--plain full" @click="refusing = null">
            {{ t('common.cancel') }}
          </button>
          <button
            class="btn btn--danger full"
            :disabled="(!checked.length && !otherText.trim()) || busyId"
            @click="confirmRefuse"
          >{{ t('refuse.confirm') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.q-list { display: flex; flex-direction: column; gap: 12px; }
.q-card { padding: 12px; display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
.q-thumb {
  width: 72px; height: 72px; flex: 0 0 auto;
  border-radius: 11px;
  background: #ece4d5 center/cover no-repeat;
}
.q-body { flex: 1; min-width: 0; }
.q-body h3 { font-size: 1.02rem; color: var(--ink); }
.q-meta { font-size: 0.78rem; color: var(--mut); margin-top: 3px; }
.q-meta strong { color: var(--ink); }
.q-desc {
  font-size: 0.82rem; color: var(--mut); margin-top: 6px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.q-actions { display: flex; gap: 8px; width: 100%; }
.q-actions .btn { flex: 1; }
.retry { display: block; margin: 14px auto 0; }

/* Refuse modal */
.r-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(20, 12, 14, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 22px;
}
.r-modal {
  width: 100%; max-width: 380px;
  padding: 22px 20px;
  max-height: 86vh; overflow-y: auto;
}
.r-modal h3 { font-size: 1.25rem; color: var(--accent-dark); }
.r-intro { font-size: 0.84rem; color: var(--mut); margin: 4px 0 14px; }
.r-reason {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 9px 0; font-size: 0.9rem; cursor: pointer;
}
.r-reason input { margin-top: 3px; flex: 0 0 auto; }
.r-other-label {
  display: block; font-size: 0.72rem; font-weight: 700;
  letter-spacing: 0.05em; text-transform: uppercase;
  color: var(--ink); margin: 10px 0 6px;
}
.r-actions { display: flex; gap: 10px; margin-top: 16px; }
.r-actions .full { flex: 1; }
</style>
