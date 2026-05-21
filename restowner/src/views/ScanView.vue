<script setup>
import { ref, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'

const { t } = useI18n()
const scanning = ref(false)
const busy = ref(false)
const result = ref(null) // { ok, name, stamps } | { ok:false, error }
let scanner = null

async function stopScanner() {
  if (scanner && scanning.value) {
    try { await scanner.stop() } catch { /* ignore */ }
  }
  scanning.value = false
}

async function handleCode(text) {
  if (busy.value) return
  const m = /^vautcher-stamp:([0-9a-fA-F-]{36})$/.exec((text || '').trim())
  if (!m) return // not a vautcher code — keep scanning
  busy.value = true
  await stopScanner()

  try {
    const { data, error } = await supabase.rpc('vautcher_add_stamp', {
      p_profile_id: m[1]
    })
    if (error) {
      result.value = { ok: false, error: error.message }
    } else {
      const row = Array.isArray(data) ? data[0] : data
      result.value = row && row.name
        ? { ok: true, name: row.name, stamps: row.stamps }
        : { ok: false, error: t('scan.notFound') }
    }
  } catch (e) {
    result.value = { ok: false, error: (e && e.message) || String(e) }
  } finally {
    busy.value = false
  }
}

async function start() {
  result.value = null
  scanning.value = true
  await nextTick()
  try {
    scanner = new Html5Qrcode('qr-reader')
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      handleCode,
      () => {}
    )
  } catch (e) {
    scanning.value = false
    const msg = (e && (e.message || e.name)) || String(e)
    result.value = { ok: false, error: t('scan.cameraError', { msg }) }
  }
}

onBeforeUnmount(stopScanner)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('scan.title') }}</h1>
      <p>{{ t('scan.subtitle') }}</p>
    </div>

    <div class="card scan-card">
      <div class="scan-stage" :class="{ live: scanning }">
        <div id="qr-reader" class="reader" :class="{ active: scanning }"></div>
        <div v-if="!scanning" class="placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
            <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
          </svg>
          <span>{{ result ? t('scan.readyAgain') : t('scan.ready') }}</span>
        </div>
      </div>

      <div v-if="result" class="result" :class="result.ok ? 'good' : 'bad'">
        <div class="big">{{ result.ok ? '✓' : '✕' }}</div>
        <template v-if="result.ok">
          <p>{{ t('scan.stampAdded', { name: result.name }) }}</p>
          <p class="count">{{ t('scan.stampTotal', { n: result.stamps }) }}</p>
        </template>
        <p v-else>{{ result.error }}</p>
      </div>

      <button v-if="!scanning" class="btn btn--full" @click="start">
        {{ result ? t('scan.startAgain') : t('scan.start') }}
      </button>
      <button v-else class="btn btn--plain btn--full" @click="stopScanner">{{ t('scan.stop') }}</button>
    </div>
  </div>
</template>

<style scoped>
.scan-card { padding: 18px; }

.scan-stage {
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 16px;
  background: #1b1417;
}
.scan-stage:not(.live) {
  background: #faf4ea;
  border: 2px dashed var(--line);
}

.reader { width: 100%; }
.reader:not(.active) { height: 0; }
.reader.active { min-height: 280px; }
.reader :deep(video) { display: block; border-radius: 0; }
.reader :deep(img[alt="Info icon"]) { display: none; }

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 54px 20px;
  color: var(--mut);
}
.placeholder svg { width: 56px; height: 56px; color: var(--accent); opacity: 0.55; }
.placeholder span { font-size: 0.85rem; font-weight: 600; }

.result {
  border-radius: 12px;
  padding: 18px;
  margin-bottom: 14px;
  text-align: center;
}
.result .big {
  font-size: 1.7rem;
  font-weight: 700;
  line-height: 1;
  margin-bottom: 6px;
}
.result.good { background: rgba(31, 157, 85, 0.12); color: var(--ok); }
.result.bad { background: rgba(192, 57, 43, 0.1); color: var(--danger); }
.result strong { color: var(--ink); }
.result .count { font-size: 0.82rem; margin-top: 2px; }
</style>
