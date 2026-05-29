<script setup>
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useScope } from '../composables/useScope'
import { useAuth } from '../composables/useAuth'
import { usePushAdmin } from '../composables/usePushAdmin'
import QRCode from 'qrcode'
import { DINER_APP_URL } from '../lib/config'

const { activeRestaurant } = useScope()
const { isModerator } = useAuth()
const { subscribed: pushSubscribed, enable: enablePush } = usePushAdmin()
const { t } = useI18n()

const QR_OPTS = { width: 720, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#6f032b', light: '#ffffff' } }

// --- Section 1: the diner (client) app for the selected restaurant ---
// Each tenant is deployed to <slug>.pages.dev. Fall back to the legacy
// DINER_APP_URL constant only when the active restaurant has no slug.
const dinerUrl = computed(() =>
  activeRestaurant.value?.slug
    ? `https://${activeRestaurant.value.slug}.pages.dev`
    : DINER_APP_URL
)
const qrUrl = ref('')
const error = ref('')
const dinerCopied = ref(false)
async function regenerate() {
  try { qrUrl.value = await QRCode.toDataURL(dinerUrl.value, QR_OPTS) }
  catch (e) { error.value = String(e) }
}
// Regenerate whenever the selected restaurant (and its slug) changes.
watch(dinerUrl, regenerate, { immediate: true })
async function copyDiner() {
  try { await navigator.clipboard.writeText(dinerUrl.value); dinerCopied.value = true; setTimeout(() => { dinerCopied.value = false }, 1500) } catch (e) { /* ignore */ }
}

// --- Section 2: the restowner console app (this app's own install page) ---
const installUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/install'
const installQr = ref('')
const installCopied = ref(false)
QRCode.toDataURL(installUrl, QR_OPTS).then((d) => { installQr.value = d }).catch(() => {})
async function copyInstall() {
  try { await navigator.clipboard.writeText(installUrl); installCopied.value = true; setTimeout(() => { installCopied.value = false }, 1500) } catch (e) { /* ignore */ }
}
async function onEnablePush() { await enablePush() }
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('share.title') }}</h1>
    </div>

    <p class="share-sub">{{ t('share.subtitle') }}</p>

    <!-- Section 1 — client app for the restaurant picked in the header. -->
    <h2 class="sec-h">{{ t('share.clientTitle') }}</h2>
    <div class="qr-card card">
      <div class="qr-resto">{{ activeRestaurant ? activeRestaurant.name : '' }}</div>
      <div class="qr-frame">
        <img v-if="qrUrl" :src="qrUrl" :alt="t('share.clientTitle')" />
        <div v-else class="qr-loading">{{ error ? '⚠' : '…' }}</div>
      </div>
      <p class="qr-caption">{{ t('share.caption') }}</p>
      <p class="qr-scan">{{ t('share.scanLine') }}</p>
      <div class="qr-link-row">
        <code class="qr-link">{{ dinerUrl }}</code>
        <button class="btn btn--sm" @click="copyDiner">{{ dinerCopied ? t('admin.copied') : t('admin.copyLink') }}</button>
      </div>
    </div>

    <!-- Section 2 — the restowner console app (install on YOUR phone). -->
    <h2 class="sec-h">{{ t('share.restownerTitle') }}</h2>
    <div class="qr-card card">
      <p class="qr-caption">{{ t('share.restownerHint') }}</p>
      <div class="qr-frame">
        <img v-if="installQr" :src="installQr" :alt="t('share.restownerTitle')" />
        <div v-else class="qr-loading">…</div>
      </div>
      <div class="qr-link-row">
        <code class="qr-link">{{ installUrl }}</code>
        <button class="btn btn--sm" @click="copyInstall">{{ installCopied ? t('admin.copied') : t('admin.copyLink') }}</button>
      </div>
      <button v-if="isModerator" type="button" class="btn btn--plain btn--sm notif-btn" @click="onEnablePush">
        {{ pushSubscribed ? t('admin.notifOn') : t('admin.notifEnable') }}
      </button>
    </div>

    <p class="share-hint">{{ t('share.hint') }}</p>
  </div>
</template>

<style scoped>
.share-sub {
  color: var(--mut);
  font-size: 0.9rem;
  line-height: 1.5;
  margin-bottom: 18px;
}
.sec-h {
  font-family: 'Rufina', serif;
  font-size: 1.1rem;
  color: var(--accent-dark);
  margin: 4px 0 10px;
}
.qr-link-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  flex-wrap: wrap;
  justify-content: center;
}
.qr-link {
  font-size: 0.72rem;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 7px 9px;
  word-break: break-all;
  color: var(--ink);
}
.notif-btn { margin-top: 12px; }
.qr-card {
  padding: 26px 22px;
  text-align: center;
  margin-bottom: 16px;
}
.qr-resto {
  font-family: 'Rufina', serif;
  font-size: 1.4rem;
  color: var(--accent-dark);
  margin-bottom: 16px;
}
.qr-frame {
  display: inline-block;
  padding: 14px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 8px 26px rgba(158, 5, 61, 0.14);
}
.qr-frame img {
  display: block;
  width: 240px;
  height: 240px;
}
.qr-loading {
  width: 240px;
  height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.6rem;
  color: var(--mut);
}
.qr-caption {
  margin-top: 16px;
  color: var(--ink);
  font-size: 0.94rem;
  font-weight: 600;
}
.qr-scan {
  margin-top: 4px;
  color: var(--accent);
  font-size: 0.82rem;
  font-weight: 700;
}
.share-hint {
  margin-top: 14px;
  text-align: center;
  color: var(--mut);
  font-size: 0.78rem;
  line-height: 1.5;
}
</style>
