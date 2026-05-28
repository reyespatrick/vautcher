<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { useScope } from '../composables/useScope'

const { t } = useI18n()
const { activeRestaurantId } = useScope()
const route = useRoute()
const scanning = ref(false)
const busy = ref(false)
const result = ref(null) // see handleCode for the shapes
let scanner = null

// Manual screenshots use ?demo=stamp / ?demo=redeem to pre-fill the
// result card. No effect in normal use.
onMounted(() => {
  const d = route.query.demo
  if (d === 'stamp') {
    result.value = {
      ok: true, mode: 'stamp', name: 'Marie', lifetime: 7,
      cardLabel: 'Carte de fidélité', cardCount: 8, cardRequired: 10,
      cardCompleted: false, redeemed: 1
    }
  } else if (d === 'redeem') {
    result.value = {
      ok: true, mode: 'redeem', name: 'Marie',
      reward: 'Un dessert maison offert', redeemed: 2
    }
  }
})

const UUID = '([0-9a-fA-F-]{36})'
const STAMP_RE = new RegExp(`^vautcher-stamp:${UUID}$`)
const REDEEM_RE = new RegExp(`^vautcher-redeem:${UUID}$`)

async function stopScanner() {
  if (scanner && scanning.value) {
    try { await scanner.stop() } catch { /* ignore */ }
  }
  scanning.value = false
}

function row(data) {
  return Array.isArray(data) ? data[0] : data
}

async function handleCode(text) {
  if (busy.value) return
  const raw = (text || '').trim()
  const stamp = STAMP_RE.exec(raw)
  const redeem = REDEEM_RE.exec(raw)
  if (!stamp && !redeem) return // not a vautcher code — keep scanning
  busy.value = true
  await stopScanner()

  try {
    if (redeem) {
      // Completed card → mark the reward as given.
      const { data, error } = await supabase.rpc('vautcher_redeem_card', {
        p_card_id: redeem[1], p_restaurant_id: activeRestaurantId.value
      })
      const r = row(data)
      if (error) {
        result.value = { ok: false, error: error.message }
      } else if (r && r.name) {
        result.value = {
          ok: true, mode: 'redeem',
          name: r.name, reward: r.reward_text, redeemed: r.vouchers_redeemed
        }
      } else {
        result.value = { ok: false, error: t('scan.notFound') }
      }
    } else {
      // Active card → add a loyalty stamp.
      const { data, error } = await supabase.rpc('vautcher_add_stamp', {
        p_profile_id: stamp[1], p_restaurant_id: activeRestaurantId.value
      })
      const r = row(data)
      if (error) {
        result.value = { ok: false, error: error.message }
      } else if (r && r.name) {
        result.value = {
          ok: true, mode: 'stamp',
          name: r.name, lifetime: r.lifetime_visits,
          cardLabel: r.card_label, cardCount: r.card_count,
          cardRequired: r.card_required, cardCompleted: r.card_completed,
          redeemed: r.vouchers_redeemed
        }
      } else {
        result.value = { ok: false, error: t('scan.notFound') }
      }
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

        <template v-if="result.ok && result.mode === 'stamp'">
          <p v-if="result.cardCompleted" class="done-line">{{ t('scan.cardComplete') }}</p>
          <p>{{ t('scan.stampAdded', { name: result.name }) }}</p>
          <p class="count">{{ result.cardLabel }} · {{ result.cardCount }}/{{ result.cardRequired }}</p>
          <p class="sub">
            {{ t('scan.lifetime', { n: result.lifetime }) }} ·
            {{ t('scan.redeemedTotal', { n: result.redeemed }) }}
          </p>
        </template>

        <template v-else-if="result.ok && result.mode === 'redeem'">
          <p>{{ t('scan.redeemed', { name: result.name }) }}</p>
          <p class="count">🎁 {{ result.reward }}</p>
          <p class="sub">{{ t('scan.redeemedTotal', { n: result.redeemed }) }}</p>
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
.result .done-line {
  font-family: 'Rufina', serif;
  font-size: 1.05rem;
  font-weight: 700;
  margin-bottom: 4px;
}
.result .count { font-size: 0.86rem; font-weight: 600; margin-top: 3px; }
.result .sub { font-size: 0.74rem; opacity: 0.8; margin-top: 5px; }
</style>
