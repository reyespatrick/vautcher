<script setup>
// Cross-restaurant overview — restaurants and their owners.
// The clients view has moved to its own /clients tab using the shared
// <ClientList /> component, so the segmented control here is gone.
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import { useDialog } from '../composables/useDialog'
import {
  adminRestaurants, createRestaurant, scaffoldTenant,
  pendingOwners, approveOwner, rejectOwner
} from '../lib/admin'

const { t } = useI18n()
const { isModerator } = useAuth()
const { confirm, alert } = useDialog()

const restaurants = ref([])
const loading = ref(true)
const loadError = ref(false)
const busy = ref(false)

// Name filter for the restaurant list — case- and accent-insensitive
// substring match. As the cross-restaurant overview grows, this is the
// only way to find a specific tenant quickly on mobile.
const nameFilter = ref('')
function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}
const filteredRestaurants = computed(() => {
  const q = stripDiacritics(nameFilter.value.trim())
  if (!q) return restaurants.value
  return restaurants.value.filter((r) =>
    stripDiacritics(r.name).includes(q) || stripDiacritics(r.slug).includes(q)
  )
})

// Inline forms
const showNewRestaurant = ref(false)
const showManual = ref(false)
const newR = ref({ name: '', slug: '' })

// Per-restaurant + owner management lives in RestaurantDetailView
// (/admin/restaurant/:id). The console + diner-app install QRs live on the
// "Installer les applications" page (ShareView, /share).

// "From URL" scaffolder
const scaffoldUrl = ref('')
const scaffoldBusy = ref(false)
const scaffoldResult = ref(null)      // { id, name, slug, blocks, deploy, deploy_log_url, pages_url }
const scaffoldError = ref('')
const scaffoldStatus = ref('')        // human-readable current step
let scaffoldTickHandle = null

// The edge function call is one network round-trip from the browser's
// perspective, but the function itself runs ~20-60s of work (crawl,
// extract, DB insert, GitHub workflow dispatch). We can't read its
// real progress mid-flight, so we cycle through plausible step labels
// on a timer just to give the moderator something animated to watch.
const SCAFFOLD_STEPS = [
  { at: 0,     key: 'admin.scaffoldStep1' },  // contacting the site
  { at: 4000,  key: 'admin.scaffoldStep2' },  // extracting content
  { at: 10000, key: 'admin.scaffoldStep3' },  // creating the tenant
  { at: 16000, key: 'admin.scaffoldStep4' },  // dispatching the deploy
  { at: 26000, key: 'admin.scaffoldStep5' }   // waiting for pages.dev
]
function startScaffoldTicker() {
  const t0 = Date.now()
  const tick = () => {
    const elapsed = Date.now() - t0
    // Pick the latest step whose `at` is <= elapsed.
    const step = SCAFFOLD_STEPS.reduce(
      (acc, s) => (elapsed >= s.at ? s : acc), SCAFFOLD_STEPS[0]
    )
    scaffoldStatus.value = t(step.key)
  }
  tick()
  scaffoldTickHandle = setInterval(tick, 1000)
}
function stopScaffoldTicker() {
  if (scaffoldTickHandle) clearInterval(scaffoldTickHandle)
  scaffoldTickHandle = null
}

async function submitScaffold() {
  const u = scaffoldUrl.value.trim()
  if (!u || scaffoldBusy.value) return
  scaffoldBusy.value = true
  scaffoldError.value = ''
  scaffoldResult.value = null
  startScaffoldTicker()
  try {
    const { data, error } = await scaffoldTenant(u)
    if (error) {
      scaffoldError.value = error.message || t('admin.error')
      return
    }
    scaffoldResult.value = data
    scaffoldUrl.value = ''
    showNewRestaurant.value = false
    await load()
  } catch (e) {
    scaffoldError.value = (e && e.message) || String(e)
  } finally {
    stopScaffoldTicker()
    scaffoldBusy.value = false
  }
}

async function load() {
  loading.value = true
  loadError.value = false
  const watchdog = setTimeout(() => {
    if (loading.value) { loading.value = false; loadError.value = true }
  }, 9000)
  try {
    const [{ data, error }, { data: pend }] = await Promise.all([
      adminRestaurants(),
      pendingOwners()
    ])
    if (error) throw error
    restaurants.value = data
    pendingList.value = pend || []
  } catch (e) {
    loadError.value = true
  } finally {
    clearTimeout(watchdog)
    loading.value = false
  }
}
watch(isModerator, (v) => { if (v) load() }, { immediate: true })

