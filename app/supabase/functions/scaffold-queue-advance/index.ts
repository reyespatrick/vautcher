// ============================================================
//  scaffold-queue-advance — serial drain of vautcher_scaffold_queue
//
//  Cron-triggered (pg_cron, every minute). Behaviour:
//    1. Roll any in-flight rows forward: for every row with
//       status='scaffolding', re-check the linked
//       vautcher_restaurants.deploy_status. A DB trigger already does
//       this on UPDATE, but we re-check defensively in case a deploy
//       finished while the trigger was unavailable.
//    2. If no row is currently scaffolding, claim the oldest pending
//       row, mark it 'scaffolding', and POST it to scaffold-tenant
//       (with X-Cron-Secret so it skips the moderator-JWT check).
//
//  Strict serial: ONLY one row may be scaffolding at any time. A batch
//  of 10 nearby restaurants therefore takes ~10×5min ≈ 50 min wall-time
//  to fully drain; product decision (auto-drain, unattended).
//
//  Auth: X-Cron-Secret header. There is no human caller.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const ROOT_EMAIL = 'root@dpcsolutions.com'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// Allow two callers: pg_cron (X-Cron-Secret) and an interactive root
// poke from the Discover UI (root JWT). Returns true if authorised.
async function isAuthorised(req: Request): Promise<boolean> {
  if (CRON_SECRET && (req.headers.get('x-cron-secret') ?? '') === CRON_SECRET) return true
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return false
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: u } = await userClient.auth.getUser()
  return (u?.user?.email || '').toLowerCase() === ROOT_EMAIL
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (!(await isAuthorised(req))) {
    return json({ error: 'forbidden' }, 403)
  }

  // Step 1 — reconcile any in-flight rows.
  // Watchdog: if a row has been scaffolding for more than 15 minutes,
  // assume the workflow died without flipping deploy_status (e.g. the
  // GH runner timed out, the Anthropic call hung). Mark it failed and
  // unblock the queue lane so the next pending row can start.
  const TIMEOUT_MS = 15 * 60 * 1000
  const { data: scaffolding } = await admin
    .from('vautcher_scaffold_queue')
    .select('id, restaurant_id, started_at')
    .eq('status', 'scaffolding')

  if (scaffolding?.length) {
    for (const row of scaffolding as Array<{ id: string; restaurant_id: string | null; started_at: string | null }>) {
      // No restaurant_id yet -> scaffold-tenant hasn't returned. Still
      // covered by the timeout below.
      let resolved = false
      if (row.restaurant_id) {
        const { data: r } = await admin
          .from('vautcher_restaurants')
          .select('deploy_status, config')
          .eq('id', row.restaurant_id)
          .maybeSingle()
        const ds = r?.deploy_status ?? null
        if (ds === 'success') {
          await admin.from('vautcher_scaffold_queue').update({
            status: 'done',
            finished_at: new Date().toISOString(),
            error: null
          }).eq('id', row.id)
          resolved = true
        } else if (ds === 'failed' || ds === 'scaffold_failed') {
          await admin.from('vautcher_scaffold_queue').update({
            status: 'failed',
            finished_at: new Date().toISOString(),
            error: String((r?.config as any)?.deploy_error ?? ds)
          }).eq('id', row.id)
          resolved = true
        }
      }
      if (resolved) continue

      // Still scaffolding -> check the watchdog.
      const startedAt = row.started_at ? Date.parse(row.started_at) : null
      if (startedAt && (Date.now() - startedAt) > TIMEOUT_MS) {
        await admin.from('vautcher_scaffold_queue').update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: 'timeout: queue row spent more than 15 minutes in scaffolding without a deploy_status update (workflow likely died)'
        }).eq('id', row.id)
      }
    }
  }

  // Re-read after reconciliation: did anything stay in 'scaffolding'?
  const { count: inFlight } = await admin
    .from('vautcher_scaffold_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'scaffolding')

  if ((inFlight ?? 0) > 0) {
    return json({ ok: true, in_flight: inFlight, started: null, note: 'in-flight row holds the lane' })
  }

  // Step 2 — claim the oldest pending row and hand it to scaffold-tenant.
  const { data: pending } = await admin
    .from('vautcher_scaffold_queue')
    .select('id, name, website_url')
    .eq('status', 'pending')
    .order('enqueued_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!pending) {
    return json({ ok: true, in_flight: 0, started: null })
  }

  // Mark scaffolding BEFORE the network call so two concurrent ticks
  // can't double-fire.
  const { error: claimErr } = await admin
    .from('vautcher_scaffold_queue')
    .update({ status: 'scaffolding', started_at: new Date().toISOString() })
    .eq('id', pending.id)
    .eq('status', 'pending')
  if (claimErr) return json({ ok: false, error: claimErr.message }, 500)

  // Call scaffold-tenant. The X-Cron-Secret header skips its moderator
  // JWT check and attributes the scaffold to root.
  let restaurantId: string | null = null
  let scaffoldErr: string | null = null
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/scaffold-tenant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': CRON_SECRET
      },
      body: JSON.stringify({ url: pending.website_url })
    })
    const text = await res.text()
    let payload: any = null
    try { payload = JSON.parse(text) } catch { /* keep null */ }
    if (!res.ok) {
      scaffoldErr = `scaffold-tenant ${res.status}: ${payload?.error ?? text.slice(0, 200)}`
    } else if (payload?.id) {
      restaurantId = String(payload.id)
    }
  } catch (e) {
    scaffoldErr = `fetch failed: ${(e as Error).message ?? e}`
  }

  if (restaurantId) {
    await admin.from('vautcher_scaffold_queue')
      .update({ restaurant_id: restaurantId })
      .eq('id', pending.id)
  }

  if (scaffoldErr) {
    // scaffold-tenant rejected the request outright — record the failure
    // and let the next tick claim the next pending row.
    await admin.from('vautcher_scaffold_queue').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: scaffoldErr
    }).eq('id', pending.id)
    return json({ ok: false, in_flight: 0, started: pending.id, error: scaffoldErr }, 500)
  }

  return json({ ok: true, in_flight: 1, started: pending.id, restaurant_id: restaurantId })
})
