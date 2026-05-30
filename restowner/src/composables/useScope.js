// Global "active restaurant" scope.
//
// Powers the restaurant-switcher dropdown in the app header. The selection
// is persisted to localStorage and shared across every view, so picking
// La Gioconda on the Events tab also narrows the Voucher, Approval, and
// Admin tabs to La Gioconda — and survives a reload.
//
// `activeRestaurantId` is the single id every data-fetching view should
// read. For a plain owner it resolves to their own restaurant (the
// scope picker is hidden for them). For a moderator it's the explicit
// pick, defaulting to whichever restaurant they own, if any.
import { ref, computed, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const STORAGE_KEY = 'vautcher.scope.restaurantId'

function loadStored() {
  try { return localStorage.getItem(STORAGE_KEY) || null } catch { return null }
}
function storeScope(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage disabled — keep the value in memory only */ }
}

// Module-level singletons so every useScope() consumer sees the same
// state. A change in the header dropdown flips every open view's
// active restaurant in lockstep.
const restaurants = ref([])
const scopeRestaurantId = ref(loadStored())
let loadInFlight = null

async function loadRestaurants() {
  if (loadInFlight) return loadInFlight
  loadInFlight = (async () => {
    const { data, error } = await supabase.rpc('vautcher_my_restaurants')
    if (!error) restaurants.value = data || []
  })().finally(() => { loadInFlight = null })
  return loadInFlight
}

let watchersBound = false

export function useScope() {
  const { owner, restaurant, isModerator, session } = useAuth()

  // Fetch the dropdown options whenever auth state changes. Bound once
  // across the app, not per-component. Two redundant triggers help avoid
  // races: (a) session change, (b) owner-or-moderator becoming known.
  if (!watchersBound) {
    watchersBound = true
    watch([session, owner, isModerator], ([s, o, m]) => {
      if (s) loadRestaurants()
      else { restaurants.value = []; loadInFlight = null }
      // CRITICAL: plain owners must never inherit a scope from a previous
      // moderator/root session left on the device. Without this, the
      // diner's public "published events" RLS policy lets a stale stored
      // restaurant_id (e.g. la-gioconda) leak that restaurant's events
      // into a code-account owner's dashboard.
      if (o && !m) setScope(null)
    }, { immediate: true })
  }

  // Effective restaurant id used by every data query:
  //   1. plain owner — ALWAYS their own restaurant; stored scope ignored
  //      (belt + suspenders alongside the setScope(null) above).
  //   2. moderator — explicit pick from the dropdown / persisted scope.
  //   3. else the owner's own restaurant, else null (not-onboarded mod).
  const activeRestaurantId = computed(() => {
    if (owner.value && !isModerator.value) return restaurant.value?.id || null
    return scopeRestaurantId.value || restaurant.value?.id || null
  })

  const activeRestaurant = computed(() => {
    const id = activeRestaurantId.value
    if (!id) return null
    const fromList = restaurants.value.find((r) => r.id === id)
    if (fromList) return fromList
    if (restaurant.value && restaurant.value.id === id) return restaurant.value
    return null
  })

  // Picker is moderator-only by policy — even if a plain owner ended
  // up attached to several restaurants someday, they should never see
  // the switcher. The computed is reactive on both isModerator and the
  // list, so the picker appears the moment moderator status resolves
  // AND the restaurants list lands.
  const canSwitch = computed(() =>
    isModerator.value && restaurants.value.length > 1
  )

  function setScope(id) {
    scopeRestaurantId.value = id || null
    storeScope(id || null)
  }

  return {
    restaurants, scopeRestaurantId, activeRestaurantId,
    activeRestaurant, canSwitch, setScope
  }
}
