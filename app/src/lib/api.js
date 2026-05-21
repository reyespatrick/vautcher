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

  const { error } = await supabase.rpc('vautcher_save_profile', {
    p_id: profile.id,
    p_name: profile.name.trim(),
    p_birth_date: profile.birthDate
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true, source: 'supabase' }
}

// Demo data so the voucher card looks alive when there is no backend.
const DEMO_VOUCHER = {
  stamps: ['2026-01-12', '2026-02-03', '2026-02-25', '2026-03-14',
           '2026-04-02', '2026-04-21', '2026-05-09'],
  required: 10,
  reward: 'Un dessert maison offert'
}

/**
 * Loads the loyalty voucher: the visitor's collected stamp dates plus the
 * reward config. `stamps_required` and `reward` are set by the separate
 * owner/restaurant app — this app only reads them.
 * Returns { stamps, required, reward, source }.
 */
export async function fetchVoucher(profileId) {
  if (!supabase) return { ...DEMO_VOUCHER, source: 'local' }

  let required = 10
  let reward = 'Une récompense offerte'
  const { data: cfg } = await supabase
    .from('vautcher_config')
    .select('stamps_required, reward')
    .limit(1)
    .maybeSingle()
  if (cfg) {
    required = cfg.stamps_required ?? required
    reward = cfg.reward ?? reward
  }

  let stamps = []
  if (profileId) {
    const { data } = await supabase.rpc('vautcher_get_stamps', { p_profile_id: profileId })
    if (Array.isArray(data)) stamps = data.map((r) => r.stamp_date)
  }
  return { stamps, required, reward, source: 'supabase' }
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
  const { data, error } = await supabase.rpc('vautcher_upcoming_events', {
    p_profile_id: profileId || null
  })
  if (error || !Array.isArray(data)) return { events: DEMO_EVENTS, source: 'local' }
  return { events: data, source: 'supabase' }
}

/** Signals the visitor will join an event. */
export async function joinEvent(eventId, profileId) {
  if (!supabase) return { ok: true, source: 'local' }
  const { error } = await supabase.rpc('vautcher_join_event', {
    p_event_id: eventId, p_profile_id: profileId
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Cancels the visitor's participation in an event. */
export async function leaveEvent(eventId, profileId) {
  if (!supabase) return { ok: true, source: 'local' }
  const { error } = await supabase.rpc('vautcher_leave_event', {
    p_event_id: eventId, p_profile_id: profileId
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Inserts a reservation. Returns { ok, source } or { ok:false, error }. */
export async function createReservation(form) {
  if (!supabase) {
    // No backend configured — simulate success.
    return { ok: true, source: 'local' }
  }
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
}
