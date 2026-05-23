// Data access layer.
// Talks to Supabase when configured; otherwise no-ops gracefully so the
// app keeps working with no backend.
import { supabase } from './supabase'

const RESERVATION_TABLE = 'vautcher_reservations'

/**
 * Inserts (first time) or updates the visitor profile, keyed by id.
 * Goes through the `vautcher_save_profile` SECURITY DEFINER function so the
 * profiles table needs no public read/write policies (keeps PII private).
 * Returns { ok, source } or { ok:false, error }.
 */
export async function saveProfile(profile) {
  if (!supabase) return { ok: true, source: 'local' }

  try {
    const { error } = await supabase.rpc('vautcher_save_profile', {
      p_id: profile.id,
      p_name: profile.name.trim(),
      p_birth_date: profile.birthDate
    })

    if (error) return { ok: false, error: error.message }
    return { ok: true, source: 'supabase' }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

// Per-tenant — the restaurant this build of the diner app belongs to.
// Set by VITE_RESTAURANT_ID in the per-restaurant deploy; falls back to
// La Gioconda for local dev without an env file.
export const RESTAURANT_ID =
  import.meta.env.VITE_RESTAURANT_ID ||
  '11111111-1111-1111-1111-111111111111'

// Demo data so the voucher card looks alive when there is no backend.
const DEMO_VOUCHER = {
  lifetime_visits: 7,
  vouchers_redeemed: 1,
  template: {
    label: 'Carte de fidélité',
    reward_text: 'Un dessert maison offert',
    stamps_required: 10
  },
  cards: [{
    id: 'demo-card', card_no: 2, status: 'active',
    label: 'Carte de fidélité', reward_text: 'Un dessert maison offert',
    stamps_required: 10,
    stamps: ['2026-04-02', '2026-04-21', '2026-05-09',
             '2026-05-14', '2026-05-18', '2026-05-20', '2026-05-22']
  }]
}

// A second demo variant for `?demoState=complete` — full card with a
// redeemable reward. Used by the user-manual screenshots.
const COMPLETE_DEMO_VOUCHER = {
  lifetime_visits: 10,
  vouchers_redeemed: 1,
  template: DEMO_VOUCHER.template,
  cards: [{
    id: 'demo-card-complete', card_no: 2, status: 'completed',
    label: 'Carte de fidélité', reward_text: 'Un dessert maison offert',
    stamps_required: 10,
    stamps: ['2026-03-04', '2026-03-15', '2026-03-22', '2026-04-02',
             '2026-04-12', '2026-04-19', '2026-04-28', '2026-05-05',
             '2026-05-14', '2026-05-21']
  }]
}

/**
 * Saves a Web-Push subscription for this diner. Upserts on endpoint
 * so re-subscribing on the same device replaces the row.
 */
export async function registerPushSubscription(profileId, subscription, userAgent) {
  if (!supabase || !profileId || !subscription) return { ok: false }
  const json = subscription.toJSON ? subscription.toJSON() : subscription
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { ok: false }
  try {
    const { error } = await supabase.rpc('vautcher_register_push', {
      p_profile_id: profileId,
      p_restaurant_id: RESTAURANT_ID,
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_user_agent: userAgent || ''
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) }
  }
}

/** Removes a stale subscription. */
export async function unregisterPushSubscription(endpoint) {
  if (!supabase || !endpoint) return { ok: false }
  try {
    await supabase.rpc('vautcher_unregister_push', { p_endpoint: endpoint })
    return { ok: true }
  } catch (e) {
    return { ok: false }
  }
}

/**
 * Loads this tenant's identity + content config (brand tokens, hero, about,
 * specialties, gallery, hours, contact info). Returns null if unavailable
 * so callers can fall back to a cached / default config.
 */
export async function fetchRestaurant() {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.rpc('vautcher_get_restaurant', {
      p_restaurant_id: RESTAURANT_ID
    })
    if (error || !data) return null
    return data
  } catch (e) {
    return null
  }
}

function demoVariant() {
  if (typeof window === 'undefined') return DEMO_VOUCHER
  const flag = new URLSearchParams(window.location.search).get('demoState')
  return flag === 'complete' ? COMPLETE_DEMO_VOUCHER : DEMO_VOUCHER
}

/**
 * Loads the diner's loyalty state: the active card, any completed cards
 * still to be redeemed, the two counters, and a template for diners with
 * no card yet. Vautchers (stamps_required, reward) are defined by the
 * owner console — this app only reads them.
 * Returns { lifetime_visits, vouchers_redeemed, template, cards, source }.
 */
export async function fetchVoucher(profileId) {
  if (!supabase || !profileId) return { ...demoVariant(), source: 'local' }

  try {
    const { data, error } = await supabase.rpc('vautcher_get_voucher', {
      p_profile_id: profileId,
      p_restaurant_id: RESTAURANT_ID
    })
    if (error || !data) return { ...demoVariant(), source: 'local' }
    return { ...data, source: 'supabase' }
  } catch (e) {
    return { ...demoVariant(), source: 'local' }
  }
}

// Demo events so the section looks alive when there is no backend.
const DEMO_EVENTS = [
  { id: 'e1', title: 'Aperitivo Italiano',
    description: "Chaque vendredi soir, un apéritif à l'italienne : planches de charcuteries et fromages, spritz maison et ambiance napolitaine au bar.",
    event_date: '2026-05-30', event_time: '18h30', location: 'Le Bar',
    price: 'Entrée libre', image_url: '/assets/photo2.jpg', attendees: 12, joined: false },
  { id: 'e2', title: 'Soirée Pizza au feu de bois',
    description: 'Notre pizzaïolo revisite les grands classiques napolitains : pâte maturée 48h, mozzarella di bufala et produits du marché. Menu pizza + dessert.',
    event_date: '2026-06-13', event_time: '19h00', location: 'Salle principale',
    price: '45 CHF / personne', image_url: '/assets/photo1.jpg', attendees: 8, joined: false },
  { id: 'e3', title: 'Fête de la Musique',
    description: "Musique live sur la terrasse pour célébrer l'été, accompagnée d'un menu spécial et de vins d'Italie.",
    event_date: '2026-06-21', event_time: '19h30', location: 'La Terrasse',
    price: 'Entrée libre', image_url: '/assets/photo3.jpg', attendees: 23, joined: false },
  { id: 'e4', title: 'Dégustation de vins italiens',
    description: 'Une soirée au Bar à Vin Da Vinci pour découvrir notre sélection, guidée par notre sommelier.',
    event_date: '2026-06-27', event_time: '18h30', location: 'Bar à Vin Da Vinci',
    price: '38 CHF / personne', image_url: '/assets/photo4.jpg', attendees: 5, joined: false }
]

/**
 * Today-or-future published events, each with its attendee count and whether
 * this visitor has joined. Returns { events, source }.
 */
export async function fetchEvents(profileId) {
  if (!supabase) return { events: DEMO_EVENTS, source: 'local' }
  try {
    const { data, error } = await supabase.rpc('vautcher_upcoming_events', {
      p_profile_id: profileId || null,
      p_restaurant_id: RESTAURANT_ID
    })
    if (error || !Array.isArray(data)) return { events: DEMO_EVENTS, source: 'local' }
    return { events: data, source: 'supabase' }
  } catch (e) {
    return { events: DEMO_EVENTS, source: 'local' }
  }
}

/**
 * One event by id, with the attendee count and whether this visitor
 * has joined. Falls back to a DEMO_EVENTS match when there's no
 * Supabase configured. Returns { event, source } or { event: null }.
 */
export async function fetchEvent(eventId, profileId) {
  if (!supabase) {
    const e = DEMO_EVENTS.find((x) => x.id === eventId) || null
    return { event: e, source: 'local' }
  }
  try {
    const { data, error } = await supabase.rpc('vautcher_upcoming_events', {
      p_profile_id: profileId || null,
      p_restaurant_id: RESTAURANT_ID
    })
    if (error || !Array.isArray(data)) return { event: null }
    const event = data.find((x) => x.id === eventId) || null
    return { event, source: 'supabase' }
  } catch (e) {
    return { event: null }
  }
}

/** Signals the visitor will join an event. */
export async function joinEvent(eventId, profileId) {
  if (!supabase) return { ok: true, source: 'local' }
  try {
    const { error } = await supabase.rpc('vautcher_join_event', {
      p_event_id: eventId, p_profile_id: profileId
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Cancels the visitor's participation in an event. */
export async function leaveEvent(eventId, profileId) {
  if (!supabase) return { ok: true, source: 'local' }
  try {
    const { error } = await supabase.rpc('vautcher_leave_event', {
      p_event_id: eventId, p_profile_id: profileId
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Inserts a reservation. Returns { ok, source } or { ok:false, error }. */
export async function createReservation(form) {
  if (!supabase) {
    // No backend configured — simulate success.
    return { ok: true, source: 'local' }
  }
  try {
    const { error } = await supabase.from(RESERVATION_TABLE).insert({
      res_date: form.date,
      res_time: form.time,
      guests: form.guests,
      name: form.name.trim(),
      phone: form.phone.trim(),
      notes: form.notes?.trim() || null
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, source: 'supabase' }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}
