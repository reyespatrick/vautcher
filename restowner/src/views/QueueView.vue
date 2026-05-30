<script setup>
// /admin/queue — full visibility into vautcher_scaffold_queue. Lists
// every row grouped by status so root can:
//   - watch what is currently being scaffolded,
//   - see what is still pending,
//   - read the exact error on every failed row,
//   - retry a failed row (re-inserts as pending, kicks the worker),
//   - delete rows that no longer matter.
//
// Polls every 10s while anything is non-terminal.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { supabase } from '../lib/supabase'
import { useDialog } from '../composables/useDialog'

const { t } = useI18n()
const { confirm, alert } = useDialog()

const rows = ref([])
const loading = ref(true)
const loadError = ref(false)
let pollHandle = null

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const { data, error } = await supabase
      .from('vautcher_scaffold_queue')
      .select('id, name, address, website_url, status, restaurant_id, enqueued_at, started_at, finished_at, error')
      .order('enqueued_at', { ascending: false })
    if (error) throw error
    rows.value = data || []
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

const active = computed(() =>
  rows.value.some((r) => r.status === 'pending' || r.status === 'scaffolding')
)
function startPoll() { if (!pollHandle) pollHandle = setInterval(load, 10000) }
function stopPoll() { if (pollHandle) { clearInterval(pollHandle); pollHandle = null } }

onMounted(async () => {
  await load()
  if (active.value) startPoll()
})
onBeforeUnmount(stopPoll)

// Buckets in display order.
const pending = computed(() => rows.value.filter((r) => r.status === 'pending'))
const scaffolding = computed(() => rows.value.filter((r) => r.status === 'scaffolding'))
const done = computed(() => rows.value.filter((r) => r.status === 'done'))
const failed = computed(() => rows.value.filter((r) => r.status === 'failed'))

function fmtTime(s) {
  if (!s) return ''
  try {
    const d = new Date(s)
    return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
  } catch { return s }
}

async function retry(row) {
  const ok = await confirm({
    title: t('queue.retryTitle'),
    body: t('queue.retryBody', { name: row.name }),
    confirmLabel: t('queue.retryConfirm')
  })
  if (!ok) return
  const { error: insErr } = await supabase
    .from('vautcher_scaffold_queue').insert({
      osm_id: null,
      name: row.name,
      address: row.address || null,
      website_url: row.website_url,
      enqueued_by: row.enqueued_by || null
    })
  if (insErr) {
    await alert({ title: t('queue.retryFailed'), body: insErr.message })
    return
  }
  // Kick the worker so the retry doesn't wait up to a minute.
  try { await supabase.functions.invoke('scaffold-queue-advance', { body: {} }) } catch {}
  await load()
  if (active.value) startPoll()
}

