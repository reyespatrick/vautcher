<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { supabase } from '../lib/supabase'
import { useBilling } from '../composables/useBilling'

const { t, locale } = useI18n()
const {
  status, trialEnd, currentPeriodEnd, cancelAtPeriodEnd,
  hasStripeCustomer, isBlocked, loaded, trialDaysLeft, refresh
} = useBilling()

const checkingOut = ref(false)
const openingPortal = ref(false)
const errorMsg = ref('')

onMounted(() => { refresh() })

const badgeKey = computed(() => {
  // The "trial expired but never paid" case shows as Suspendu, not Essai.
  if (status.value === 'trialing' && isBlocked.value) return 'expired'
  return status.value || 'unknown'
})

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(locale.value, {
      day: '2-digit', month: 'long', year: 'numeric'
    })
  } catch { return iso }
}

async function startCheckout() {
  checkingOut.value = true
  errorMsg.value = ''
  try {
    const { data, error } = await supabase.functions.invoke('stripe-checkout', { body: {} })
    if (error) {
      let msg = t('billing.errCheckout')
      try {
        if (error.context && typeof error.context.json === 'function') {
          const body = await error.context.json()
          if (body?.error) msg = body.error
        }
      } catch { /* ignore */ }
      errorMsg.value = msg
      return
    }
    if (data?.url) window.location = data.url
    else errorMsg.value = t('billing.errCheckout')
  } catch (e) {
    errorMsg.value = String(e?.message || e)
  } finally {
    checkingOut.value = false
  }
}

async function openPortal() {
  openingPortal.value = true
  errorMsg.value = ''
  try {
    const { data, error } = await supabase.functions.invoke('stripe-portal', { body: {} })
    if (error) {
      errorMsg.value = t('billing.errPortal')
      return
    }
    if (data?.url) window.location = data.url
    else errorMsg.value = t('billing.errPortal')
  } catch (e) {
    errorMsg.value = String(e?.message || e)
  } finally {
    openingPortal.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('billing.title') }}</h1>
      <p>{{ t('billing.subtitle') }}</p>
    </div>

    <p v-if="!loaded" class="spinner-note">{{ t('common.loading') }}</p>

    <div v-else class="card sub-card">
      <span class="badge" :class="'badge--' + badgeKey">
        {{ t('billing.status.' + badgeKey) }}
      </span>

      <!-- TRIALING (still has days left) -->
      <template v-if="status === 'trialing' && !isBlocked">
        <h2 class="ttl">{{ t('billing.trial.heading', { days: trialDaysLeft }) }}</h2>
        <p class="muted">{{ t('billing.trial.body') }}</p>
        <p class="muted small">{{ t('billing.trial.expiryNote', { date: fmtDate(trialEnd) }) }}</p>
        <button class="btn btn--full subscribe" :disabled="checkingOut" @click="startCheckout">
          {{ checkingOut ? t('common.loading') : t('billing.cta.subscribe') }}
        </button>
      </template>

      <!-- TRIAL EXPIRED -->
      <template v-else-if="status === 'trialing' && isBlocked">
        <h2 class="ttl">{{ t('billing.expired.heading') }}</h2>
        <p class="muted">{{ t('billing.expired.body') }}</p>
        <button class="btn btn--full subscribe" :disabled="checkingOut" @click="startCheckout">
          {{ checkingOut ? t('common.loading') : t('billing.cta.subscribe') }}
        </button>
      </template>

      <!-- ACTIVE -->
      <template v-else-if="status === 'active'">
        <h2 class="ttl">{{ t('billing.active.heading') }}</h2>
        <p v-if="!cancelAtPeriodEnd" class="muted">
          {{ t('billing.active.renews', { date: fmtDate(currentPeriodEnd) }) }}
        </p>
        <p v-else class="warn">
          {{ t('billing.active.cancelling', { date: fmtDate(currentPeriodEnd) }) }}
        </p>
        <button class="btn btn--full btn--plain" :disabled="openingPortal" @click="openPortal">
          {{ openingPortal ? t('common.loading') : t('billing.cta.manage') }}
        </button>
      </template>

      <!-- PAST DUE -->
      <template v-else-if="status === 'past_due'">
        <h2 class="ttl">{{ t('billing.pastDue.heading') }}</h2>
        <p class="warn">{{ t('billing.pastDue.body') }}</p>
        <button class="btn btn--full" :disabled="openingPortal" @click="openPortal">
          {{ openingPortal ? t('common.loading') : t('billing.cta.updateCard') }}
        </button>
      </template>

      <!-- SUSPENDED or CANCELLED -->
      <template v-else-if="status === 'suspended' || status === 'cancelled'">
        <h2 class="ttl">{{ t('billing.suspended.heading') }}</h2>
        <p class="warn">{{ t('billing.suspended.body') }}</p>
        <button class="btn btn--full subscribe" :disabled="checkingOut" @click="startCheckout">
          {{ checkingOut ? t('common.loading') : t('billing.cta.resubscribe') }}
        </button>
        <button
          v-if="hasStripeCustomer"
          class="btn btn--full btn--plain manage-alt"
          :disabled="openingPortal"
          @click="openPortal"
        >
          {{ t('billing.cta.manage') }}
        </button>
      </template>

      <!-- UNKNOWN / NO ROW (moderator viewing this page) -->
      <template v-else>
        <p class="muted">{{ t('billing.unknown') }}</p>
      </template>

      <p v-if="errorMsg" class="err">{{ errorMsg }}</p>
    </div>
  </div>
</template>

<style scoped>
.sub-card {
  padding: 22px 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ttl {
  font-size: 1.25rem;
  color: var(--accent-dark);
  margin: 2px 0 0;
}
.muted { color: var(--mut); font-size: 0.92rem; line-height: 1.45; }
.muted.small { font-size: 0.8rem; margin-top: -6px; }
.warn { color: var(--danger); font-size: 0.92rem; line-height: 1.45; }
.subscribe { margin-top: 8px; }
.manage-alt { margin-top: 8px; }
.err {
  margin-top: 6px;
  color: var(--danger);
  font-size: 0.85rem;
  font-weight: 600;
}
/* Status badges live in main.css; we just add the ones we need here. */
.badge--trialing  { background: rgba(184, 144, 47, 0.18); color: #8a6a16; }
.badge--expired   { background: rgba(192, 57, 43, 0.13); color: var(--danger); }
.badge--active    { background: rgba(31, 157, 85, 0.14); color: var(--ok); }
.badge--past_due  { background: rgba(214, 124, 20, 0.16); color: #b5680f; }
.badge--suspended { background: rgba(192, 57, 43, 0.13); color: var(--danger); }
.badge--cancelled { background: rgba(140, 127, 120, 0.20); color: var(--mut); }
.badge--unknown   { background: rgba(140, 127, 120, 0.20); color: var(--mut); }
</style>
