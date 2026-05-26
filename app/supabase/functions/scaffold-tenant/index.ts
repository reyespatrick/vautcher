// ============================================================
//  scaffold-tenant — turn a restaurant URL into a vautcher tenant.
//
//  POST /functions/v1/scaffold-tenant
//    body: { url }                              — fresh scaffold (async)
//    body: { restaurant_id, redeploy: true }    — just fire deploy-tenant.yml
//
//  Flow (fresh scaffold):
//    1. Auth — caller must be a vautcher_moderator.
//    2. Derive a slug from the URL (hostname + optional <title> hint),
//       deduplicated against existing tenants.
//    3. Insert a placeholder vautcher_restaurants row (deploy_status =
//       'scaffolding', config.scaffolding = true).
//    4. Provision a vautcher_owners row with a fresh claim code.
//    5. Dispatch the scaffold-tenant.yml GitHub workflow with
//       { url, slug, restaurant_id }. That workflow runs the bespoke
//       generator, patches config, and triggers deploy-tenant.yml.
//    6. Return immediately so the UI can show a "scaffolding…" status.
//
//  Everything heavy (crawl, Claude call, Playwright, fact-check) lives
//  in CI — the edge function only sets up the row + dispatches.
//
//  Verify-JWT is ON: the caller's JWT is required.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') || ''
const GITHUB_REPO = Deno.env.get('GITHUB_REPO') || 'reyespatrick/vautcher'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

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

// ---------- AUTH ----------
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

// ---------- SLUG ----------
function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'restaurant'
}

async function uniqueSlug(base: string): Promise<string> {
  const { data: existing } = await admin.from('vautcher_restaurants')
    .select('slug').like('slug', `${base}%`)
  const taken = new Set((existing || []).map((r: { slug: string }) => r.slug))
  if (!taken.has(base)) return base
  for (let i = 2; i < 50; i++) {
    const cand = `${base}-${i}`
    if (!taken.has(cand)) return cand
  }
  return `${base}-${Date.now()}`
}

// Best-effort name/slug seed. Pull the page <title>, trim trailing
// " | site name" boilerplate, and use that to seed the slug; on any
// failure fall back to the URL hostname.
async function deriveNameAndSlug(url: string): Promise<{ name: string; slug: string }> {
  let host = 'restaurant'
  try { host = new URL(url).hostname.replace(/^www\./i, '') } catch { /* keep default */ }
  let title = ''
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 6000)
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctl.signal })
    clearTimeout(timer)
    if (res.ok) {
      const head = (await res.text()).slice(0, 8192)
      const m = head.match(/<title>([\s\S]*?)<\/title>/i)
      if (m) {
        title = m[1]
          .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
          .trim()
          .replace(/\s*[\|\-–—·•].*$/, '')
          .trim()
      }
    }
  } catch { /* swallow — slug will fall back to host */ }
  const name = title || host
  const slug = await uniqueSlug(slugify(name))
  return { name, slug }
}

// ---------- CLAIM CODE ----------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXY3456789'
function generateClaimCode(): string {
  let s = ''
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return s
}
async function uniqueClaimCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateClaimCode()
    const { data } = await admin.from('vautcher_owners')
      .select('email').eq('claim_code', code).maybeSingle()
    if (!data) return code
  }
  return generateClaimCode() + Date.now().toString(36).slice(-2).toUpperCase()
}

// ---------- GITHUB DISPATCH ----------
async function dispatchWorkflow(workflow: string, inputs: Record<string, string>): Promise<string | null> {
  if (!GITHUB_TOKEN) return null
  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflow}/dispatches`
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
    console.error('github dispatch failed', workflow, res.status, await res.text())
    return null
  }
  return `https://github.com/${GITHUB_REPO}/actions/workflows/${workflow}`
}

// ---------- HANDLER ----------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!(await callerIsModerator(req))) return json({ error: 'forbidden' }, 403)

  let body: { url?: string; restaurant_id?: string; redeploy?: boolean }
  try { body = await req.json() } catch { return json({ error: 'bad json' }, 400) }

  // ---- Mode 2: redeploy only (no re-scaffold) ----
  if (body?.restaurant_id && body?.redeploy === true) {
    const { data: row, error } = await admin.from('vautcher_restaurants')
      .select('id, slug, name').eq('id', body.restaurant_id).single()
    if (error || !row) return json({ error: 'restaurant not found' }, 404)
    const workflowUrl = await dispatchWorkflow('deploy-tenant.yml', { slug: row.slug })
    if (workflowUrl) {
      await admin.from('vautcher_restaurants')
        .update({ deploy_status: 'pending', deploy_log_url: workflowUrl })
        .eq('id', row.id)
    }
    return json({
      id: row.id, slug: row.slug, name: row.name,
      deploy: workflowUrl ? 'dispatched' : 'manual',
      deploy_log_url: workflowUrl,
      pages_url: `https://${row.slug}.pages.dev`
    })
  }

  // ---- Mode 1: fresh bespoke scaffold ----
  const inputUrl: string = (body?.url || '').trim()
  if (!inputUrl) return json({ error: 'url required' }, 400)
  const target = /^https?:\/\//.test(inputUrl) ? inputUrl : 'https://' + inputUrl

  const { name, slug } = await deriveNameAndSlug(target)

  // Placeholder row — the workflow patches in home_html / home_css /
  // theme once Claude is done.
  const placeholderConfig: Record<string, unknown> = {
    source_url: target,
    scaffolding: true,
    pwa_name: name,
    pwa_short_name: name
  }
  const { data: inserted, error: insErr } = await admin.from('vautcher_restaurants').insert({
    name,
    slug,
    config: placeholderConfig,
    deploy_status: 'scaffolding'
  }).select('id, slug, name').single()
  if (insErr) return json({ error: insErr.message }, 500)

  // Owner with a claim code. The moderator hands this code to the future
  // restaurant owner so they can take over the tenant from restowner.
  const claimCode = await uniqueClaimCode()
  const placeholderEmail = `pending+${claimCode.toLowerCase()}@${inserted.slug}.vautcher.local`
  const { error: ownerErr } = await admin.from('vautcher_owners').insert({
    email: placeholderEmail,
    restaurant_id: inserted.id,
    name: `Propriétaire ${name}`,
    trusted: true,
    locked: false,
    claim_code: claimCode
  })
  if (ownerErr) console.error('owner provisioning failed', ownerErr.message)

  // Fire the scaffolding workflow. Falls back to 'manual' if no
  // GITHUB_TOKEN is configured (dev / local), in which case the row
  // sits in scaffolding state until someone runs the workflow.
  const workflowUrl = await dispatchWorkflow('scaffold-tenant.yml', {
    url: target,
    slug: inserted.slug,
    restaurant_id: inserted.id
  })
  if (workflowUrl) {
    await admin.from('vautcher_restaurants')
      .update({ deploy_log_url: workflowUrl })
      .eq('id', inserted.id)
  }

  return json({
    id: inserted.id,
    name: inserted.name,
    slug: inserted.slug,
    scaffold: workflowUrl ? 'dispatched' : 'manual',
    deploy: workflowUrl ? 'dispatched' : 'manual',
    deploy_log_url: workflowUrl,
    pages_url: `https://${inserted.slug}.pages.dev`,
    owner: ownerErr ? null : {
      placeholder_email: placeholderEmail,
      claim_code: claimCode
    }
  })
})
