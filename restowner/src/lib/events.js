// Event data access. Owners have full RLS access to their own
// restaurant's rows, so plain table queries are enough here.
import { supabase } from './supabase'

const TABLE = 'vautcher_events'

export async function listEvents(restaurantId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('event_date', { ascending: true })
  return { data: data || [], error }
}

export async function getEvent(id) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return { data, error }
}

export async function createEvent(payload) {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(payload)
    .select('id')
    .single()
  return { data, error }
}

/**
 * Materialises N future occurrences of a recurring event (RPC).
 * No-op server-side if the parent's recurrence is 'none'.
 */
export async function materializeSeries(eventId, count = 8) {
  const { error } = await supabase.rpc('vautcher_materialize_series', {
    p_event_id: eventId,
    p_count: count
  })
  return { error }
}

export async function updateEvent(id, payload) {
  const { error } = await supabase.from(TABLE).update(payload).eq('id', id)
  return { error }
}

// Sends the event's push to all subscribers right now and cancels any
// scheduled reminder. Gated server-side (moderator or owner of the
// restaurant); the cron secret never leaves the DB. See event-push-now.sql.
export async function pushEventNow(id) {
  const { error } = await supabase.rpc('vautcher_event_push_now', { p_event_id: id })
  return { error }
}

// Asks the rephrase-text edge function to polish (or compose) a
// description (<=200 chars). Accepts an optional title:
//   - text + title → polish text using title for context,
//   - title only   → compose a short description from the title,
//   - text only    → polish text (backwards compatible).
// The Anthropic key stays server-side. Returns { data: { text } } or { error }.
export async function rephraseText(text, title = '') {
  const { data, error } = await supabase.functions.invoke('rephrase-text', { body: { text, title } })
  if (error) return { error }
  if (data && data.error) return { error: { message: data.error } }
  return { data }
}

export async function cancelEvent(id) {
  const { error } = await supabase
    .from(TABLE)
    .update({ status: 'cancelled' })
    .eq('id', id)
  return { error }
}

export async function deleteEvent(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  return { error }
}

// Preset images available to both apps (served from /assets in each).
export const IMAGE_OPTIONS = [
  { url: '/assets/photo1.jpg', label: 'Salle vitrée' },
  { url: '/assets/photo2.jpg', label: 'Le bar' },
  { url: '/assets/photo3.jpg', label: 'La terrasse' },
  { url: '/assets/photo4.jpg', label: 'Bar à vin Da Vinci' },
  { url: '/assets/easter-menu.png', label: 'Affiche menu' }
]

// ---- Owner-uploaded event images (Supabase Storage) ----
const IMAGE_BUCKET = 'vautcher-event-images'

function publicUrl(path) {
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Uploads an event photo for a restaurant. Returns { url, path } or { error }. */
export async function uploadEventImage(restaurantId, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${restaurantId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { cacheControl: '604800', contentType: file.type || undefined })
  if (error) return { error }
  return { url: publicUrl(path), path }
}

/** Lists a restaurant's uploaded images, newest first: [{ path, url }]. */
export async function listUploadedImages(restaurantId) {
  const { data, error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .list(restaurantId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
  if (error || !data) return []
  return data
    .filter((f) => f.id) // skip folder placeholder rows
    .map((f) => {
      const path = `${restaurantId}/${f.name}`
      return { path, url: publicUrl(path) }
    })
}

/** Removes an uploaded image. */
export async function deleteEventImage(path) {
  const { error } = await supabase.storage.from(IMAGE_BUCKET).remove([path])
  return { error }
}

// ---- Moderation (root / moderator) ----

/** Pending events awaiting moderation, oldest first, with restaurant name. */
export async function listPendingEvents(restaurantId = null) {
  let q = supabase
    .from(TABLE)
    .select('*, restaurant:vautcher_restaurants(name)')
    .eq('moderation_status', 'pending')
    .order('submitted_at', { ascending: true })
  if (restaurantId) q = q.eq('restaurant_id', restaurantId)
  const { data, error } = await q
  return { data: data || [], error }
}

/** Approve an event — it becomes visible to diners. */
export async function approveEvent(id) {
  const { error } = await supabase
    .from(TABLE)
    .update({ moderation_status: 'approved', refusal_reason: null })
    .eq('id', id)
  return { error }
}

/** Refuse an event with a reason shown to the owner. */
export async function refuseEvent(id, reason) {
  const { error } = await supabase
    .from(TABLE)
    .update({ moderation_status: 'refused', refusal_reason: reason })
    .eq('id', id)
  return { error }
}

/**
 * Per-event attendee (RSVP) counts for the owner's own restaurant.
 * Returns a map { [eventId]: count }. Empty map if the stats function
 * isn't deployed yet — callers treat a missing entry as 0.
 */
export async function listEventStats() {
  const { data, error } = await supabase.rpc('vautcher_owner_event_stats')
  if (error || !data) return {}
  const map = {}
  for (const row of data) map[row.event_id] = Number(row.attendees) || 0
  return map
}

/**
 * Diners who have RSVPed to a single event. Returns
 * { data: [{ id, name, birth_date, locked, rsvped_at }], error }.
 */
export async function eventAttendees(eventId) {
  if (!eventId) return { data: [], error: null }
  const { data, error } = await supabase.rpc('vautcher_event_attendees', {
    p_event_id: eventId
  })
  return { data: data || [], error }
}
