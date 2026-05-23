// Root admin data access. Every call is a SECURITY DEFINER function (or
// an edge function) that itself checks the caller is a moderator.
import { supabase } from './supabase'

/** Restaurants with their nested owners. */
export async function adminRestaurants() {
  const { data, error } = await supabase.rpc('vautcher_admin_restaurants')
  return { data: data || [], error }
}

/** Every diner profile, with stamp count + lock state. */
export async function adminClients() {
  const { data, error } = await supabase.rpc('vautcher_admin_clients')
  return { data: data || [], error }
}

export async function createRestaurant(name, slug) {
  const { data, error } = await supabase.rpc('vautcher_admin_create_restaurant', {
    p_name: name, p_slug: slug
  })
  return { data, error }
}

export async function setOwnerFlags(email, trusted, locked) {
  const { error } = await supabase.rpc('vautcher_admin_set_owner_flags', {
    p_email: email, p_trusted: trusted, p_locked: locked
  })
  return { error }
}

export async function setClientLocked(profileId, locked) {
  const { error } = await supabase.rpc('vautcher_admin_set_client_locked', {
    p_profile_id: profileId, p_locked: locked
  })
  return { error }
}

/**
 * Creates an owner account via the provision-owner edge function.
 * Returns { data: { email, action_link, code } } or { error }.
 */
export async function provisionOwner(email, name, restaurantId) {
  const { data, error } = await supabase.functions.invoke('provision-owner', {
    body: { email, name, restaurant_id: restaurantId }
  })
  if (error) return { error }
  if (data && data.error) return { error: { message: data.error } }
  return { data }
}

// ---- Restaurant identity + content editor ----

/** Fetches a restaurant's full identity + config payload. */
export async function getRestaurant(restaurantId) {
  const { data, error } = await supabase.rpc('vautcher_get_restaurant', {
    p_restaurant_id: restaurantId
  })
  return { data, error }
}

/** Saves the name, slug and config (jsonb) for a restaurant. */
export async function updateRestaurant(restaurantId, { name, slug, config }) {
  const { error } = await supabase.rpc('vautcher_admin_update_restaurant', {
    p_restaurant_id: restaurantId,
    p_name: name,
    p_slug: slug,
    p_config: config
  })
  return { error }
}

// Logos live alongside event images for now (one bucket, prefixed path)
// to avoid an extra storage migration. Path = restaurant-logos/<id>/<ts>.<ext>
const LOGO_BUCKET = 'vautcher-event-images'

export async function uploadRestaurantLogo(restaurantId, file) {
  const ext = (file.name.split('.').pop() || 'png')
    .toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `restaurant-logos/${restaurantId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type || undefined
  })
  if (error) return { error }
  const url = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl
  return { url, path }
}
