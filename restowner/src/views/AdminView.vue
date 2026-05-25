<script setup>
// Cross-restaurant overview — restaurants and their owners.
// The clients view has moved to its own /clients tab using the shared
// <ClientList /> component, so the segmented control here is gone.
import { ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import { useDialog } from '../composables/useDialog'
import {
  adminRestaurants, createRestaurant,
  setOwnerFlags, setOwnerEmail, provisionOwner, scaffoldTenant, deleteTenant
} from '../lib/admin'

const { t } = useI18n()
const { isModerator } = useAuth()
const { confirm, alert } = useDialog()

const restaurants = ref([])
const loading = ref(true)
const loadError = ref(false)
const busy = ref(false)

// Inline forms
const showNewRestaurant = ref(false)
const newR = ref({ name: '', slug: '' })
const ownerFormFor = ref(null)        // restaurant id with its add-owner form open
const newO = ref({ email: '', name: '' })
const provisionResult = ref(null)     // { email, action_link, code }
const copied = ref(false)

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
    const { data, error } = await adminRestaurants()
    if (error) throw error
    restaurants.value = data
  } catch (e) {
    loadError.value = true
  } finally {
    clearTimeout(watchdog)
    loading.value = false
  }
}
watch(isModerator, (v) => { if (v) load() }, { immediate: true })

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

function openOwnerForm(restaurantId) {
  ownerFormFor.value = restaurantId
  newO.value = { email: '', name: '' }
  provisionResult.value = null
}

async function submitOwner(restaurantId) {
  if (busy.value || !newO.value.email.trim()) return
  busy.value = true
  try {
    const { data, error } = await provisionOwner(
      newO.value.email.trim(), newO.value.name.trim(), restaurantId
    )
    if (error) {
      await alert({ title: t('admin.error'), body: error.message || '' })
      return
    }
    provisionResult.value = data
    ownerFormFor.value = null
    await load()
  } finally {
    busy.value = false
  }
}

async function toggleTrusted(owner) {
  if (busy.value) return
  busy.value = true
  try {
    const next = !owner.trusted
    const { error } = await setOwnerFlags(owner.email, next, owner.locked)
    if (!error) owner.trusted = next
  } finally {
    busy.value = false
  }
}

// Inline email rebind for scaffold-provisioned owners (placeholder
// email starts with "pending+"). One field, one Save button.
const emailFormFor = ref(null)
const emailNew = ref('')
function openEmailForm(owner) {
  emailFormFor.value = owner.email
  emailNew.value = ''
}
async function submitEmailRebind(owner) {
  const next = emailNew.value.trim().toLowerCase()
  if (busy.value || !next) return
  busy.value = true
  try {
    const { error } = await setOwnerEmail(owner.email, next)
    if (error) {
      await alert({ title: t('admin.error'), body: error.message || '' })
      return
    }
    emailFormFor.value = null
    emailNew.value = ''
    await load()
  } finally {
    busy.value = false
  }
}
function isPlaceholderEmail(email) {
  return typeof email === 'string' && email.startsWith('pending+')
}

// ---- DELETE TENANT ----
// One dialog, two confirmations: the moderator has to type "effacer"
// AND tap the danger button. The slug is no longer requested in the
// UI because the user shouldn't have to look it up; the edge function
// re-validates the slug server-side anyway.
const deleteBusy = ref(false)
const deleteDebug = ref('')   // shown only on caught errors

