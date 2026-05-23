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

  // Fetch the dropdown options once the user is authenticated; reset
  // them on sign-out. Bound once across the app, not per-component.
  if (!watchersBound) {
    watchersBound = true
    watch([session, owner, isModerator], ([s, o, m]) => {
      if (s && (o || m)) loadRestaurants()
      else { restaurants.value = []; loadInFlight = null }
    }, { immediate: true })
  }

  // Effective restaurant id used by every data query:
  //   1. explicit scope pick (from the dropdown / persisted)
  //   2. else the owner's own restaurant (works for plain owners)
  //   3. else null (locked-out / not-onboarded moderator)
  const activeRestaurantId = computed(() =>
    scopeRestaurantId.value || restaurant.value?.id || null
  )

  const activeRestaurant = computed(() => {
    const id = activeRestaurantId.value
    if (!id) return null
    const fromList = restaurants.value.find((r) => r.id === id)
    if (fromList) return fromList
    if (restaurant.value && restaurant.value.id === id) return restaurant.value
    return null
  })

  // Show the picker only when there's actually a choice to make.
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
