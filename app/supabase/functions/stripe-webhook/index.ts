// ============================================================
//  stripe-webhook — receive Stripe events, update vautcher_subscriptions.
//
//  POST /functions/v1/stripe-webhook
//    body: Stripe webhook payload (raw, with Stripe-Signature header)
//
//  Verify-JWT is OFF: Stripe calls us directly with no Supabase JWT.
//  We verify the request ourselves via the Stripe-Signature header
//  (HMAC-SHA256 over `timestamp.body` with STRIPE_WEBHOOK_SECRET).
//
//  Handled events:
//    customer.subscription.created/updated  → upsert status + period end
//    customer.subscription.deleted          → status = cancelled
//    invoice.paid                           → ensure status = active
//    invoice.payment_failed                 → status = past_due
//
//  Idempotency: every Stripe event has a unique event.id. We stash the
//  last one we processed on the row and skip if it shows up again --
//  Stripe retries events up to a few times so this matters.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

// ---- Stripe signature verification ---------------------------------
// Mirrors Stripe's official v1 scheme: header is
//   t=<timestamp>,v1=<hex>,v0=<hex>...
// where the signed payload is `${timestamp}.${rawBody}` HMAC-SHA256'd
// with the webhook secret.
async function verifyStripeSignature(
  raw: string,
  header: string,
  secret: string,
  toleranceSec = 300
): Promise<boolean> {
  if (!header) return false
  const parts = Object.fromEntries(
    header.split(',').map(s => {
      const i = s.indexOf('=')
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()]
    })
  ) as Record<string, string>
  const t = parts['t']
  const v1 = parts['v1']
  if (!t || !v1) return false
  const tsSec = Number(t)
  if (!Number.isFinite(tsSec)) return false
  if (Math.abs(Math.floor(Date.now() / 1000) - tsSec) > toleranceSec) {
    return false
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${t}.${raw}`)
  )
  const expected = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  // Constant-time-ish compare.
  if (expected.length !== v1.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ v1.charCodeAt(i)
  }
  return mismatch === 0
}

// ---- helpers -------------------------------------------------------
// Stripe statuses we get on subscription objects:
//   trialing, active, past_due, canceled, unpaid, incomplete,
//   incomplete_expired, paused
// We collapse them into our own five.
function mapStripeStatus(s: string): string {
  switch (s) {
    case 'trialing':           return 'trialing'
    case 'active':             return 'active'
    case 'past_due':           return 'past_due'
    case 'unpaid':             return 'suspended'   // Stripe gave up
    case 'paused':             return 'suspended'
    case 'canceled':           return 'cancelled'
    case 'incomplete':         return 'past_due'
    case 'incomplete_expired': return 'cancelled'
    default:                   return 'past_due'
  }
}

// Stripe periods come in as unix seconds. null-safe.
function tsToIso(secs: number | null | undefined): string | null {
  if (!secs) return null
  return new Date(secs * 1000).toISOString()
}

// Find which tenant a Stripe event belongs to. Most subscription / invoice
// events carry a Stripe customer id; we mapped that to a restaurant_id at
// checkout time. As a fallback for the very first event we also try the
// metadata.restaurant_id we set when creating the customer + subscription.
async function tenantForEvent(ev: any): Promise<string | null> {
  const obj = ev?.data?.object ?? {}
  const metaR = obj?.metadata?.restaurant_id
    || obj?.subscription_details?.metadata?.restaurant_id
    || null
  if (metaR) return metaR

  const customerId: string | null = obj?.customer ?? null
  if (!customerId) return null

  const { data } = await admin
    .from('vautcher_subscriptions')
    .select('restaurant_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  return data?.restaurant_id ?? null
}

async function handleSubscriptionEvent(ev: any, restaurantId: string) {
  const sub = ev.data.object
  await admin.from('vautcher_subscriptions').update({
    stripe_subscription_id: sub.id,
    status: mapStripeStatus(sub.status),
    current_period_end: tsToIso(sub.current_period_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    // trial_end comes back from Stripe once they take over the trial.
    trial_end: tsToIso(sub.trial_end),
    last_stripe_event_id: ev.id
  }).eq('restaurant_id', restaurantId)
}

async function handleInvoicePaid(ev: any, restaurantId: string) {
  // A successful invoice lifts us out of past_due. We don't blindly
  // overwrite to 'active' though -- if Stripe still reports the
  // subscription as trialing (paid invoice with $0 line items, e.g.
  // mid-trial cardonfile), we keep it trialing. The subscription event
  // that follows will set the truth either way; this is a safety net.
  await admin.from('vautcher_subscriptions').update({
    last_stripe_event_id: ev.id
  }).eq('restaurant_id', restaurantId)
  // Only force-flip from past_due -- otherwise leave the subscription
  // event in charge.
  await admin.from('vautcher_subscriptions').update({
    status: 'active'
  }).eq('restaurant_id', restaurantId)
    .eq('status', 'past_due')
}

async function handleInvoiceFailed(ev: any, restaurantId: string) {
  await admin.from('vautcher_subscriptions').update({
    status: 'past_due',
    last_stripe_event_id: ev.id
  }).eq('restaurant_id', restaurantId)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }
  const sigHeader = req.headers.get('stripe-signature') || ''
  const raw = await req.text()
  const ok = await verifyStripeSignature(raw, sigHeader, WEBHOOK_SECRET)
  if (!ok) {
    return new Response('bad signature', { status: 400 })
  }

  let ev: any
  try { ev = JSON.parse(raw) } catch { return new Response('bad body', { status: 400 }) }

  try {
    const tenantId = await tenantForEvent(ev)
    if (!tenantId) {
      // Unknown customer -- could be an old test event or one we don't
      // care about. 200 so Stripe doesn't retry forever.
      console.warn('stripe-webhook: no tenant for event', ev.type, ev.id)
      return new Response('ok (no tenant)', { status: 200 })
    }

    // Idempotency check.
    const { data: existing } = await admin
      .from('vautcher_subscriptions')
      .select('last_stripe_event_id')
      .eq('restaurant_id', tenantId)
      .maybeSingle()
    if (existing?.last_stripe_event_id === ev.id) {
      return new Response('ok (already processed)', { status: 200 })
    }

    switch (ev.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionEvent(ev, tenantId)
        break
      case 'customer.subscription.deleted':
        await admin.from('vautcher_subscriptions').update({
          status: 'cancelled',
          cancel_at_period_end: false,
          last_stripe_event_id: ev.id
        }).eq('restaurant_id', tenantId)
        break
      case 'invoice.paid':
        await handleInvoicePaid(ev, tenantId)
        break
      case 'invoice.payment_failed':
        await handleInvoiceFailed(ev, tenantId)
        break
      default:
        // We didn't subscribe to it; just acknowledge.
        break
    }
    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error('stripe-webhook handler error', e)
    return new Response('handler error', { status: 500 })
  }
})