async function startDelete(r) {
  try {
    const counts = (r.owners?.length || 0) + ' propriétaire(s)'
    const ok = await confirm({
      title: t('admin.deleteStep1Title', { name: r.name }),
      body: t('admin.deleteStep1Body', { name: r.name, counts }),
      confirmLabel: t('admin.deleteFinalConfirm'),
      cancelLabel: t('common.keep'),
      danger: true,
      requireText: 'effacer',
      inputLabel: t('admin.deleteTypeToConfirm'),
      inputPlaceholder: 'effacer'
    })
    if (!ok) return

    deleteBusy.value = true
    try {
      const { data, error } = await deleteTenant(r.id, r.slug)
      if (error) {
        await alert({ title: t('admin.error'), body: error.message || '' })
        return
      }
      await load()
      await alert({
        title: t('admin.deleteDoneTitle'),
        body: t('admin.deleteDoneBody', {
          name: data?.name || '',
          events: data?.deleted?.events ?? 0,
          owners: data?.deleted?.owners ?? 0,
          vouchers: data?.deleted?.vouchers ?? 0
        })
      })
    } finally {
      deleteBusy.value = false
    }
  } catch (e) {
    deleteDebug.value = '❌ erreur startDelete: ' + (e && e.message ? e.message : String(e))
    console.error('startDelete threw', e)
  }
}

