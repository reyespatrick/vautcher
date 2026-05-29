// Auth + owner-gating for the restowner console.
// Owners sign in with an email OTP code; an account is only granted access
// if its email is listed in vautcher_owners.
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

const session = ref(null)
const owner = ref(null)         // { email, restaurant_id, name } — APPROVED owner
const pendingOwner = ref(null)  // owner row awaiting root approval (approved=false)
const restaurant = ref(null)    // { id, name, slug }
const isModerator = ref(false)  // email is in vautcher_moderators
const ready = ref(false)

let resolveInit
const initPromise = new Promise((r) => { resolveInit = r })

// Tracks which user owner/restaurant/isModerator currently reflect (or are
// mid-load for). Repeat auth events — INITIAL_SESSION, SIGNED_IN,
// TOKEN_REFRESHED — all fire for the same signed-in user; without this guard
// each one re-runs the owner queries and reassigns `restaurant` to a fresh
// object, which retriggers every watch(restaurant, …) — e.g. the dashboard
// event list refetching on a loop.
let loadedFor = null
let loadInFlight = null

// Safety net: the router awaits whenAuthReady() before rendering anything.
// If Supabase's getSession() ever hangs (a known auth-lock issue), the app
// would show a permanent white screen. Force the gate open after 3.5s.
// openGate() clears this timer, so it never fires after a clean boot.
const safetyNet = setTimeout(() => {
  console.warn('[boot] auth: SAFETY-NET timeout fired — getSession() likely hung')
  openGate()
}, 3500)

// Idempotent — the real auth init and the safety net both call it; whichever
// runs first opens the gate, the other is a no-op.
function openGate() {
  clearTimeout(safetyNet)
  ready.value = true
  resolveInit()
}

// Public entry point — deduped by user identity so the owner queries run
// exactly once per real sign-in, no matter how many auth events fire.
function loadOwner() {
  const email = session.value
    ? (session.value.user.email || '').toLowerCase()
    : null
  if (email === loadedFor) return loadInFlight || Promise.resolve()
  loadedFor = email
  loadInFlight = applyOwner(email).finally(() => { loadInFlight = null })
  return loadInFlight
}

async function applyOwner(email) {
  if (!email) {
    owner.value = null
    pendingOwner.value = null
    restaurant.value = null
    isModerator.value = false
    return
  }
  console.log('[boot] auth: loadOwner — querying vautcher_owners')
  // select('*') so pref_lang / pref_font_scale are picked up once the
  // prefs migration has run — and tolerated before it has.
  const { data: o } = await supabase
    .from('vautcher_owners')
    .select('*')
    .eq('email', email)
    .maybeSingle()
  console.log('[boot] auth: loadOwner — vautcher_owners returned')

  // A locked owner is treated as having no owner record — access revoked.
  // `approved` may be missing before the approval migration runs, so a
  // missing value counts as approved (backward compatible).
  const isApproved = !o || o.approved !== false
  const activeOwner = o && !o.locked && isApproved ? o : null
  // A row that exists but isn't approved yet → pending root authorisation.
  pendingOwner.value = (o && !o.locked && !isApproved) ? o : null

  // Load the restaurant BEFORE publishing `owner` — anything that reacts
  // to `owner` (the login redirect) then sees a fully-loaded state.
  if (activeOwner) {
    const { data: r } = await supabase
      .from('vautcher_restaurants')
      .select('id, name, slug')
      .eq('id', activeOwner.restaurant_id)
      .maybeSingle()
    restaurant.value = r || null
  } else {
    restaurant.value = null
  }

  // Moderator check — tolerated before the moderation migration runs.
  console.log('[boot] auth: loadOwner — querying vautcher_moderators')
  const { data: mod } = await supabase
    .from('vautcher_moderators')
    .select('email')
    .eq('email', email)
    .maybeSingle()
  console.log('[boot] auth: loadOwner — vautcher_moderators returned')
  isModerator.value = !!mod

  owner.value = activeOwner
}

// Initialise once
// Auth init — resolveInit() MUST always run, even if loadOwner fails,
// otherwise whenAuthReady() hangs and the router renders nothing
// (blank white screen).
console.log('[boot] auth: calling getSession()')
supabase.auth.getSession()
  .then(async ({ data }) => {
    console.log('[boot] auth: getSession() resolved — session =', !!(data && data.session))
    session.value = data?.session || null
    try {
      await loadOwner()
      console.log('[boot] auth: loadOwner() complete')
    } catch (e) { console.error('[boot] auth: loadOwner failed', e) }
  })
  .catch((e) => console.error('[boot] auth: getSession failed', e))
  .finally(() => {
    console.log('[boot] auth: init finished — opening the gate')
    openGate()
  })

supabase.auth.onAuthStateChange((_event, s) => {
  session.value = s
  // CRITICAL: never call other Supabase methods directly inside this
  // callback — it runs while the auth lock is held, so a query would
  // deadlock it (getSession + every query then hang). Defer with
  // setTimeout so loadOwner runs after the lock is released.
  setTimeout(() => {
    loadOwner().catch((e) => console.error('[boot] auth: loadOwner failed', e))
  }, 0)
})

export function whenAuthReady() {
  return initPromise
}

export function useAuth() {
  function sendOtp(email) {
    return supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true }
    })
  }

  // Verify an OTP. Tries the email-OTP type first (normal login), then
  // falls back to magiclink (the token minted by claim-owner / provisioning
  // is a magic-link OTP) so a hand-off code works the same as an emailed one.
  async function verifyOtp(email, token) {
    const e = email.trim()
    const tok = token.trim()
    const res = await supabase.auth.verifyOtp({ email: e, token: tok, type: 'email' })
    if (res.error) {
      const alt = await supabase.auth.verifyOtp({ email: e, token: tok, type: 'magiclink' })
      if (!alt.error) return alt
    }
    return res
  }

  // Dev-only "root" shortcut — signs straight in with the fixed
  // password seeded by root-account-schema.sql (no email OTP).
  // ⚠️ DEV BACKDOOR — remove before production.
  function rootLogin() {
    return supabase.auth.signInWithPassword({
      email: 'root@dpcsolutions.com',
      password: 'vautcher-root-2026'
    })
  }

  async function signOut() {
    try { await supabase.auth.signOut() } catch (e) { /* ignore */ }
    session.value = null
    owner.value = null
    pendingOwner.value = null
    restaurant.value = null
    isModerator.value = false
  }

  // The signed-in user asks to become an owner. Creates a pending row
  // (approved=false, no restaurant) that root then approves. Idempotent.
  function requestAccess() {
    return supabase.rpc('vautcher_request_owner_access')
  }

  // Force a re-evaluation of owner/pending state for the current session
  // (used right after requestAccess so the UI flips to the pending screen).
  async function refreshOwner() {
    loadedFor = null
    await loadOwner()
  }

  return {
    session, owner, pendingOwner, restaurant, isModerator, ready,
    sendOtp, verifyOtp, rootLogin, requestAccess, refreshOwner, signOut
  }
}
