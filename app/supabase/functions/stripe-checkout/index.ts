// ============================================================
//  stripe-checkout — start a paid subscription for the calling owner.
//
//  POST /functions/v1/stripe-checkout
//    no body (auth header carries the JWT)
//
//  Flow:
//    1. Auth — caller must be a logged-in vautcher owner. We resolve
//       their restaurant_id via vautcher_owner_restaurant().
//    2. Load (or upsert) the vautcher_subscriptions row.
//    3. If the row has no stripe_customer_id, create a Stripe Customer
//       (email = owner email, metadata.restaurant_id = our tenant id)
//       and persist the id so we don't make a second one on retry.
//    4. Create a Checkout Session in mode=subscription against
//       STRIPE_PRICE_ID, attaching the customer. If the local trial
//       hasn't elapsed yet we pass the remaining days as
//       subscription_data.trial_period_days so Stripe honours what's
//       left of the trial.
//    5. Return { url } -- the frontend does window.location = url.
//
//  Verify-JWT is ON (this is the default for non-webhook functions).
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!
const STRIPE_KEY    = Deno.env.get('STRIPE_SECRET_KEY')!
const STRIPE_PRICE  = Deno.env.get('STRIPE_PRICE_ID')!
const SUCCESS_URL   = Deno.env.get('STRIPE_CHECKOUT_SUCCESS_URL')
  ?? 'https://restowner.pages.dev/abonnement?status=ok'
const CANCEL_URL    = Deno.env.get('STRIPE_CHECKOUT_CANCEL_URL')
  ?? 'https://restowner.pages.dev/abonnement?status=cancel'

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

// ---- Stripe REST via bare fetch ------------------------------------
// We don't pull npm:stripe -- cold-start is faster and we only need two
// endpoints. Stripe accepts application/x-www-form-urlencoded with the
// usual bracket notation for nested params (e.g. line_items[0][price]).
function form(obj: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    u.append(k, String(v))
  }
  return u.toString()
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
  if (!res.ok) {
    const msg = data?.error?.message || `Stripe ${path} ${res.status}`
    throw new Error(msg)
  }
  return data
}

// ---- Auth: resolve calling owner ------------------------------------
async function callerOwnerContext(req: Request): Promise<{
  email: string
  restaurant_id: string
} | null> {
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: u } = await userClient.auth.getUser()
  const email = (u?.user?.email || '').toLowerCase()
  if (!email) return null

  const { data: owner } = await admin
    .from('vautcher_owners')
    .select('restaurant_id')
    .eq('email', email)
    .maybeSingle()
  if (!owner?.restaurant_id) return null

  return { email, restaurant_id: owner.restaurant_id }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const ctx = await callerOwnerContext(req)
    if (!ctx) return json({ error: 'unauthorized' }, 401)

    // 1. Load (or upsert) the subscription row. Service-role bypass RLS.
    let { data: sub } = await admin
      .from('vautcher_subscriptions')
      .select('restaurant_id, stripe_customer_id, status, trial_end')
      .eq('restaurant_id', ctx.restaurant_id)
      .maybeSingle()

    if (!sub) {
      const { data: created, error } = await admin
        .from('vautcher_subscriptions')
        .insert({
          restaurant_id: ctx.restaurant_id,
          status: 'trialing',
          trial_end: new Date(Date.now() + 14 * 86400_000).toISOString()
        })
        .select('restaurant_id, stripe_customer_id, status, trial_end')
        .single()
      if (error) throw error
      sub = created
    }

    // 2. Ensure a Stripe customer exists for this tenant.
    let customerId = sub.stripe_customer_id
    if (!customerId) {
      const customer = await stripe('/v1/customers', form({
        email: ctx.email,
        'metadata[restaurant_id]': ctx.restaurant_id
      }))
      customerId = customer.id as string
      await admin.from('vautcher_subscriptions')
        .update({ stripe_customer_id: customerId })
        .eq('restaurant_id', ctx.restaurant_id)
    }

    // 3. Days left on the local trial -- pass to Stripe so the remaining
    //    free time carries over. Stripe rejects values < 1, so we only
    //    pass it when we have at least one whole day left.
    let trialDays: number | undefined
    if (sub.status === 'trialing' && sub.trial_end) {
      const ms = new Date(sub.trial_end).getTime() - Date.now()
      const days = Math.floor(ms / 86400_000)
      if (days >= 1) trialDays = days
    }

    // 4. Create the Checkout Session.
    const params: Record<string, string | number | undefined> = {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': STRIPE_PRICE,
      'line_items[0][quantity]': 1,
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      'subscription_data[metadata][restaurant_id]': ctx.restaurant_id,
      // Allow Stripe to collect the address (useful for VAT / receipts).
      billing_address_collection: 'auto',
      // Don't show "promotion code" by default -- we don't run promos.
      allow_promotion_codes: 'false'
    }
    if (trialDays) params['subscription_data[trial_period_days]'] = trialDays

    const session = await stripe('/v1/checkout/sessions', form(params))
    return json({ url: session.url })
  } catch (e) {
    console.error('stripe-checkout error', e)
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