// Silent background refresh used by the transient-row poll: updates the
// lists in place WITHOUT toggling `loading` (which swaps the list for a
// spinner and yanks the page back to the top every tick). Stable :key by
// id means Vue patches only the rows that actually changed — e.g. a
// skeleton flipping to a live card — instead of re-rendering everything.
async function refreshSilent() {
  try {
    const [{ data, error }, { data: pend }] = await Promise.all([
      adminRestaurants(),
      pendingOwners()
    ])
    if (!error && data) restaurants.value = data
    if (pend) pendingList.value = pend
  } catch (e) { /* keep current data on a transient error */ }
}

// ---- Pending owner requests (self-signups awaiting approval) ----
const pendingList = ref([])
const pendingAssign = ref({})   // email -> restaurant_id picked by root
const pendingBusy = ref('')     // email currently being approved/rejected

async function onApproveOwner(p) {
  const restaurantId = pendingAssign.value[p.email]
  if (!restaurantId) {
    await alert({ title: t('admin.approveTitle'), body: t('admin.approveNeedRestaurant') })
    return
  }
  if (pendingBusy.value) return
  pendingBusy.value = p.email
  try {
    const { error } = await approveOwner(p.email, restaurantId, false)
    if (error) {
      await alert({ title: t('admin.error'), body: error.message || '' })
      return
    }
    delete pendingAssign.value[p.email]
    await load()
  } finally {
    pendingBusy.value = ''
  }
}

async function onRejectOwner(p) {
  if (pendingBusy.value) return
  const ok = await confirm({
    title: t('admin.rejectTitle'),
    body: t('admin.rejectBody', { email: p.email }),
    confirmLabel: t('admin.rejectConfirm'),
    danger: true
  })
  if (!ok) return
  pendingBusy.value = p.email
  try {
    const { error } = await rejectOwner(p.email)
    if (error) {
      await alert({ title: t('admin.error'), body: error.message || '' })
      return
    }
    await load()
  } finally {
    pendingBusy.value = ''
  }
}

// Poll the list while any tenant is still transitioning (scaffolding
// generator running in CI, deploy_status='pending' while build runs).
// The poll stops itself once every row has settled into a terminal
// state ('success', 'failed', 'scaffold_failed', or null/'idle').
const TRANSIENT_STATES = new Set(['scaffolding', 'pending'])
const hasTransientRow = computed(() =>
  restaurants.value.some((r) => TRANSIENT_STATES.has(r.deploy_status))
)
// Live deploy_status of the just-scaffolded row (from the polled list) so
// the result card stops animating once CI finishes — instead of relying on
// the stale `scaffoldResult.scaffold === 'dispatched'` set at trigger time.
const scaffoldRowStatus = computed(() => {
  const id = scaffoldResult.value?.id
  if (!id) return null
  const row = restaurants.value.find((r) => r.id === id)
  return row ? row.deploy_status : null
})
const scaffoldInProgress = computed(() => {
  if (!scaffoldResult.value) return false
  const dispatched = scaffoldResult.value.scaffold === 'dispatched' ||
    scaffoldResult.value.deploy === 'dispatched'
  if (!dispatched) return false
  const st = scaffoldRowStatus.value
  return st === null ? true : TRANSIENT_STATES.has(st)
})
let pollHandle = null
function startPoll() {
  if (pollHandle) return
  pollHandle = setInterval(() => {
    if (!hasTransientRow.value) { stopPoll(); return }
    refreshSilent()
  }, 10000)
}
function stopPoll() {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null }
}
watch(hasTransientRow, (v) => { if (v) startPoll(); else stopPoll() })
onBeforeUnmount(stopPoll)

// Lock background scroll while the new-restaurant dialog is open.
watch(showNewRestaurant, (v) => { document.body.style.overflow = v ? 'hidden' : '' })
onBeforeUnmount(() => { document.body.style.overflow = '' })

async function submitRestaurant() {
  if (busy.value || !newR.value.name.trim() || !newR.value.slug.trim()) return
  busy.value = true
  try {
    const { error } = await createRestaurant(newR.value.name.trim(), newR.value.slug.trim())
    if (error) {
      await alert({ title: t('admin.error'), body: error.message || '' })
      return
    }
    newR.value = { name: '', slug: '' }
    showNewRestaurant.value = false
    await load()
  } finally {
    busy.value = false
  }
}

