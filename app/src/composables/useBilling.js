// Tenant billing state for the diner app. Reads the public RPC
// vautcher_public_billing_state (no auth) and exposes a single
// isBlocked flag the shell uses to decide between rendering the
// normal app or the SuspendedView takeover.
//
// One module-level snapshot per tab.
import { ref } from 'vue'
import { supabase } from '../lib/supabase'
import { RESTAURANT_ID } from '../lib/api'

const status = ref(null)
const isBlocked = ref(false)
const loaded = ref(false)

let inFlight = null
async function refresh() {
  if (inFlight) return inFlight
  if (!supabase || !RESTAURANT_ID) {
    loaded.value = true
    return
  }
  inFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc('vautcher_public_billing_state', {
        p_restaurant_id: RESTAURANT_ID
      })
      if (error) {
        // RPC not deployed yet, or transient error -- fail open. A bad
        // billing check should never block paying customers from seeing
        // their site.
        console.warn('[billing] RPC error', error)
        return
      }
      const row = Array.isArray(data) ? data[0] : data
      status.value    = row?.status ?? null
      isBlocked.value = !!row?.is_blocked
    } catch (e) {
      console.warn('[billing] fetch failed', e)
    } finally {
      loaded.value = true
    }
  })().finally(() => { inFlight = null })
  return inFlight
}

// Re-check when the tab regains visibility -- Stripe webhook fires
// almost instantly when the owner pays, so a returning visitor should
// see the live site without a manual reload.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh()
  })
}

export function useBilling() {
  return { status, isBlocked, loaded, refresh }
}
