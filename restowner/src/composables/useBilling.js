// Billing state for the signed-in owner. One module-level snapshot of
// vautcher_my_subscription so every consumer (AbonnementView, dashboard
// banner, write-action gating) sees the same value without re-querying.
//
// Moderators / root don't have an owner row, so the RPC returns empty
// and we just expose null status / isBlocked=false for them.
import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'

const status              = ref(null)   // 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled'
const trialEnd            = ref(null)   // ISO string
const currentPeriodEnd    = ref(null)   // ISO string
const cancelAtPeriodEnd   = ref(false)
const hasStripeCustomer   = ref(false)
const isBlocked           = ref(false)
const loaded              = ref(false)

let inFlight = null

async function refresh() {
  if (inFlight) return inFlight
  inFlight = (async () => {
    const { data, error } = await supabase.rpc('vautcher_my_subscription')
    if (error) {
      console.warn('[billing] RPC error', error)
      loaded.value = true
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    if (!row) {
      // Caller has no owner row -- moderator, root, or unprovisioned user.
      status.value = null
      trialEnd.value = null
      currentPeriodEnd.value = null
      cancelAtPeriodEnd.value = false
      hasStripeCustomer.value = false
      isBlocked.value = false
    } else {
      status.value            = row.status
      trialEnd.value          = row.trial_end
      currentPeriodEnd.value  = row.current_period_end
      cancelAtPeriodEnd.value = !!row.cancel_at_period_end
      hasStripeCustomer.value = !!row.has_stripe_customer
      isBlocked.value         = !!row.is_blocked
    }
    loaded.value = true
  })().finally(() => { inFlight = null })
  return inFlight
}

// Days left on the local trial. Negative if expired; null if not trialing.
const trialDaysLeft = computed(() => {
  if (status.value !== 'trialing' || !trialEnd.value) return null
  const ms = new Date(trialEnd.value).getTime() - Date.now()
  return Math.ceil(ms / 86400_000)
})

export function useBilling() {
  return {
    status, trialEnd, currentPeriodEnd, cancelAtPeriodEnd,
    hasStripeCustomer, isBlocked, loaded,
    trialDaysLeft,
    refresh
  }
}

// Trigger an initial load on the next session change. App.vue calls
// refresh() after auth resolves; this is just a safe default for callers
// that mount before that happens.
supabase.auth.onAuthStateChange(() => {
  loaded.value = false
  status.value = null
  isBlocked.value = false
})
