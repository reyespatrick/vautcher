<script setup>
// Per-restaurant management detail page. Reached from the Admin list.
// Holds everything that used to live in the Admin card: URLs, actions
// (configure / regenerate / hide-menu / delete) and the owners list with
// per-owner management (trust, lock, code, e-mail rebind, add owner).
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDialog } from '../composables/useDialog'
import BackBar from '../components/BackBar.vue'
import {
  adminRestaurants, rescaffoldTenant, deleteTenant, setMenuHidden,
  setOwnerFlags, createOwnerCode, regenerateOwnerCode, provisionOwner
} from '../lib/admin'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { confirm, alert } = useDialog()

const r = ref(null)
const loading = ref(true)
const loadError = ref(false)
const busy = ref(false)
const regenBusy = ref(false)
const menuBusy = ref(false)
const deleteBusy = ref(false)

const TRANSIENT = new Set(['scaffolding', 'pending'])
const isTransient = computed(() => !!r.value && TRANSIENT.has(r.value.deploy_status))
const activateUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/activer'

async function load() {
  try {
    const { data, error } = await adminRestaurants()
    if (error) throw error
    r.value = (data || []).find((x) => x.id === route.params.id) || null
    loadError.value = !r.value
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
load()

// Silent poll while the site is still scaffolding/deploying.
let pollHandle = null
watch(isTransient, (v) => {
  if (v && !pollHandle) {
    pollHandle = setInterval(load, 8000)
  } else if (!v && pollHandle) {
    clearInterval(pollHandle); pollHandle = null
  }
}, { immediate: true })
onBeforeUnmount(() => { if (pollHandle) clearInterval(pollHandle) })

function isPlaceholderEmail(email) {
  return typeof email === 'string' &&
    (email.startsWith('pending+') || email.endsWith('.vautcher.local'))
}

async function onToggleMenuHidden() {
  if (menuBusy.value || !r.value) return
  menuBusy.value = true
  try {
    const { error } = await setMenuHidden(r.value.id, !r.value.menu_hidden)
    if (error) { await alert({ title: t('admin.error'), body: error.message || '' }); return }
    await load()
  } finally { menuBusy.value = false }
}

async function startRegenerate() {
  if (regenBusy.value || !r.value) return
  if (!r.value.source_url) {
    await alert({ title: t('admin.regenerate'), body: t('admin.regenerateNoSource') })
    return
  }
  const ok = await confirm({
    title: t('admin.regenerateTitle', { name: r.value.name }),
    body: t('admin.regenerateBody'),
    confirmLabel: t('admin.regenerateConfirm')
  })
  if (!ok) return
  regenBusy.value = true
  try {
    const { error } = await rescaffoldTenant(r.value.id)
    if (error) { await alert({ title: t('admin.error'), body: error.message || '' }); return }
    await load()
  } finally { regenBusy.value = false }
}

async function startDelete() {
  if (!r.value) return
  const counts = (r.value.owners?.length || 0) + ' propriétaire(s)'
  const ok = await confirm({
    title: t('admin.deleteStep1Title', { name: r.value.name }),
    body: t('admin.deleteStep1Body', { name: r.value.name, counts }),
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
    const { data, error } = await deleteTenant(r.value.id, r.value.slug)
    if (error) { await alert({ title: t('admin.error'), body: error.message || '' }); return }
    await alert({
      title: t('admin.deleteDoneTitle'),
      body: t('admin.deleteDoneBody', {
        name: data?.name || '',
        events: data?.deleted?.events ?? 0,
        owners: data?.deleted?.owners ?? 0,
        vouchers: data?.deleted?.vouchers ?? 0
      })
    })
    router.push({ name: 'admin' })
  } finally { deleteBusy.value = false }
}

async function toggleTrusted(o) {
  if (busy.value) return
  busy.value = true
  try {
    const next = !o.trusted
    const { error } = await setOwnerFlags(o.email, next, o.locked)
    if (!error) o.trusted = next
  } finally { busy.value = false }
}

async function toggleOwnerLock(o) {
  if (busy.value) return
  busy.value = true
  try {
    const next = !o.locked
    const { error } = await setOwnerFlags(o.email, o.trusted, next)
    if (!error) o.locked = next
  } finally { busy.value = false }
}

// Owner access code (re)issue + result panel.
const codeResult = ref(null)
const codeCopied = ref(false)
async function copyCode() {
  try {
    await navigator.clipboard.writeText(codeResult.value.code)
    codeCopied.value = true
    setTimeout(() => { codeCopied.value = false }, 1500)
  } catch (e) { /* ignore */ }
}
async function regenOwnerCode(o) {
  if (busy.value) return
  const ok = await confirm({
    title: t('admin.regenCode'),
    body: t('admin.regenCodeConfirm'),
    confirmLabel: t('admin.regenCode'),
    cancelLabel: t('admin.cancel')
  })
  if (!ok) return
  busy.value = true
  try {
    const { data, error } = await regenerateOwnerCode(o.email)
    if (error) { await alert({ title: t('admin.error'), body: error.message || '' }); return }
    codeResult.value = data
    await load()
  } finally { busy.value = false }
}

// Add owner.
const showAddOwner = ref(false)
const newO = ref({ email: '', name: '' })
function openOwnerForm() { showAddOwner.value = true; newO.value = { email: '', name: '' } }
async function genOwnerCode() {
  if (busy.value || !r.value) return
  busy.value = true
  try {
    const { data, error } = await createOwnerCode(r.value.id, newO.value.name.trim())
    if (error) { await alert({ title: t('admin.error'), body: error.message || '' }); return }
    codeResult.value = data
    showAddOwner.value = false
    await load()
  } finally { busy.value = false }
}
async function submitOwner() {
  if (busy.value || !r.value || !newO.value.email.trim()) return
  busy.value = true
  try {
    const { error } = await provisionOwner(newO.value.email.trim(), newO.value.name.trim(), r.value.id)
    if (error) { await alert({ title: t('admin.error'), body: error.message || '' }); return }
    showAddOwner.value = false
    await load()
  } finally { busy.value = false }
}
</script>

<template>
  <div class="page">
    <BackBar :to="{ name: 'admin' }" :label="r ? r.name : t('admin.tabRestaurants')" />

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>
    <div v-else-if="loadError || !r" class="empty">
      {{ t('admin.empty') }}
      <RouterLink :to="{ name: 'admin' }" class="btn btn--plain btn--sm retry">← {{ t('admin.tabRestaurants') }}</RouterLink>
    </div>

    <template v-else>
      <div class="card detail">
        <div class="resto-ident">
          <strong class="d-name">{{ r.name }}</strong>
          <span class="resto-slug">{{ r.slug }}</span>
          <span
            v-if="r.deploy_status && r.deploy_status !== 'success'"
            class="resto-state" :class="`resto-state--${r.deploy_status}`"
          >{{ t('admin.deployState.' + r.deploy_status) }}</span>
        </div>

        <div class="resto-urls">
          <a :href="`https://${r.slug}.pages.dev`" target="_blank" rel="noopener" class="resto-url resto-url--live">
            <span class="ic">🌐</span>{{ r.slug }}.pages.dev
          </a>
          <a v-if="r.source_url" :href="r.source_url" target="_blank" rel="noopener" class="resto-url resto-url--src">
            <span class="ic">🔗</span>{{ t('admin.sourceUrl') }}
          </a>
        </div>

        <!-- While the site is generating: skeleton + only Regenerer stays
             usable (so a stuck run can be re-triggered). -->
        <template v-if="isTransient">
          <div class="skel-block" aria-hidden="true">
            <span class="skel-line"></span>
            <span class="skel-line skel-line--short"></span>
          </div>
          <p class="skel-note">{{ t('admin.scaffoldRowPending') }}</p>
        </template>

        <div class="resto-actions">
          <RouterLink v-if="!isTransient" :to="{ name: 'restaurant-config', params: { id: r.id } }" class="btn btn--ghost btn--sm">
            {{ t('config.edit') }}
          </RouterLink>
          <button v-else type="button" class="btn btn--ghost btn--sm" disabled>{{ t('config.edit') }}</button>
          <button v-if="r.source_url" type="button" class="btn btn--ghost btn--sm"
            :disabled="regenBusy || deleteBusy" @click="startRegenerate">
            {{ t('admin.regenerate') }}
          </button>
          <button type="button" class="btn btn--ghost btn--sm" :class="{ 'btn--on': r.menu_hidden }"
            :disabled="menuBusy || isTransient" @click="onToggleMenuHidden">
            {{ r.menu_hidden ? t('admin.menuShow') : t('admin.menuHide') }}
          </button>
          <button type="button" class="btn btn--danger btn--sm" :disabled="deleteBusy || isTransient" @click="startDelete">
            {{ t('admin.deleteBtn') }}
          </button>
        </div>
      </div>

      <!-- Owner access-code result -->
      <div v-if="codeResult" class="card prov">
        <strong>{{ t('admin.codeCreated') }}</strong>
        <p>{{ t('admin.codeCreatedHint') }}</p>
        <div class="code-big">{{ codeResult.code }}</div>
        <div class="prov-actions">
          <button class="btn btn--sm" @click="copyCode">{{ codeCopied ? t('admin.copied') : t('admin.copyCode') }}</button>
        </div>
        <p class="code-url">{{ t('admin.codeActivateAt') }} <code>{{ activateUrl }}</code></p>
        <button class="prov-x" @click="codeResult = null">✕</button>
      </div>

      <!-- Owners -->
      <h2 class="owners-h">{{ t('admin.tabClients') ? 'Propriétaires' : 'Propriétaires' }}</h2>
      <p v-if="!r.owners.length" class="owners-empty">{{ t('admin.noOwners') }}</p>
      <ul v-else class="owners">
        <li v-for="o in r.owners" :key="o.email" class="card owner-card" :class="{ locked: o.locked }">
          <div class="owner-id">
            <template v-if="isPlaceholderEmail(o.email)">
              <span class="owner-email">{{ o.name || 'admin' }}</span>
              <span v-if="o.claim_code" class="owner-claim">{{ t('admin.codeLabel') }} <code>{{ o.claim_code }}</code></span>
            </template>
            <template v-else>
              <span class="owner-email">{{ o.email }}</span>
              <span v-if="o.name" class="owner-name">{{ o.name }}</span>
            </template>
          </div>
          <div class="owner-flags">
            <button class="chip" :class="{ on: o.trusted }" :disabled="busy" @click="toggleTrusted(o)">{{ t('admin.trusted') }}</button>
            <button class="chip chip--lock" :class="{ on: o.locked }" :disabled="busy" @click="toggleOwnerLock(o)">
              {{ o.locked ? t('admin.locked') : t('admin.lock') }}
            </button>
            <button class="chip" :disabled="busy" @click="regenOwnerCode(o)">{{ t('admin.regenCode') }}</button>
          </div>
        </li>
      </ul>

      <form v-if="showAddOwner" class="card owner-form" @submit.prevent="submitOwner">
        <input v-model="newO.name" type="text" :placeholder="t('admin.ownerName')" />
        <button class="btn btn--sm full" type="button" :disabled="busy" @click="genOwnerCode">
          {{ busy ? t('admin.creating') : t('admin.genCode') }}
        </button>
        <span class="owner-hint">{{ t('admin.genCodeHint') }}</span>
        <details class="owner-adv">
          <summary>{{ t('admin.orByEmail') }}</summary>
          <input v-model="newO.email" type="email" :placeholder="t('admin.ownerEmail')" />
          <button class="btn btn--plain btn--sm full" type="submit" :disabled="busy || !newO.email.trim()">
            {{ busy ? t('admin.creating') : t('admin.create') }}
          </button>
        </details>
        <div class="form-actions">
          <button class="btn btn--plain btn--sm" type="button" @click="showAddOwner = false">{{ t('admin.cancel') }}</button>
        </div>
      </form>
      <button v-else class="btn btn--ghost btn--full add-owner" @click="openOwnerForm">+ {{ t('admin.addOwner') }}</button>
    </template>
  </div>
</template>

<style scoped>
.detail { padding: 16px 18px; margin-bottom: 14px; }
.resto-ident { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.d-name { font-family: 'Rufina', serif; font-size: 1.25rem; color: var(--ink); }
.resto-slug { font-size: 0.8rem; color: var(--mut); }
.resto-state {
  font-size: 0.66rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 20px; background: var(--paper); color: var(--mut); border: 1px solid var(--line);
}
.resto-state--scaffolding, .resto-state--pending { background: #fff7d5; color: #6e5006; border-color: #f3d96b; }
.resto-state--failed, .resto-state--scaffold_failed { background: #ffe6e6; color: #6b1010; border-color: var(--danger); }

.resto-urls { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
.resto-url {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 0.8rem; font-weight: 600; color: var(--accent);
  background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 6px 12px; text-decoration: none;
}
.resto-url .ic { font-size: 0.9rem; }
.resto-url--src { color: var(--mut); }

.resto-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; padding-top: 14px; border-top: 1px solid var(--line); }
.resto-actions .btn--danger { margin-left: auto; }
.btn--on { background: var(--accent) !important; color: #fff !important; border-color: var(--accent) !important; }
.skel-note { font-size: 0.8rem; color: var(--mut); margin: 8px 0 0; }
.skel-block { display: flex; flex-direction: column; gap: 8px; margin: 12px 0 0; }
.skel-line {
  height: 12px; border-radius: 6px;
  background: linear-gradient(90deg, #f0e7ea 25%, #faf4ea 37%, #f0e7ea 63%);
  background-size: 400% 100%;
  animation: skelShimmer 1.4s ease-in-out infinite;
}
.skel-line--short { width: 55%; }
@keyframes skelShimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }

.owners-h { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mut); margin: 18px 0 8px; }
.owners-empty { color: var(--mut); font-size: 0.88rem; margin: 4px 0 12px; }
.owners { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.owner-card { padding: 13px 15px; }
.owner-card.locked { opacity: 0.75; }
.owner-id { display: flex; flex-direction: column; gap: 2px; }
.owner-email { font-size: 0.9rem; font-weight: 600; color: var(--ink); word-break: break-all; }
.owner-claim { font-size: 0.82rem; color: var(--mut); }
.owner-claim code { font-weight: 700; letter-spacing: 0.18em; color: var(--accent-dark); }
.owner-name { font-size: 0.78rem; color: var(--mut); }
.owner-rebind { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.owner-rebind input { flex: 1 1 160px; font-family: inherit; font-size: 0.9rem; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; }
.owner-flags { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; }
.chip {
  border: 1px solid var(--line); border-radius: 18px; background: var(--surface); color: var(--mut);
  font-family: inherit; font-weight: 700; font-size: 0.7rem; letter-spacing: 0.02em; line-height: 1;
  white-space: nowrap; padding: 8px 13px; cursor: pointer;
}
.chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.chip--lock.on { background: var(--danger); border-color: var(--danger); }
.chip:disabled { opacity: 0.5; cursor: not-allowed; }

.owner-form { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; margin-top: 10px; }
.owner-form input { font-family: inherit; font-size: 0.95rem; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
.owner-hint { font-size: 0.76rem; color: var(--mut); }
.owner-adv summary { font-size: 0.82rem; color: var(--mut); cursor: pointer; }
.owner-adv input { margin: 8px 0; width: 100%; box-sizing: border-box; }
.form-actions { display: flex; justify-content: flex-end; }
.full { width: 100%; }
.add-owner { margin-top: 12px; }

.prov { position: relative; padding: 16px 18px; margin-bottom: 14px; border-color: var(--accent); background: #fdf3f6; }
.prov strong { color: var(--accent-dark); display: block; }
.prov p { font-size: 0.8rem; color: var(--mut); margin: 6px 0 8px; }
.code-big { font-family: 'Rufina', serif; font-size: 1.6rem; letter-spacing: 0.2em; color: var(--ink); text-align: center; padding: 6px 0; }
.prov-actions { display: flex; gap: 12px; margin-top: 8px; }
.code-url { font-size: 0.74rem; color: var(--mut); margin-top: 10px; }
.code-url code { word-break: break-all; }
.prov-x { position: absolute; top: 10px; right: 12px; border: 0; background: none; color: var(--mut); font-size: 1rem; cursor: pointer; }

.spinner-note { color: var(--mut); text-align: center; padding: 30px 0; }
.empty { color: var(--mut); text-align: center; padding: 30px 0; }
.retry { display: inline-block; margin-top: 12px; }
</style>
