<script setup>
import { ref, watch, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useScope } from '../composables/useScope'
import { listVouchers, voucherStats, updateVoucher } from '../lib/vouchers'

const { activeRestaurantId } = useScope()
const { t } = useI18n()
const vouchers = ref([])
const stats = ref(null)
const loading = ref(true)
const loadError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false
  // Watchdog — never leave the screen stuck on "Chargement…".
  const watchdog = setTimeout(() => {
    if (loading.value) { loading.value = false; loadError.value = true }
  }, 9000)
  try {
    if (activeRestaurantId.value) {
      const { data, error } = await listVouchers(activeRestaurantId.value)
      if (error) throw error
      vouchers.value = data
      // Stats are best-effort — never block the list on them.
      stats.value = (await voucherStats(activeRestaurantId.value)).data
    } else {
      vouchers.value = []
    }
  } catch (e) {
    loadError.value = true
  } finally {
    clearTimeout(watchdog)
    loading.value = false
  }
}
// Re-fetches when the scope changes (header dropdown).
watch(activeRestaurantId, load, { immediate: true })

const redeemed = computed(() => stats.value?.redeemed || 0)
const completed = computed(() => stats.value?.completed || 0)
const stampsTotal = computed(() => stats.value?.stamps_total || 0)
const rate = computed(() =>
  completed.value ? Math.round((redeemed.value / completed.value) * 100) : 0
)

// Per-vautcher { completed, redeemed }, keyed by id.
function statFor(id) {
  const row = (stats.value?.per_voucher || []).find((v) => v.id === id)
  return row || { active: 0, stamps: 0, completed: 0, redeemed: 0 }
}

// Reorder = swap the sequence value with the adjacent vautcher.
async function move(index, dir) {
  const a = vouchers.value[index]
  const b = vouchers.value[index + dir]
  if (!a || !b) return
  await Promise.all([
    updateVoucher(a.id, { sequence: b.sequence }),
    updateVoucher(b.id, { sequence: a.sequence })
  ])
  load()
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('vouchers.title') }}</h1>
      <p>{{ t('vouchers.subtitle') }}</p>
    </div>

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <div v-else-if="loadError" class="empty">
      {{ t('common.loadError') }}
      <button class="btn btn--plain btn--sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <template v-else>
      <!-- Headline stat: vautchers actually used -->
      <div class="card vstats">
        <span class="vstats-num">{{ redeemed }}</span>
        <span class="vstats-label">{{ t('vouchers.statRedeemed') }}</span>
        <div class="vstats-bar"><span :style="{ width: rate + '%' }"></span></div>
        <span class="vstats-sub">
          {{ t('vouchers.statCompleted', { n: completed }) }} ·
          {{ t('vouchers.statRate', { rate }) }}
        </span>
        <span class="vstats-stamps">{{ t('vouchers.statStamps', { n: stampsTotal }) }}</span>
      </div>

      <RouterLink to="/voucher/new" class="btn btn--full create-btn">
        <span class="plus">+</span> {{ t('vouchers.create') }}
      </RouterLink>

      <p v-if="!vouchers.length" class="empty">
        {{ t('vouchers.empty') }}<br />{{ t('vouchers.emptyHint') }}
      </p>

      <div v-else class="v-list">
        <div v-for="(v, i) in vouchers" :key="v.id" class="card vrow">
          <div class="vrow-main">
            <div class="vrow-top">
              <span class="vrow-label">{{ v.label }}</span>
              <span class="badge badge--age">{{ t('vouchers.stampsLabel', { n: v.stamps_required }) }}</span>
            </div>
            <p class="vrow-reward">🎁 {{ v.reward_text }}</p>
            <p class="vrow-stat">
              {{ t('vouchers.perActive', { n: statFor(v.id).active }) }} ·
              {{ t('vouchers.perCompleted', { n: statFor(v.id).completed }) }} ·
              {{ t('vouchers.perRedeemed', { n: statFor(v.id).redeemed }) }}
            </p>
            <div class="vrow-actions">
              <RouterLink :to="`/voucher/${v.id}`" class="btn btn--plain btn--sm">
                {{ t('vouchers.edit') }}
              </RouterLink>
            </div>
          </div>
          <div class="vrow-move">
            <button
              type="button"
              :aria-label="t('vouchers.moveUp')"
              :disabled="i === 0"
              @click="move(i, -1)"
            >▲</button>
            <button
              type="button"
              :aria-label="t('vouchers.moveDown')"
              :disabled="i === vouchers.length - 1"
              @click="move(i, 1)"
            >▼</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.retry { display: block; margin: 14px auto 0; }

/* ---- Headline stat card ---- */
.vstats {
  padding: 22px 18px 20px;
  text-align: center;
  margin-bottom: 18px;
}
.vstats-num {
  display: block;
  font-family: 'Rufina', serif;
  font-size: 2.7rem;
  font-weight: 700;
  line-height: 1;
  color: var(--accent-dark);
}
.vstats-label {
  display: block;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--mut);
  margin-top: 6px;
}
.vstats-bar {
  height: 7px;
  background: #ece0cd;
  border-radius: 99px;
  overflow: hidden;
  margin: 14px 8px 0;
}
.vstats-bar span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent), #c8295c);
  border-radius: 99px;
  transition: width 0.5s ease;
}
.vstats-sub { display: block; font-size: 0.8rem; color: var(--mut); margin-top: 9px; }
.vstats-stamps {
  display: inline-block; margin-top: 12px; padding: 5px 12px; border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent); font-size: 0.82rem; font-weight: 700;
}

.create-btn { margin-bottom: 22px; }
.plus { font-size: 1.15rem; font-weight: 700; line-height: 0; }

/* ---- Vautcher rows ---- */
.v-list { display: flex; flex-direction: column; gap: 12px; }
.vrow { display: flex; padding: 14px 14px 14px 16px; }
.vrow-main { flex: 1; min-width: 0; }
.vrow-top { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.vrow-label { font-family: 'Rufina', serif; font-size: 1.08rem; font-weight: 700; }
.vrow-reward { font-size: 0.86rem; color: var(--ink); margin-top: 5px; }
.vrow-stat { font-size: 0.74rem; color: var(--mut); margin-top: 3px; }
.vrow-actions { margin-top: 10px; }
.vrow-move {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding-left: 8px;
}
.vrow-move button {
  width: 30px; height: 30px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--mut);
  font-size: 0.7rem;
  cursor: pointer;
}
.vrow-move button:active:not(:disabled) { transform: scale(0.92); }
.vrow-move button:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