function openNewDialog() {
  scaffoldUrl.value = ''
  scaffoldError.value = ''
  newR.value = { name: '', slug: '' }
  showManual.value = false
  showNewRestaurant.value = true
}
function closeNewDialog() {
  if (scaffoldBusy.value) return
  showNewRestaurant.value = false
}

// Per-restaurant + owner management now lives in RestaurantDetailView
// (/admin/restaurant/:id). The Admin list only links to it.
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('admin.title') }}</h1>
      <p>{{ t('admin.subtitle') }}</p>
    </div>

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <div v-else-if="loadError" class="empty">
      {{ t('common.loadError') }}
      <button class="btn btn--plain btn--sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <template v-else>
      <!-- ============ Pending owner requests ============ -->
      <section v-if="pendingList.length" class="pending-card card">
        <strong class="pending-h">{{ t('admin.pendingTitle') }}</strong>
        <p class="pending-sub">{{ t('admin.pendingSub') }}</p>
        <div v-for="p in pendingList" :key="p.email" class="pending-row">
          <div class="pending-id">
            <span class="pending-email">{{ p.email }}</span>
            <span v-if="p.name" class="pending-name">{{ p.name }}</span>
          </div>
          <div class="pending-controls">
            <select v-model="pendingAssign[p.email]" class="pending-select">
              <option :value="undefined" disabled>{{ t('admin.approveSelectRestaurant') }}</option>
              <option v-for="r in restaurants" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
            <div class="pending-actions">
              <button class="btn btn--sm" :disabled="pendingBusy === p.email" @click="onApproveOwner(p)">
                {{ t('admin.approveBtn') }}
              </button>
              <button class="btn btn--plain btn--sm" :disabled="pendingBusy === p.email" @click="onRejectOwner(p)">
                {{ t('admin.rejectBtn') }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Trigger — opens the "new restaurant" dialog. -->
      <button
        class="btn btn--ghost btn--full create-btn"
        @click="openNewDialog"
      ><span class="plus">+</span> {{ t('admin.newRestaurant') }}</button>

      <!-- Scaffold result — stays inline once a scaffold is dispatched. -->
      <div v-if="scaffoldResult" class="card scaffold scaffold--done">
        <strong>{{ t('admin.scaffoldDone') }} — {{ scaffoldResult.name }}</strong>
        <p class="scaffold-result-meta">{{ t('admin.scaffoldAsyncHint') }}</p>
        <code class="prov-link">{{ scaffoldResult.pages_url }}</code>

        <!-- Owner claim code — what the moderator hands to the future owner. -->
        <div v-if="scaffoldResult.owner" class="claim-block">
          <span class="claim-label">{{ t('admin.scaffoldCodeLabel') }}</span>
          <code class="claim-code">{{ scaffoldResult.owner.claim_code }}</code>
          <p class="claim-hint">{{ t('admin.scaffoldCodeHint') }}</p>
        </div>

        <div class="prov-actions">
          <span v-if="scaffoldInProgress" class="badge badge--pending badge--pulse">
            <span class="badge-dot" aria-hidden="true"></span>
            {{ t('admin.scaffoldDeploying') }}
          </span>
          <span v-else-if="scaffoldRowStatus === 'success'" class="badge badge--ok">
            ✓ {{ t('admin.scaffoldOnline') }}
          </span>
          <span v-else-if="scaffoldRowStatus === 'scaffold_failed' || scaffoldRowStatus === 'failed'"
                class="badge badge--cancel">{{ t('admin.scaffoldFailedBadge') }}</span>
          <span v-else class="badge badge--off">{{ t('admin.scaffoldManual') }}</span>
          <a
            v-if="scaffoldResult.deploy_log_url"
            :href="scaffoldResult.deploy_log_url"
            target="_blank" rel="noopener"
            class="prov-code"
          >{{ t('admin.scaffoldLogs') }} ↗</a>
        </div>
        <!-- Indeterminate progress bar — only while CI is actually running. -->
        <div
          v-if="scaffoldInProgress"
          class="scaffold-progress"
          role="status" aria-live="polite"
        >
          <div class="scaffold-progress-bar"><span></span></div>
        </div>
        <button class="prov-x" @click="scaffoldResult = null">✕</button>
      </div>

      <!-- ============ New-restaurant dialog ============ -->
      <Teleport to="body">
        <transition name="dlg">
          <div
            v-if="showNewRestaurant"
            class="new-backdrop"
            @click.self="closeNewDialog"
            role="dialog"
            aria-modal="true"
          >
            <div class="new-modal">
              <button
                class="new-x" type="button"
                @click="closeNewDialog" :disabled="scaffoldBusy"
                :aria-label="t('admin.cancel')"
              >✕</button>
              <h3 class="new-modal-title">{{ t('admin.newRestaurant') }}</h3>

              <!-- Primary path: scaffold a tenant from its website URL. -->
              <form class="scaffold-form" @submit.prevent="submitScaffold">
                <strong class="scaffold-title">{{ t('admin.scaffoldTitle') }}</strong>
                <p class="scaffold-hint">{{ t('admin.scaffoldHint') }}</p>
                <div class="scaffold-row">
                  <input
                    v-model="scaffoldUrl"
                    type="text"
                    inputmode="url"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="none"
                    spellcheck="false"
                    class="scaffold-input"
                    :placeholder="t('admin.scaffoldPlaceholder')"
                    :disabled="scaffoldBusy"
                    required
                  />
                  <button
                    class="btn btn--sm scaffold-btn"
                    :class="{ 'scaffold-btn--busy': scaffoldBusy }"
                    type="submit"
                    :disabled="scaffoldBusy || !scaffoldUrl.trim()"
                  >
                    <span v-if="scaffoldBusy" class="spinner" aria-hidden="true"></span>
                    <span class="scaffold-btn-label">
                      {{ scaffoldBusy ? t('admin.scaffoldRunning') : t('admin.scaffoldBtn') }}
                    </span>
                  </button>
                </div>
                <!-- Live status while the edge function + GitHub workflow run. -->
                <div v-if="scaffoldBusy" class="scaffold-progress" role="status" aria-live="polite">
                  <div class="scaffold-progress-bar"><span></span></div>
                  <p class="scaffold-progress-step">{{ scaffoldStatus }}</p>
                </div>
                <p v-if="scaffoldError" class="scaffold-err">{{ scaffoldError }}</p>
              </form>

              <!-- Secondary path: create a blank restaurant manually. -->
              <div class="new-manual">
                <button
                  v-if="!showManual"
                  type="button"
                  class="new-manual-toggle"
                  :disabled="scaffoldBusy"
                  @click="showManual = true"
                >{{ t('admin.manualCreate') }}</button>

                <form v-else class="manual-form" @submit.prevent="submitRestaurant">
                  <div class="field">
                    <label>{{ t('admin.restaurantName') }}</label>
                    <input v-model="newR.name" type="text" required />
                  </div>
                  <div class="field">
                    <label>{{ t('admin.restaurantSlug') }}</label>
                    <input v-model="newR.slug" type="text" required />
                  </div>
                  <div class="form-actions">
                    <button class="btn btn--sm" type="submit" :disabled="busy">
                      {{ t('admin.createRestaurant') }}
                    </button>
                    <button class="btn btn--plain btn--sm" type="button"
                      @click="showManual = false">{{ t('admin.cancel') }}</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </transition>
      </Teleport>

      <p v-if="!restaurants.length" class="empty">{{ t('admin.empty') }}</p>

      <template v-else>
        <div class="r-filter">
          <input
            v-model="nameFilter"
            type="search"
            inputmode="search"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            :placeholder="t('admin.filterPlaceholder')"
            class="r-filter-input"
          />
          <button
            v-if="nameFilter"
            type="button"
            class="r-filter-clear"
            :title="t('admin.filterClear')"
            @click="nameFilter = ''"
          >×</button>
        </div>

        <p v-if="!filteredRestaurants.length" class="empty">{{ t('admin.filterEmpty') }}</p>

        <div v-else class="r-list">
          <RouterLink
            v-for="r in filteredRestaurants"
            :key="r.id"
            :to="{ name: 'admin-restaurant', params: { id: r.id } }"
            class="card resto-row"
          >
          <div class="resto-row-main">
            <strong class="resto-row-name">{{ r.name }}</strong>
            <span class="resto-row-slug">{{ r.slug }}</span>
          </div>
          <span
            v-if="r.deploy_status && r.deploy_status !== 'success'"
            class="resto-state"
            :class="`resto-state--${r.deploy_status}`"
          >{{ t('admin.deployState.' + r.deploy_status) }}</span>
          <span class="resto-row-owners">{{ r.owners.length }}</span>
          <svg class="resto-row-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
          </RouterLink>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.retry { display: block; margin: 14px auto 0; }
.create-btn { margin-bottom: 18px; }
.plus { font-size: 1.15rem; font-weight: 700; line-height: 0; }

/* Name filter — sticks just above the list. */
.r-filter {
  position: relative;
  margin-bottom: 12px;
}
.r-filter-input {
  width: 100%;
  font-family: inherit;
  font-size: 0.95rem;
  padding: 11px 38px 11px 14px;
  border: 1.5px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  color: var(--ink);
  box-sizing: border-box;
}
.r-filter-input:focus { outline: none; border-color: var(--accent); }
.r-filter-input::-webkit-search-cancel-button { display: none; }
.r-filter-clear {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 99px;
  background: var(--line);
  color: var(--ink);
  font-size: 1.1rem;
  line-height: 28px;
  cursor: pointer;
  padding: 0;
}

/* Compact restaurant row — taps through to the detail page. */
.resto-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  margin-bottom: 10px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, transform 0.05s;
}
.resto-row:hover { border-color: var(--accent); }
.resto-row:active { transform: scale(0.995); }
.resto-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.resto-row-name {
  font-family: 'Rufina', serif;
  font-size: 1.05rem;
  color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.resto-row-slug { font-size: 0.78rem; color: var(--mut); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.resto-row-owners {
  flex: 0 0 auto;
  font-size: 0.74rem; font-weight: 700;
  color: var(--mut);
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 20px;
  min-width: 24px; text-align: center;
  padding: 3px 9px;
}
.resto-row-chev { width: 18px; height: 18px; color: var(--mut); flex: 0 0 auto; }

/* ===== Pending owner requests ===== */
.pending-card {
  margin-bottom: 16px;
  border-color: var(--accent);
  background: #fdf3f6;
  padding: 16px 18px;
}
.pending-h {
  display: block;
  color: var(--accent-dark);
  font-family: 'Rufina', serif;
  font-size: 1.02rem;
}
.pending-sub { font-size: 0.8rem; color: var(--mut); margin: 4px 0 12px; line-height: 1.45; }
.pending-row {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 11px 12px;
  margin-bottom: 10px;
}
.pending-row:last-child { margin-bottom: 0; }
.pending-id { display: flex; flex-direction: column; margin-bottom: 9px; }
.pending-email { font-weight: 600; color: var(--ink); font-size: 0.9rem; word-break: break-all; }
.pending-name { font-size: 0.78rem; color: var(--mut); }
.pending-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pending-select {
  flex: 1 1 160px;
  font-family: inherit;
  font-size: 0.88rem;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
  color: var(--ink);
}
.pending-actions { display: flex; gap: 8px; flex: 0 0 auto; }

/* ===== New-restaurant dialog ===== */
.new-backdrop {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: rgba(20, 12, 14, 0.55);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.new-modal {
  position: relative;
  width: 100%;
  max-width: 420px;
  max-height: 90vh;
  overflow-y: auto;
  background: var(--surface);
  border-radius: 16px;
  padding: 22px 20px 20px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.34);
  border-top: 4px solid var(--accent);
}
.new-modal-title {
  font-family: 'Rufina', serif;
  font-size: 1.15rem;
  color: var(--ink);
  margin: 0 0 14px;
}
.new-x {
  position: absolute;
  top: 12px;
  right: 14px;
  border: 0;
  background: none;
  color: var(--mut);
  font-size: 1.05rem;
  line-height: 1;
  cursor: pointer;
  padding: 4px;
}
.new-x:disabled { opacity: 0.4; cursor: not-allowed; }
.scaffold-form { display: block; }
.new-manual {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
.new-manual-toggle {
  font-family: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--accent);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.new-manual-toggle:disabled { opacity: 0.4; cursor: not-allowed; }

/* Dialog fade/scale transition (mirrors AppDialog's). */
.dlg-enter-active, .dlg-leave-active { transition: opacity 0.18s; }
.dlg-enter-from, .dlg-leave-to { opacity: 0; }
.dlg-enter-active .new-modal, .dlg-leave-active .new-modal {
  transition: transform 0.22s cubic-bezier(0.18, 1.2, 0.4, 1);
}
.dlg-enter-from .new-modal { transform: translateY(14px) scale(0.97); }
.dlg-leave-to .new-modal { transform: translateY(8px); }

/* ===== Scaffolding skeleton (transient restaurant rows) ===== */
.skel-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0 8px;
}
.skel-line {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, #f0e7ea 25%, #faf4ea 37%, #f0e7ea 63%);
  background-size: 400% 100%;
  animation: skelShimmer 1.4s ease-in-out infinite;
}
.skel-line--short { width: 55%; }
.skel-note {
  font-size: 0.8rem;
  color: var(--mut);
  margin: 0;
}
@keyframes skelShimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: 0 0; }
}

