// ============================================================
//  delete-tenant — hard-delete a tenant from the DB + dispatch the
//  Cloudflare Pages cleanup workflow.
//
//  POST /functions/v1/delete-tenant
//    body: { restaurant_id: uuid, confirm_slug: string }
//
//  Steps:
//   1. Verify caller is a moderator (JWT email lookup).
//   2. Call vautcher_admin_delete_restaurant RPC — that RPC also
//      checks the confirm_slug matches the row's actual slug.
//   3. If the DB delete succeeded, dispatch delete-tenant.yml on
//      GitHub Actions to remove the Cloudflare Pages project.
//
//  verify_jwt = true (caller must be authenticated; the function
//  re-checks moderator status against vautcher_moderators).
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') || ''
const GITHUB_REPO = Deno.env.get('GITHUB_REPO') || 'reyespatrick/vautcher'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS }
  })
}

async function callerIsModerator(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return false
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: u } = await userClient.auth.getUser()
  const email = (u?.user?.email || '').toLowerCase()
  if (!email) return false
  const { data } = await admin.from('vautcher_moderators')
    .select('email').eq('email', email).maybeSingle()
  return !!data
}

async function dispatchCleanup(slug: string): Promise<string | null> {
  if (!GITHUB_TOKEN) return null
  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/delete-tenant.yml/dispatches`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ref: 'main', inputs: { slug } })
  })
  if (!res.ok) {
    console.error('cleanup dispatch failed', res.status, await res.text())
    return null
  }
  return `https://github.com/${GITHUB_REPO}/actions/workflows/delete-tenant.yml`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  if (!(await callerIsModerator(req))) {
    return json({ error: 'forbidden' }, 403)
  }

  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad json' }, 400) }
  const restaurantId: string = (body?.restaurant_id || '').trim()
  const confirmSlug: string = (body?.confirm_slug || '').trim()
  if (!restaurantId || !confirmSlug) {
    return json({ error: 'restaurant_id and confirm_slug required' }, 400)
  }

  // 1. DB-side delete (RPC re-checks moderator + slug match).
  const { data, error } = await admin.rpc('vautcher_admin_delete_restaurant', {
    p_restaurant_id: restaurantId,
    p_confirm_slug: confirmSlug
  })
  if (error) return json({ error: error.message }, 422)

  // 2. Dispatch the Cloudflare Pages cleanup.
  const cleanupUrl = await dispatchCleanup(confirmSlug)

  return json({
    ...(data as Record<string, unknown>),
    cleanup: cleanupUrl ? 'dispatched' : 'manual',
    cleanup_log_url: cleanupUrl
  })
})
