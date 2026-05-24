// Root admin data access. Every call is a SECURITY DEFINER function (or
// an edge function) that itself checks the caller is a moderator.
import { supabase } from './supabase'

/** Restaurants with their nested owners. */
export async function adminRestaurants() {
  const { data, error } = await supabase.rpc('vautcher_admin_restaurants')
  return { data: data || [], error }
}

/**
 * Diner profiles with stamp count + lock state. When restaurantId is
 * given, scopes to clients who have at least one stamp at that
 * restaurant — used by the admin-panel restaurant filter.
 */
export async function adminClients(restaurantId = null) {
  const { data, error } = await supabase.rpc('vautcher_admin_clients', {
    p_restaurant_id: restaurantId
  })
  return { data: data || [], error }
}

/**
 * Scaffold a brand-new tenant from a public website URL.
 * Invokes the scaffold-tenant edge function. Returns
 *   { data: { id, name, slug, blocks, deploy, deploy_log_url, pages_url } }
 * or { error }.
 */
/**
 * Hard-delete a tenant. The moderator must pass the restaurant's
 * slug back as a confirmation string — the DB RPC re-validates it.
 * Returns { data: { id, slug, name, deleted, cleanup, cleanup_log_url } }
 * or { error }.
 */
export async function deleteTenant(restaurantId, confirmSlug) {
  const sessErr = await requireSession()
  if (sessErr) return { error: sessErr }
  const { data, error } = await supabase.functions.invoke('delete-tenant', {
    body: { restaurant_id: restaurantId, confirm_slug: confirmSlug }
  })
  if (error) return { error: await unwrapFunctionError(error) }
  if (data && data.error) return { error: { message: data.error } }
  return { data }
}

// Unwraps a supabase.functions.invoke() error so the caller sees the
// actual server message instead of the generic "Edge Function returned
// a non-2xx status code" wrapper. The function's JSON {error: "..."}
// lives on err.context.json().
async function unwrapFunctionError(err) {
  if (!err) return null
  try {
    if (err.context && typeof err.context.json === 'function') {
      const body = await err.context.json()
      if (body && body.error) return { message: body.error, status: err.context.status }
    }
  } catch { /* couldn't parse; fall through */ }
  return { message: err.message || String(err) }
}

// Catch the most common cause of "Failed to send a request to the Edge
// Function" up front: there's no signed-in user so supabase-js can't
// attach a JWT. The gateway would 401 anyway; better to fail fast with
// a message the moderator can act on.
async function requireSession() {
  const { data } = await supabase.auth.getSession()
  if (!data?.session) {
    return { message: 'Session expirée — reconnectez-vous puis réessayez.' }
  }
  return null
}

export async function scaffoldTenant(url) {
  const sessErr = await requireSession()
  if (sessErr) return { error: sessErr }
  const { data, error } = await supabase.functions.invoke('scaffold-tenant', {
    body: { url }
  })
  if (error) return { error: await unwrapFunctionError(error) }
  if (data && data.error) return { error: { message: data.error } }
  return { data }
}

export async function createRestaurant(name, slug) {
  const { data, error } = await supabase.rpc('vautcher_admin_create_restaurant', {
    p_name: name, p_slug: slug
  })
  return { data, error }
}

/**
 * Replace a scaffold-provisioned owner's placeholder email with the
 * real one. Moderator-only (the RPC checks).
 */
export async function setOwnerEmail(oldEmail, newEmail) {
  const { error } = await supabase.rpc('vautcher_admin_set_owner_email', {
    p_old_email: oldEmail, p_new_email: newEmail
  })
  return { error }
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