async function remove(row) {
  const ok = await confirm({
    title: t('queue.removeTitle'),
    body: t('queue.removeBody', { name: row.name }),
    confirmLabel: t('queue.removeConfirm'),
    danger: true
  })
  if (!ok) return
  await supabase.from('vautcher_scaffold_queue').delete().eq('id', row.id)
  await load()
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('queue.title') }}</h1>
      <p>{{ t('queue.subtitle') }}</p>
    </div>

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>
    <div v-else-if="loadError" class="empty">
      {{ t('common.loadError') }}
      <button class="btn btn--plain btn--sm" @click="load">{{ t('common.retry') }}</button>
    </div>

    <template v-else>
      <p v-if="!rows.length" class="empty">{{ t('queue.empty') }}</p>

      <!-- Scaffolding now -->
      <section v-if="scaffolding.length" class="bucket">
        <h2 class="bucket-h"><span class="dot dot--going"></span>{{ t('queue.bucketScaffolding') }}</h2>
        <ul class="q-list">
          <li v-for="r in scaffolding" :key="r.id" class="card q-row">
            <div class="q-main">
              <strong>{{ r.name }}</strong>
              <span class="q-url">{{ r.website_url }}</span>
              <span class="q-meta">
                {{ t('queue.startedAt', { t: fmtTime(r.started_at) }) }}
              </span>
            </div>
            <RouterLink v-if="r.restaurant_id"
              :to="{ name: 'admin-restaurant', params: { id: r.restaurant_id } }"
              class="btn btn--plain btn--sm">{{ t('queue.viewRestaurant') }}</RouterLink>
          </li>
        </ul>
      </section>

      <!-- Pending -->
      <section v-if="pending.length" class="bucket">
        <h2 class="bucket-h"><span class="dot dot--pending"></span>{{ t('queue.bucketPending', { n: pending.length }) }}</h2>
        <ul class="q-list">
          <li v-for="r in pending" :key="r.id" class="card q-row">
            <div class="q-main">
              <strong>{{ r.name }}</strong>
              <span class="q-url">{{ r.website_url }}</span>
              <span class="q-meta">{{ t('queue.enqueuedAt', { t: fmtTime(r.enqueued_at) }) }}</span>
            </div>
            <button type="button" class="btn btn--plain btn--sm" @click="remove(r)">
              {{ t('queue.remove') }}
            </button>
          </li>
        </ul>
      </section>

      <!-- Failed (the reason root opened this page) -->
      <section v-if="failed.length" class="bucket">
        <h2 class="bucket-h"><span class="dot dot--fail"></span>{{ t('queue.bucketFailed', { n: failed.length }) }}</h2>
        <ul class="q-list">
          <li v-for="r in failed" :key="r.id" class="card q-row q-row--fail">
            <div class="q-main">
              <strong>{{ r.name }}</strong>
              <span class="q-url">{{ r.website_url }}</span>
              <span class="q-meta">{{ t('queue.failedAt', { t: fmtTime(r.finished_at) }) }}</span>
              <p v-if="r.error" class="q-error">{{ r.error }}</p>
            </div>
            <div class="q-actions">
              <button type="button" class="btn btn--primary btn--sm" @click="retry(r)">
                {{ t('queue.retry') }}
              </button>
              <button type="button" class="btn btn--plain btn--sm" @click="remove(r)">
                {{ t('queue.remove') }}
              </button>
              <RouterLink v-if="r.restaurant_id"
                :to="{ name: 'admin-restaurant', params: { id: r.restaurant_id } }"
                class="btn btn--plain btn--sm">{{ t('queue.viewRestaurant') }}</RouterLink>
            </div>
          </li>
        </ul>
      </section>

      <!-- Done — collapsed by default would be nicer, but a short list of cards is fine for now. -->
      <section v-if="done.length" class="bucket">
        <h2 class="bucket-h"><span class="dot dot--done"></span>{{ t('queue.bucketDone', { n: done.length }) }}</h2>
        <ul class="q-list">
          <li v-for="r in done" :key="r.id" class="card q-row q-row--done">
            <div class="q-main">
              <strong>{{ r.name }}</strong>
              <span class="q-meta">{{ t('queue.finishedAt', { t: fmtTime(r.finished_at) }) }}</span>
            </div>
            <div class="q-actions">
              <RouterLink v-if="r.restaurant_id"
                :to="{ name: 'admin-restaurant', params: { id: r.restaurant_id } }"
                class="btn btn--primary btn--sm">{{ t('queue.viewRestaurant') }}</RouterLink>
              <button type="button" class="btn btn--plain btn--sm" @click="remove(r)">
                {{ t('queue.remove') }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <p class="back">
        <RouterLink :to="{ name: 'admin' }" class="btn btn--plain btn--sm">
          {{ t('queue.backToAdmin') }}
        </RouterLink>
      </p>
    </template>
  </div>
</template>

<style scoped>
.bucket { margin-bottom: 22px; }
.bucket-h {
  font-family: 'Rufina', serif; font-size: 1rem; margin: 0 0 10px;
  display: flex; align-items: center; gap: 8px;
}
.dot {
  width: 10px; height: 10px; border-radius: 99px; flex: 0 0 auto;
}
.dot--pending { background: #d2b25a; }
.dot--going   { background: #2c63d8; box-shadow: 0 0 0 0 #2c63d8;
                animation: q-pulse 1.4s ease-out infinite; }
.dot--done    { background: #1f7a3a; }
.dot--fail    { background: #c93636; }
@keyframes q-pulse {
  0% { box-shadow: 0 0 0 0 rgba(44, 99, 216, 0.55); }
  80%, 100% { box-shadow: 0 0 0 8px transparent; }
}

.q-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.q-row { display: flex; gap: 10px; padding: 12px 14px; align-items: flex-start; }
.q-row--done { opacity: 0.85; }
.q-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.q-main strong { font-family: 'Rufina', serif; font-size: 1.02rem; color: var(--ink); }
.q-url { font-size: 0.78rem; color: var(--mut); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-meta { font-size: 0.78rem; color: var(--mut); }
.q-error {
  margin: 6px 0 0; padding: 8px 10px; border-radius: 8px;
  background: #fce5e5; color: #7a1414; font-size: 0.82rem;
  white-space: pre-wrap; word-break: break-word;
}
.q-actions { display: flex; flex-direction: column; gap: 6px; align-items: stretch; flex: 0 0 auto; }

/* Failed rows: the error log is long and stacks the right-side action
   column into a tall empty gutter. Switch to a column layout with a
   button bar across the bottom instead. */
.q-row--fail {
  border-color: #f3c5c5; background: #fff9f9;
  flex-direction: column;
  gap: 8px;
}
.q-row--fail .q-actions {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
}
.q-row--fail .q-actions > * { flex: 1 1 96px; text-align: center; }

.back { margin-top: 16px; text-align: center; }
</style>
