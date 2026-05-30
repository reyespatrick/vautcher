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

// Returns a per-request supabase client that forwards the caller's JWT
// (so server-side `auth.jwt()` inside SECURITY DEFINER RPCs resolves to
// the actual user). Also returns the resolved moderator email or null.
async function userClientIfModerator(req: Request): Promise<{
  client: ReturnType<typeof createClient> | null
  email: string | null
}> {
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return { client: null, email: null }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: u } = await userClient.auth.getUser()
  const email = (u?.user?.email || '').toLowerCase()
  if (!email) return { client: null, email: null }
  const { data } = await admin.from('vautcher_moderators')
    .select('email').eq('email', email).maybeSingle()
  if (!data) return { client: null, email }
  return { client: userClient, email }
}

async function dispatchCleanup(slug: string, projectName: string | null): Promise<string | null> {
  if (!GITHUB_TOKEN) return null
  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/delete-tenant.yml/dispatches`
  // Pass project_name when we know it (e.g. inglewood -> inglewood-353);
  // the workflow falls back to slug when project_name is empty.
  const inputs: Record<string, string> = { slug }
  if (projectName && projectName !== slug) inputs.project_name = projectName
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ref: 'main', inputs })
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

  const { client: userClient, email } = await userClientIfModerator(req)
  if (!userClient) {
    return json({ error: email ? 'not a moderator' : 'unauthenticated' }, 403)
  }

  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad json' }, 400) }
  const restaurantId: string = (body?.restaurant_id || '').trim()
  const confirmSlug: string = (body?.confirm_slug || '').trim()
  if (!restaurantId || !confirmSlug) {
    return json({ error: 'restaurant_id and confirm_slug required' }, 400)
  }

  // 1. Read the row BEFORE deleting so we know which Cloudflare Pages
  //    project to clean up. When wrangler had to suffix the project
  //    (e.g. inglewood -> inglewood-353 because the plain subdomain was
  //    globally taken), deleting by slug alone would 404 and leave the
  //    real project behind. The actual project name is recorded in
  //    config.cf_pages_project by the deploy-tenant workflow.
  const { data: row } = await admin.from('vautcher_restaurants')
    .select('config').eq('id', restaurantId).maybeSingle()
  const projectName = String(((row?.config as any)?.cf_pages_project) ?? '').trim() || null

  // 2. DB-side delete (RPC re-checks moderator + slug match). MUST be
  //    called with the caller's JWT so vautcher_is_moderator() — which
  //    reads auth.jwt() ->> 'email' — sees the right email. Calling it
  //    via the service-role admin client makes auth.jwt() empty and the
  //    RPC raises "not authorized".
  const { data, error } = await userClient.rpc('vautcher_admin_delete_restaurant', {
    p_restaurant_id: restaurantId,
    p_confirm_slug: confirmSlug
  })
  if (error) return json({ error: error.message }, 422)

  // 3. Dispatch the Cloudflare Pages cleanup with the real project name.
  const cleanupUrl = await dispatchCleanup(confirmSlug, projectName)

  return json({
    ...(data as Record<string, unknown>),
    cleanup: cleanupUrl ? 'dispatched' : 'manual',
    cleanup_log_url: cleanupUrl
  })
})