/* Provisioned-owner result */
.prov {
  position: relative;
  padding: 16px 18px;
  margin-bottom: 16px;
  border-color: var(--accent);
  background: #fdf3f6;
}
.prov strong { color: var(--accent-dark); display: block; }
.prov p { font-size: 0.8rem; color: var(--mut); margin: 6px 0 8px; }
.prov-link {
  display: block;
  font-size: 0.7rem;
  word-break: break-all;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
}
.prov-actions { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.prov-code { font-size: 0.8rem; color: var(--mut); }
.prov-code b { color: var(--ink); letter-spacing: 0.08em; }
.prov-x {
  position: absolute; top: 10px; right: 12px;
  border: 0; background: none; color: var(--mut);
  font-size: 1rem; cursor: pointer;
}

/* Forms */
.form-card { padding: 16px 18px; margin-bottom: 18px; }

/* "Scaffold from URL" card */
.scaffold {
  position: relative;
  padding: 16px 18px;
  margin-bottom: 16px;
}
.scaffold-title {
  font-family: 'Rufina', serif;
  font-size: 1.02rem;
  color: var(--ink);
  display: block;
}
.scaffold-hint {
  font-size: 0.8rem;
  color: var(--mut);
  margin: 4px 0 12px;
  line-height: 1.45;
}
.scaffold-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.scaffold-input {
  flex: 1 1 auto;
  font-family: inherit;
  font-size: 0.92rem;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
}
.scaffold-input:focus { outline: none; border-color: var(--accent); }
.scaffold-input:disabled { opacity: 0.6; }
.scaffold-btn { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 8px; }
.scaffold-btn--busy { animation: scaffoldPulse 1.6s ease-in-out infinite; }
.scaffold-btn-label::after {
  content: '';
}
.scaffold-btn--busy .scaffold-btn-label::after {
  content: '';
  display: inline-block;
  width: 1.2em;
  text-align: left;
  animation: scaffoldDots 1.4s steps(4, end) infinite;
}
@keyframes scaffoldDots {
  0%   { content: ''; }
  25%  { content: '.'; }
  50%  { content: '..'; }
  75%  { content: '...'; }
  100% { content: ''; }
}
@keyframes scaffoldPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(158, 5, 61, 0.35); }
  50%      { box-shadow: 0 0 0 6px rgba(158, 5, 61, 0); }
}

