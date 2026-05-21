// Auth + owner-gating for the restowner console.
// Owners sign in with an email OTP code; an account is only granted access
// if its email is listed in vautcher_owners.
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

const session = ref(null)
const owner = ref(null)        // { email, restaurant_id, name }
const restaurant = ref(null)   // { id, name, slug }
const isModerator = ref(false) // email is in vautcher_moderators
const ready = ref(false)

let resolveInit
const initPromise = new Promise((r) => { resolveInit = r })

async function loadOwner() {
  if (!session.value) {
    owner.value = null
    restaurant.value = null
    isModerator.value = false
    return
  }
  const email = (session.value.user.email || '').toLowerCase()
  // select('*') so pref_lang / pref_font_scale are picked up once the
  // prefs migration has run — and tolerated before it has.
  const { data: o } = await supabase
    .from('vautcher_owners')
    .select('*')
    .eq('email', email)
    .maybeSingle()

  // Load the restaurant BEFORE publishing `owner` — anything that reacts
  // to `owner` (the login redirect) then sees a fully-loaded state.
  if (o) {
    const { data: r } = await supabase
      .from('vautcher_restaurants')
      .select('id, name, slug')
      .eq('id', o.restaurant_id)
      .maybeSingle()
    restaurant.value = r || null
  } else {
    restaurant.value = null
  }

  // Moderator check — tolerated before the moderation migration runs.
  const { data: mod } = await supabase
    .from('vautcher_moderators')
    .select('email')
    .eq('email', email)
    .maybeSingle()
  isModerator.value = !!mod

  owner.value = o || null
}

// Initialise once
// Auth init — resolveInit() MUST always run, even if loadOwner fails,
// otherwise whenAuthReady() hangs and the router renders nothing
// (blank white screen).
supabase.auth.getSession()
  .then(async ({ data }) => {
    session.value = data?.session || null
    try { await loadOwner() } catch (e) { console.error('[auth] loadOwner failed', e) }
  })
  .catch((e) => console.error('[auth] getSession failed', e))
  .finally(() => { ready.value = true; resolveInit() })

supabase.auth.onAuthStateChange(async (_event, s) => {
  session.value = s
  try { await loadOwner() } catch (e) { console.error('[auth] loadOwner failed', e) }
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

  function verifyOtp(email, token) {
    return supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'email'
    })
  }

  async function signOut() {
    try { await supabase.auth.signOut() } catch (e) { /* ignore */ }
    session.value = null
    owner.value = null
    restaurant.value = null
    isModerator.value = false
  }

  return { session, owner, restaurant, isModerator, ready, sendOtp, verifyOtp, signOut }
}
