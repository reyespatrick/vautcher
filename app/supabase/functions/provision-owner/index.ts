// ============================================================
//  provision-owner — root creates an owner account
//
//  POST /provision-owner   { email, name, restaurant_id }
//
//  Only a root (an email in vautcher_moderators) may call this.
//  It creates the Supabase auth user, whitelists the owner in
//  vautcher_owners, and returns a one-time magic login link the
//  root hands to the new owner (plus the raw OTP code).
//
//  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are
//  injected automatically into deployed edge functions.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const RESTOWNER_URL = Deno.env.get('RESTOWNER_URL') ?? 'https://restowner.pages.dev'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // --- 1. Authenticate the caller and require root (moderator) ---
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: uErr } = await userClient.auth.getUser()
    if (uErr || !user?.email) return json({ error: 'not authenticated' }, 401)

    const { data: mod } = await admin
      .from('vautcher_moderators')
      .select('email')
      .eq('email', user.email.toLowerCase())
      .maybeSingle()
    if (!mod) return json({ error: 'not authorized' }, 403)

    // --- 2. Validate input ---
    const body = await req.json().catch(() => ({}))
    const email = String(body.email ?? '').trim().toLowerCase()
    const name = String(body.name ?? '').trim() || null
    const restaurantId = String(body.restaurant_id ?? '').trim()
    if (!email || !restaurantId) {
      return json({ error: 'email and restaurant_id are required' }, 400)
    }

    // --- 3. Ensure the auth user exists (idempotent) ---
    await admin.auth.admin
      .createUser({ email, email_confirm: true })
      .catch(() => { /* user already exists — fine */ })

    // --- 4. Whitelist the owner (email -> restaurant) ---
    const { error: oErr } = await admin
      .from('vautcher_owners')
      .upsert(
        { email, restaurant_id: restaurantId, name },
        { onConflict: 'email' }
      )
    if (oErr) return json({ error: oErr.message }, 400)

    // --- 5. Generate the login link the root hands to the owner ---
    const { data: link, error: lErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: RESTOWNER_URL }
    })
    if (lErr) return json({ error: lErr.message }, 400)

    return json({
      ok: true,
      email,
      action_link: link?.properties?.action_link ?? null,
      code: link?.properties?.email_otp ?? null
    })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