/* Inline spinner that sits before the button label while busy. */
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  display: inline-block;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Live status block below the row — shimmer bar + step label. */
.scaffold-progress {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.scaffold-progress-bar {
  position: relative;
  height: 4px;
  background: rgba(158, 5, 61, 0.12);
  border-radius: 2px;
  overflow: hidden;
}
.scaffold-progress-bar span {
  position: absolute;
  top: 0;
  left: -40%;
  height: 100%;
  width: 40%;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: scaffoldShimmer 1.4s ease-in-out infinite;
}
@keyframes scaffoldShimmer {
  0%   { left: -40%; }
  100% { left: 100%; }
}
.scaffold-progress-step {
  font-size: 0.84rem;
  color: var(--mut);
  margin: 0;
  transition: opacity 0.3s;
}
.scaffold-err {
  margin-top: 8px;
  color: var(--danger);
  font-size: 0.82rem;
  font-weight: 600;
}
.scaffold--done { background: #fdf3f6; border-color: var(--accent); }
.scaffold--low { background: #fff7d5; border-color: #f3d96b; }
.scaffold--bad { background: #ffe6e6; border-color: var(--danger); }
.scaffold-quality {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 0.84rem;
  line-height: 1.45;
}
.scaffold-quality--low { background: rgba(243, 217, 107, 0.25); color: #6e5006; }
.scaffold-quality--bad { background: rgba(220, 38, 38, 0.12); color: #6b1010; }
.scaffold-quality ul { margin: 6px 0 0 18px; }
.scaffold-quality li { font-size: 0.78rem; }

.scaffold-ai {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(56, 132, 255, 0.10);
  color: #1c3d6e;
  font-size: 0.84rem;
  line-height: 1.45;
}
.scaffold-ai .ai-rejected { color: #6b1010; margin-top: 4px; }
.ai-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: 4px;
  vertical-align: middle;
}
.ai-chip {
  display: inline-block;
  padding: 2px 8px;
  font-size: 0.72rem;
  font-weight: 700;
  background: rgba(56, 132, 255, 0.18);
  border-radius: 999px;
  color: #1c3d6e;
}
.ai-chip--bad { background: rgba(220, 38, 38, 0.18); color: #6b1010; }
.scaffold-result-meta {
  font-size: 0.8rem;
  color: var(--mut);
  margin: 6px 0 10px;
}

/* Owner claim-code block inside the scaffold result */
.claim-block {
  margin-top: 12px;
  padding: 12px 14px;
  background: #fff;
  border: 1px dashed var(--accent);
  border-radius: 10px;
}
.claim-label {
  display: block;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mut);
}
.claim-code {
  display: block;
  font-family: 'Rufina', serif;
  font-size: 1.6rem;
  letter-spacing: 0.22em;
  color: var(--accent-dark);
  text-align: center;
  padding: 8px 0 6px;
  user-select: all;
}
.claim-hint {
  font-size: 0.74rem;
  color: var(--mut);
  margin: 0;
  line-height: 1.45;
}

/* Owner-row placeholder rendering */
.owner-email--pending {
  font-style: italic;
  color: var(--mut);
}
.owner-claim {
  display: block;
  font-size: 0.72rem;
  color: var(--mut);
  margin-top: 2px;
}
.owner-claim code {
  font-family: 'Rufina', serif;
  font-weight: 700;
  font-size: 0.86rem;
  letter-spacing: 0.18em;
  color: var(--accent-dark);
  margin-left: 4px;
}
.owner-rebind {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.owner-rebind input {
  flex: 1 1 200px;
  font-family: inherit;
  font-size: 0.86rem;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.form-actions { display: flex; gap: 8px; margin-top: 4px; }

/* Restaurants */
.r-list { display: flex; flex-direction: column; gap: 12px; }
.resto { padding: 14px 16px; }
/* Stacked layout, in order:
   1. .resto-ident — name + slug
   2. .resto-urls  — pages.dev + source link chips
   3. .resto-actions — full-width strip with Configurer left, Supprimer right */
.resto-ident {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  margin-bottom: 10px;
}
.resto-ident strong { font-family: 'Rufina', serif; font-size: 1.1rem; }
.resto-slug { font-size: 0.74rem; color: var(--mut); }
.resto-state {
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 999px;
  white-space: nowrap;
}
.resto-state--scaffolding {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(110deg, #fbeec4 25%, #f7e3a0 45%, #fbeec4 65%);
  color: #6e5414;
  background-size: 220% 100%;
  animation: state-shimmer 2.4s linear infinite;
}
.resto-state--scaffolding::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #b8902f;
  box-shadow: 0 0 0 0 rgba(184, 144, 47, 0.55);
  animation: state-blink 1.4s ease-in-out infinite;
}
.resto-state--pending {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(120, 120, 120, 0.18);
  color: #444;
}
.resto-state--pending::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #555;
  animation: state-blink 1.4s ease-in-out infinite;
}
@keyframes state-blink {
  0%, 100% { opacity: 0.35; box-shadow: 0 0 0 0 rgba(0, 0, 0, 0); }
  50%      { opacity: 1;    box-shadow: 0 0 0 5px rgba(184, 144, 47, 0); }
}
.resto-state--scaffold_failed,
.resto-state--failed {
  background: rgba(220, 38, 38, 0.12);
  color: #6b1010;
}
.resto-state--idle {
  background: rgba(0, 0, 0, 0.07);
  color: var(--mut);
}
@keyframes state-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.resto-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.resto-actions .btn { flex: 0 0 auto; }
/* Danger action drifts to the end of the row, wrapping below when the
   four buttons no longer fit one line (narrow phones). */
.resto-actions .btn--danger { margin-left: auto; }

/* URL chips under the restaurant title — pages.dev (always) +
   scaffolded source URL (only when present). */
.resto-urls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 4px;
}
.resto-url {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--mut);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 4px 10px;
  text-decoration: none;
  transition: border-color 0.15s, color 0.15s;
}
.resto-url:hover { border-color: var(--accent); color: var(--accent); }
.resto-url .ic { font-size: 0.84rem; }
.resto-url--live { color: var(--accent); border-color: rgba(158, 5, 61, 0.25); }

/* Two-step delete confirmation inside the restaurant card */
.resto-del { margin-left: 6px; }

/* Temporary diagnostic strip for the Supprimer-does-nothing debug. */
.del-debug {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fff7d5;
  border: 1px solid #f3d96b;
  border-radius: 10px;
  padding: 10px 12px;
  margin: 10px 0 16px;
  font-size: 0.85rem;
  color: #6e5006;
  word-break: break-word;
}
.del-debug span { flex: 1; }
.del-debug-x {
  background: transparent;
  border: 0;
  font-size: 1.2rem;
  line-height: 1;
  color: #6e5006;
  cursor: pointer;
  padding: 0 4px;
}
.owners { list-style: none; margin: 10px 0 4px; }
.owners-empty { font-size: 0.8rem; color: var(--mut); margin: 8px 0 4px; }
.owners li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 0;
  border-top: 1px solid var(--line);
  flex-wrap: wrap;
}
.owners li.locked { opacity: 0.6; }
.owner-id { min-width: 0; }
.owner-email { display: block; font-size: 0.84rem; font-weight: 600; word-break: break-all; }
.owner-name { font-size: 0.74rem; color: var(--mut); }
.owner-flags { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
.owner-form { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.add-owner { margin-top: 10px; }

/* Chips */
.chip {
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  color: var(--mut);
  font-family: inherit;
  font-weight: 700;
  font-size: 0.7rem;
  letter-spacing: 0.02em;
  line-height: 1;
  white-space: nowrap;
  padding: 8px 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.chip:hover:not(:disabled):not(.on) { border-color: var(--accent); color: var(--accent); }

/* Active toggle (e.g. menu currently hidden) on an action button. */
.btn--on { background: var(--accent) !important; color: #fff !important; border-color: var(--accent) !important; }
.chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.chip--lock.on { background: var(--danger); border-color: var(--danger); }
.chip:disabled { opacity: 0.5; cursor: not-allowed; }

/* Install-the-app card */
.install-card { display: flex; gap: 18px; align-items: center; padding: 16px 18px; }
.install-info { flex: 1; min-width: 0; }
.install-h { font-family: 'Rufina', serif; font-size: 1.05rem; color: var(--accent); margin-bottom: 6px; }
.install-hint { font-size: 0.85rem; color: var(--mut); line-height: 1.45; }
.install-link { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.install-link code {
  font-size: 0.78rem; color: var(--ink); background: var(--bg);
  border: 1px solid var(--line); border-radius: 8px; padding: 6px 9px;
  word-break: break-all;
}
.install-qr {
  flex: 0 0 auto; width: 118px; height: 118px; border-radius: 12px;
  background: #fff; border: 1px solid var(--line); padding: 7px; display: block;
}
.install-qr img { width: 100%; height: 100%; display: block; }
@media (max-width: 460px) {
  .install-card { flex-direction: column-reverse; align-items: stretch; }
  .install-qr { align-self: center; }
}

/* Durable access code */
.code-big {
  font-family: 'Rufina', serif; font-size: 2rem; font-weight: 700; letter-spacing: 0.14em;
  color: var(--accent); background: var(--bg); border: 1px dashed var(--accent);
  border-radius: 12px; padding: 12px; text-align: center; margin: 6px 0 4px;
}
.code-url { font-size: 0.8rem; color: var(--mut); margin-top: 10px; }
.code-url code { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; }
.full { width: 100%; }
.owner-hint { display: block; font-size: 0.76rem; color: var(--mut); margin: 8px 0 4px; line-height: 1.4; }
.owner-adv { margin-top: 12px; }
.owner-adv summary { font-size: 0.8rem; color: var(--accent); cursor: pointer; font-weight: 600; }
.owner-adv input { margin-top: 10px; }
</style>
