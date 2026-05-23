// Clients of a specific restaurant — for the Clients tab in restowner.
// Owners can call this for their own restaurant; moderators for any.
import { supabase } from './supabase'

/** Diners who have stamped at this restaurant, with per-restaurant
 *  counts and last-visit date. Returns { data, error }. */
export async function restaurantClients(restaurantId) {
  if (!restaurantId) return { data: [], error: null }
  const { data, error } = await supabase.rpc('vautcher_restaurant_clients', {
    p_restaurant_id: restaurantId
  })
  return { data: data || [], error }
}
