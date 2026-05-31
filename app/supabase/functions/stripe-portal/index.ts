// ============================================================
//  stripe-portal — open the Stripe Customer Portal for the calling owner.
//
//  POST /functions/v1/stripe-portal
//    no body (auth header carries the JWT)
//
//  Returns { url } pointing at the Stripe-hosted portal. Owners use it
//  to update their card, see invoices, or cancel the subscription.
//
//  We require an existing Stripe customer -- if the owner hasn't gone
//  through Checkout yet, the portal has nothing to show.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const STRIPE_KEY   = Deno.env.get('STRIPE_SECRET_KEY')!
const RETURN_URL   = Deno.env.get('STRIPE_PORTAL_RETURN_URL')
  ?? 'https://restowner.pages.dev/abonnement'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}

async function stripe(path: string, body: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${path} ${res.status}`)
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const auth = req.headers.get('authorization') || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'unauthorized' }, 401)

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    const { data: u } = await userClient.auth.getUser()
    const email = (u?.user?.email || '').toLowerCase()
    if (!email) return json({ error: 'unauthorized' }, 401)

    const { data: owner } = await admin
      .from('vautcher_owners')
      .select('restaurant_id')
      .eq('email', email)
      .maybeSingle()
    if (!owner?.restaurant_id) return json({ error: 'unauthorized' }, 401)

    const { data: sub } = await admin
      .from('vautcher_subscriptions')
      .select('stripe_customer_id')
      .eq('restaurant_id', owner.restaurant_id)
      .maybeSingle()

    if (!sub?.stripe_customer_id) {
      // No customer yet -- the owner is still on the local trial. Push
      // them to checkout instead of trying to open an empty portal.
      return json({ error: 'no_customer', message: 'No Stripe customer yet — start a subscription first.' }, 409)
    }

    const params = new URLSearchParams({
      customer: sub.stripe_customer_id,
      return_url: RETURN_URL
    })
    const session = await stripe('/v1/billing_portal/sessions', params.toString())
    return json({ url: session.url })
  } catch (e) {
    console.error('stripe-portal error', e)
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
