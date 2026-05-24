<script setup>
// Cross-restaurant overview — restaurants and their owners.
// The clients view has moved to its own /clients tab using the shared
// <ClientList /> component, so the segmented control here is gone.
import { ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import {
  adminRestaurants, createRestaurant,
  setOwnerFlags, provisionOwner
} from '../lib/admin'

const { t } = useI18n()
const { isModerator } = useAuth()

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
    if (error) { alert(error.message || t('admin.error')); return }
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
    if (error) { alert(error.message || t('admin.error')); return }
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

      <button
        v-if="!showNewRestaurant"
        class="btn btn--full create-btn"
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
          <div class="resto-head">
            <strong>{{ r.name }}</strong>
            <span class="resto-slug">{{ r.slug }}</span>
            <RouterLink :to="{ name: 'restaurant-config', params: { id: r.id } }"
                        class="btn btn--ghost btn--sm resto-cfg">
              {{ t('config.edit') }}
            </RouterLink>
          </div>

          <p v-if="!r.owners.length" class="owners-empty">{{ t('admin.noOwners') }}</p>
          <ul v-else class="owners">
            <li v-for="o in r.owners" :key="o.email" :class="{ locked: o.locked }">
              <div class="owner-id">
                <span class="owner-email">{{ o.email }}</span>
                <span v-if="o.name" class="owner-name">{{ o.name }}</span>
              </div>
              <div class="owner-flags">
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
.form-actions { display: flex; gap: 8px; margin-top: 4px; }

/* Restaurants */
.r-list { display: flex; flex-direction: column; gap: 12px; }
.resto { padding: 14px 16px; }
.resto-head { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; }
.resto-cfg { margin-left: auto; }
.resto-head strong { font-family: 'Rufina', serif; font-size: 1.1rem; }
.resto-slug { font-size: 0.74rem; color: var(--mut); }

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
