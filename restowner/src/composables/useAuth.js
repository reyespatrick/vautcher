// Auth + owner-gating for the restowner console.
// Owners sign in with an email OTP code; an account is only granted access
// if its email is listed in vautcher_owners.
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

const session = ref(null)
const owner = ref(null)        // { email, restaurant_id, name }
const restaurant = ref(null)   // { id, name, slug }
const ready = ref(false)

let resolveInit
const initPromise = new Promise((r) => { resolveInit = r })

async function loadOwner() {
  if (!session.value) {
    owner.value = null
    restaurant.value = null
    return
  }
  const email = (session.value.user.email || '').toLowerCase()
  const { data: o } = await supabase
    .from('vautcher_owners')
    .select('email, restaurant_id, name')
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
  owner.value = o || null
}

// Initialise once
supabase.auth.getSession().then(async ({ data }) => {
  session.value = data.session
  await loadOwner()
  ready.value = true
  resolveInit()
})

supabase.auth.onAuthStateChange(async (_event, s) => {
  session.value = s
  await loadOwner()
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
    await supabase.auth.signOut()
    session.value = null
    owner.value = null
    restaurant.value = null
  }

  return { session, owner, restaurant, ready, sendOtp, verifyOtp, signOut }
}
