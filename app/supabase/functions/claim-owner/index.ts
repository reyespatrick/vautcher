// ============================================================
//  claim-owner — sign into restowner with an owner access code
//
//  POST /claim-owner   { code }            ← code-only login (durable)
//  POST /claim-owner   { code, email }     ← bind a real e-mail (one-shot)
//
//  Public (verify_jwt = false): the durable claim code IS the secret.
//  Steps (service role):
//    1. find the owner row carrying this claim_code,
//    2. CODE-ONLY (no email): sign in as the row's own e-mail (e.g. the
//       scaffolded admin@<slug>.vautcher.local). The code is NOT consumed,
//       so the restaurateur can reuse it to sign in again.
//    3. WITH email: rebind the row to that real e-mail and clear the code
//       (one-shot), refusing if the e-mail already belongs to someone else.
//    4. ensure the Supabase auth user exists,
//    5. mint a fresh login OTP and return it so the client can sign in
//       immediately — no expiring link, no e-mail round-trip (no mail sent).
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESTOWNER_URL = Deno.env.get('RESTOWNER_URL') ?? 'https://restowner.pages.dev'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({} as any))
    const code = String(body.code ?? '').trim().toUpperCase()
    const email = String(body.email ?? '').trim().toLowerCase()  // optional
    if (!code) return json({ error: 'Code requis.' }, 400)
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: 'E-mail invalide.' }, 400)
    }

    // 1. Find the owner row for this code.
    const { data: row } = await admin
      .from('vautcher_owners')
      .select('email, restaurant_id, locked')
      .eq('claim_code', code)
      .maybeSingle()
    if (!row) return json({ error: 'Code invalide ou déjà utilisé.' }, 404)
    if (row.locked) return json({ error: 'Ce compte est verrouillé.' }, 403)

    // The e-mail we sign in as: the row's own (code-only login) unless the
    // caller is binding a real address.
    let loginEmail = row.email

    if (email && email !== row.email) {
      // Binding a real e-mail (one-shot): refuse a clash, rebind, consume code.
      const { data: clash } = await admin
        .from('vautcher_owners')
        .select('email')
        .eq('email', email)
        .maybeSingle()
      if (clash) return json({ error: 'Cet e-mail est déjà associé à un compte.' }, 409)

      const { error: uErr } = await admin
        .from('vautcher_owners')
        .update({ email, claim_code: null })
        .eq('claim_code', code)
      if (uErr) return json({ error: uErr.message }, 400)
      loginEmail = email
    }
    // else: code-only login — keep the row's e-mail, leave the code valid.

    // 4. Ensure the auth user exists.
    await admin.auth.admin.createUser({ email: loginEmail, email_confirm: true }).catch(() => {})

    // 5. Mint a fresh login OTP for an immediate sign-in.
    const { data: link, error: lErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: loginEmail,
      options: { redirectTo: RESTOWNER_URL }
    })
    if (lErr) return json({ error: lErr.message }, 400)

    return json({
      ok: true,
      email: loginEmail,
      otp: link?.properties?.email_otp ?? null,
      action_link: link?.properties?.action_link ?? null
    })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