async function toggleOwnerLock(owner) {
  if (busy.value) return
  busy.value = true
  try {
    const next = !owner.locked
    const { error } = await setOwnerFlags(owner.email, owner.trusted, next)
    if (!error) owner.locked = next
  } finally {
    busy.value = false
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(provisionResult.value.action_link)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* clipboard unavailable */ }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('admin.title') }}</h1>
      <p>{{ t('admin.subtitle') }}</p>
    </div>

    <!-- Temporary diagnostic banner for the "Supprimer does nothing" report.
         Shows whatever startDelete sets — so the user can see whether the
         click handler fired at all and what state confirm() resolved to. -->
    <div v-if="deleteDebug" class="del-debug" role="status">
      <span>🐞 {{ deleteDebug }}</span>
      <button class="del-debug-x" @click="deleteDebug = ''" aria-label="Fermer">×</button>
    </div>

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <div v-else-if="loadError" class="empty">
      {{ t('common.loadError') }}
      <button class="btn btn--plain btn--sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <template v-else>
      <!-- New-owner result panel -->
      <div v-if="provisionResult" class="card prov">
        <strong>{{ t('admin.provisioned') }} — {{ provisionResult.email }}</strong>
        <p>{{ t('admin.provisionedHint') }}</p>
        <code class="prov-link">{{ provisionResult.action_link }}</code>
        <div class="prov-actions">
          <button class="btn btn--sm" @click="copyLink">
            {{ copied ? t('admin.copied') : t('admin.copyLink') }}
          </button>
          <span v-if="provisionResult.code" class="prov-code">
            {{ t('admin.code') }}: <b>{{ provisionResult.code }}</b>
          </span>
        </div>
        <button class="prov-x" @click="provisionResult = null">✕</button>
      </div>

      <!-- ============ Scaffold from URL ============ -->
      <form
        v-if="!scaffoldResult"
        class="card scaffold"
        @submit.prevent="submitScaffold"
      >
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
        <!-- Live status while the edge function + GitHub workflow run.
             scaffoldStatus is the human-readable step we're currently on
             (extraction, DB insert, deploy dispatch, …). The shimmer bar
             below gives the user something to watch instead of a frozen
             button. -->
        <div v-if="scaffoldBusy" class="scaffold-progress" role="status" aria-live="polite">
          <div class="scaffold-progress-bar"><span></span></div>
          <p class="scaffold-progress-step">{{ scaffoldStatus }}</p>
        </div>
        <p v-if="scaffoldError" class="scaffold-err">{{ scaffoldError }}</p>
      </form>

      <div v-else class="card scaffold scaffold--done"
           :class="{ 'scaffold--low': scaffoldResult.quality === 'low',
                     'scaffold--bad': scaffoldResult.quality === 'bad' }">
        <strong>{{ t('admin.scaffoldDone') }} — {{ scaffoldResult.name }}</strong>
        <p class="scaffold-result-meta">
          {{ scaffoldResult.blocks }} {{ t('admin.scaffoldBlocks') }} ·
          {{ scaffoldResult.pages_crawled }} {{ t('admin.scaffoldPages') }}
        </p>
        <code class="prov-link">{{ scaffoldResult.pages_url }}</code>

        <!-- Scraper quality verdict. 'ok' is silent; 'low' shows a yellow
             warning chip; 'bad' shows a red one and the moderator is
             expected to open Configurer immediately. -->
        <div
          v-if="scaffoldResult.quality && scaffoldResult.quality !== 'ok'"
          class="scaffold-quality"
          :class="`scaffold-quality--${scaffoldResult.quality}`"
        >
          <strong>
            {{ scaffoldResult.quality === 'bad'
              ? t('admin.scaffoldQualityBad')
              : t('admin.scaffoldQualityLow') }}
          </strong>
          <ul v-if="scaffoldResult.quality_reasons?.length">
            <li v-for="(r, i) in scaffoldResult.quality_reasons" :key="i">{{ r }}</li>
          </ul>
        </div>

        <!-- Owner claim code — what the moderator hands to the future owner. -->
        <div v-if="scaffoldResult.owner" class="claim-block">
          <span class="claim-label">{{ t('admin.scaffoldCodeLabel') }}</span>
          <code class="claim-code">{{ scaffoldResult.owner.claim_code }}</code>
          <p class="claim-hint">{{ t('admin.scaffoldCodeHint') }}</p>
        </div>

        <div class="prov-actions">
          <span v-if="scaffoldResult.deploy === 'dispatched'" class="badge badge--pending">
            {{ t('admin.scaffoldDeploying') }}
          </span>
          <span v-else class="badge badge--off">{{ t('admin.scaffoldManual') }}</span>
          <a
            v-if="scaffoldResult.deploy_log_url"
            :href="scaffoldResult.deploy_log_url"
            target="_blank" rel="noopener"
            class="prov-code"
          >{{ t('admin.scaffoldLogs') }} ↗</a>
        </div>
        <button class="prov-x" @click="scaffoldResult = null">✕</button>
      </div>

      <button
        v-if="!showNewRestaurant"
        class="btn btn--ghost btn--full create-btn"
        @click="showNewRestaurant = true"
      ><span class="plus">+</span> {{ t('admin.newRestaurant') }}</button>

      <form v-else class="card form-card" @submit.prevent="submitRestaurant">
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
            @click="showNewRestaurant = false">{{ t('admin.cancel') }}</button>
        </div>
      </form>

      <p v-if="!restaurants.length" class="empty">{{ t('admin.empty') }}</p>

      <div v-else class="r-list">
        <div v-for="r in restaurants" :key="r.id" class="card resto">
          <!-- Identity row: name + slug. -->
          <div class="resto-ident">
            <strong>{{ r.name }}</strong>
            <span class="resto-slug">{{ r.slug }}</span>
          </div>

          <!-- Tenant URLs: where it lives (pages.dev) + where it came
               from (the scaffolded source website). Sits above the
               action buttons so it reads "this is the site → here's
               what you can do to it". -->
          <div class="resto-urls">
            <a
              :href="`https://${r.slug}.pages.dev`"
              target="_blank" rel="noopener"
              class="resto-url resto-url--live"
            >
              <span class="ic">🌐</span>{{ r.slug }}.pages.dev
            </a>
            <a
              v-if="r.source_url"
              :href="r.source_url"
              target="_blank" rel="noopener"
              class="resto-url resto-url--src"
            >
              <span class="ic">🔗</span>{{ t('admin.sourceUrl') }}
            </a>
          </div>

          <!-- Action row: full-width strip, Configurer pinned left,
               Supprimer pinned right. -->
          <div class="resto-actions">
            <RouterLink :to="{ name: 'restaurant-config', params: { id: r.id } }"
                        class="btn btn--ghost btn--sm">
              {{ t('config.edit') }}
            </RouterLink>
            <button
              type="button"
              class="btn btn--danger btn--sm"
              :disabled="deleteBusy"
              @click="startDelete(r)"
            >{{ t('admin.deleteBtn') }}</button>
          </div>

          <p v-if="!r.owners.length" class="owners-empty">{{ t('admin.noOwners') }}</p>
          <ul v-else class="owners">
            <li v-for="o in r.owners" :key="o.email" :class="{ locked: o.locked }">
              <div class="owner-id">
                <!-- Scaffold-provisioned: show the claim code, hide the
                     placeholder email, offer an inline rebind. -->
                <template v-if="isPlaceholderEmail(o.email)">
                  <span class="owner-email owner-email--pending">{{ t('admin.emailPending') }}</span>
                  <span v-if="o.claim_code" class="owner-claim">
                    {{ t('admin.codeLabel') }} <code>{{ o.claim_code }}</code>
                  </span>
                </template>
                <template v-else>
                  <span class="owner-email">{{ o.email }}</span>
                </template>
                <span v-if="o.name" class="owner-name">{{ o.name }}</span>

                <!-- Inline rebind form, opened by the "Définir" button. -->
                <form
                  v-if="emailFormFor === o.email"
                  class="owner-rebind"
                  @submit.prevent="submitEmailRebind(o)"
                >
                  <input
                    v-model="emailNew" type="email"
                    :placeholder="t('admin.ownerEmail')"
                    required autofocus
                  />
                  <button class="btn btn--sm" type="submit" :disabled="busy">
                    {{ t('admin.emailSetBtn') }}
                  </button>
                  <button
                    type="button" class="btn btn--plain btn--sm"
                    @click="emailFormFor = null"
                  >{{ t('admin.cancel') }}</button>
                </form>
              </div>
              <div class="owner-flags">
                <button
                  v-if="isPlaceholderEmail(o.email) && emailFormFor !== o.email"
                  class="chip"
                  :disabled="busy"
                  @click="openEmailForm(o)"
                >{{ t('admin.emailDefineBtn') }}</button>
                <button
                  class="chip" :class="{ on: o.trusted }"
                  :disabled="busy" @click="toggleTrusted(o)"
                >{{ t('admin.trusted') }}</button>
                <button
                  class="chip chip--lock" :class="{ on: o.locked }"
                  :disabled="busy" @click="toggleOwnerLock(o)"
                >{{ o.locked ? t('admin.locked') : t('admin.lock') }}</button>
              </div>
            </li>
          </ul>

          <form
            v-if="ownerFormFor === r.id"
            class="owner-form"
            @submit.prevent="submitOwner(r.id)"
          >
            <input v-model="newO.email" type="email" :placeholder="t('admin.ownerEmail')" required />
            <input v-model="newO.name" type="text" :placeholder="t('admin.ownerName')" />
            <div class="form-actions">
              <button class="btn btn--sm" type="submit" :disabled="busy">
                {{ busy ? t('admin.creating') : t('admin.create') }}
              </button>
              <button class="btn btn--plain btn--sm" type="button"
                @click="ownerFormFor = null">{{ t('admin.cancel') }}</button>
            </div>
          </form>
          <button
            v-else
            class="btn btn--ghost btn--sm add-owner"
            @click="openOwnerForm(r.id)"
          >+ {{ t('admin.addOwner') }}</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.retry { display: block; margin: 14px auto 0; }
.create-btn { margin-bottom: 18px; }
.plus { font-size: 1.15rem; font-weight: 700; line-height: 0; }

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

.resto-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.resto-actions .btn { flex: 0 0 auto; }

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
.owner-flags { display: flex; gap: 6px; }
.owner-form { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.add-owner { margin-top: 10px; }

/* Chips */
.chip {
  border: 1px solid var(--line);
  border-radius: 20px;
  background: var(--surface);
  color: var(--mut);
  font-family: inherit;
  font-weight: 700;
  font-size: 0.68rem;
  letter-spacing: 0.03em;
  padding: 6px 12px;
  cursor: pointer;
}
.chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.chip--lock.on { background: var(--danger); border-color: var(--danger); }
.chip:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
