// ============================================================
//  vautcher-pass — Apple Wallet loyalty pass
//
//  One Supabase Edge Function, several routes:
//
//   GET  /vautcher-pass/pass/{profileId}
//        Builds + signs a fresh .pkpass and returns it. The diner's
//        "Add to Apple Wallet" button points here.
//
//   PassKit web service (Apple's device calls them automatically) —
//   the pass carries `webServiceURL` = .../vautcher-pass:
//   POST   /v1/devices/{deviceId}/registrations/{passTypeId}/{serial}
//   DELETE /v1/devices/{deviceId}/registrations/{passTypeId}/{serial}
//   GET    /v1/devices/{deviceId}/registrations/{passTypeId}
//   GET    /v1/passes/{passTypeId}/{serial}
//   POST   /v1/log
//
//   POST /vautcher-pass/push   { serialNumber }
//        Internal — called by the vautcher_stamps DB trigger. Sends an
//        APNs push so every device holding that pass refreshes it.
//
//  Deploy with --no-verify-jwt: Apple/Safari send no Supabase JWT;
//  this function does its own per-route auth.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildPkpass, loadCert, type PassCert } from './pkpass.ts'
import { pushPassUpdate } from './apns.ts'
import { ASSETS, WWDR_PEM } from './assets.ts'

// ---------- config ----------
const PASS_TYPE_ID = Deno.env.get('PASS_TYPE_ID') ?? 'pass.ch.reyes.patrick.vautcher'
const TEAM_ID = Deno.env.get('PASS_TEAM_ID') ?? 'E3ZZ2H78X4'
const CERT_PASSWORD = Deno.env.get('PASS_CERT_PASSWORD') ?? ''
const CERT_P12_BASE64 = Deno.env.get('PASS_CERT_P12_BASE64') ?? ''
const AUTH_SECRET = Deno.env.get('PASS_AUTH_SECRET') ?? CERT_PASSWORD
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEB_SERVICE_URL = `${SUPABASE_URL}/functions/v1/vautcher-pass`

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// ---------- cold-start: cert + embedded assets, loaded once ----------
let cert: PassCert | null = null
try {
  if (CERT_P12_BASE64) cert = loadCert(CERT_P12_BASE64, CERT_PASSWORD, WWDR_PEM)
} catch (e) {
  console.error('[vautcher-pass] certificate failed to load:', e)
}

// Pass images, decoded from the base64-embedded assets (assets.ts ships
// in the code bundle; loose files in assets/ would not).
const images: Record<string, Uint8Array> = {}
for (const [name, b64] of Object.entries(ASSETS)) {
  images[name] = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

// ---------- helpers ----------
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Per-pass authentication token Apple echoes back in `Authorization:
// ApplePass <token>`. Deterministic HMAC of the serial — no DB column.
async function authTokenFor(serial: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(serial))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function checkApplePassAuth(req: Request, serial: string): Promise<boolean> {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('ApplePass ') ? header.slice(10) : ''
  return token !== '' && token === (await authTokenFor(serial))
}

// When did this serial's pass last change? = newest stamp for the diner.
async function serialUpdatedAt(serial: string): Promise<Date> {
  const { data } = await sb
    .from('vautcher_stamps')
    .select('created_at')
    .eq('profile_id', serial)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.created_at ? new Date(data.created_at) : new Date(0)
}

// ---------- pass.json + .pkpass ----------
async function makePkpass(profileId: string): Promise<Uint8Array | null> {
  if (!cert) throw new Error('signing certificate unavailable')

  const { data: profile } = await sb
    .from('vautcher_profiles').select('name').eq('id', profileId).maybeSingle()
  if (!profile) return null

  const { data: cfg } = await sb
    .from('vautcher_config').select('stamps_required, reward').limit(1).maybeSingle()
  const required = cfg?.stamps_required ?? 10
  const reward = cfg?.reward ?? 'Une récompense offerte'

  const { count } = await sb
    .from('vautcher_stamps').select('*', { count: 'exact', head: true })
    .eq('profile_id', profileId)
  const collected = count ?? 0
  const remaining = Math.max(0, required - collected)
  const complete = collected >= required

  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID,
    teamIdentifier: TEAM_ID,
    serialNumber: profileId,
    organizationName: 'La Gioconda',
    description: 'Carte de fidélité La Gioconda',
    logoText: 'La Gioconda',
    foregroundColor: 'rgb(255,255,255)',
    backgroundColor: 'rgb(158,5,61)',
    labelColor: 'rgb(255,214,224)',
    webServiceURL: WEB_SERVICE_URL,
    authenticationToken: await authTokenFor(profileId),
    barcodes: [{
      format: 'PKBarcodeFormatQR',
      message: `vautcher-stamp:${profileId}`,
      messageEncoding: 'iso-8859-1',
    }],
    storeCard: {
      headerFields: [
        { key: 'count', label: 'TAMPONS', value: `${collected} / ${required}` },
      ],
      primaryFields: [
        { key: 'reward', label: complete ? 'RÉCOMPENSE DÉBLOQUÉE' : 'VOTRE RÉCOMPENSE', value: reward },
      ],
      secondaryFields: [
        { key: 'holder', label: 'CARTE DE', value: profile.name },
      ],
      auxiliaryFields: [
        {
          key: 'status', label: 'PROGRÈS',
          value: complete ? 'Carte complète 🎉' : `Encore ${remaining} ${remaining > 1 ? 'visites' : 'visite'}`,
        },
      ],
      backFields: [
        { key: 'how', label: 'Comment ça marche', value: 'Une visite, un tampon. Présentez le code de cette carte au restaurant à chaque passage.' },
        { key: 'reward_back', label: 'Récompense', value: `${reward} dès ${required} tampons.` },
        { key: 'place', label: 'La Gioconda', value: 'Pizzeria · Cointrin, Genève' },
      ],
    },
  }

  return await buildPkpass(passJson, images, cert)
}

function pkpassResponse(bytes: Uint8Array, lastModified?: Date): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/vnd.apple.pkpass',
    'content-disposition': 'attachment; filename="lagioconda.pkpass"',
  }
  if (lastModified) headers['last-modified'] = lastModified.toUTCString()
  return new Response(bytes, { headers })
}

// ---------- routes ----------
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  // Strip the function-name prefix so paths read as in the spec.
  const path = url.pathname.replace(/^\/vautcher-pass/, '') || '/'
  const seg = path.split('/').filter(Boolean)

  // --- GET /pass/{profileId} : the "Add to Apple Wallet" download ---
  if (req.method === 'GET' && seg[0] === 'pass' && seg[1]) {
    try {
      const bytes = await makePkpass(seg[1])
      if (!bytes) return json({ error: 'unknown profile' }, 404)
      return pkpassResponse(bytes, await serialUpdatedAt(seg[1]))
    } catch (e) {
      console.error('[pass] build failed:', e)
      return json({ error: 'pass generation failed' }, 500)
    }
  }

  // --- POST /push : DB trigger asks us to push a serial's update ---
  if (req.method === 'POST' && seg[0] === 'push') {
    const bearer = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
    if (bearer !== SERVICE_ROLE_KEY) return json({ error: 'forbidden' }, 403)
    const { serialNumber } = await req.json().catch(() => ({}))
    if (!serialNumber) return json({ error: 'serialNumber required' }, 400)

    const { data: regs } = await sb
      .from('vautcher_pass_registrations')
      .select('push_token').eq('serial_number', serialNumber)
    const tokens = (regs ?? []).map((r) => r.push_token)
    if (!cert) return json({ error: 'cert unavailable' }, 500)

    const stale = await pushPassUpdate(tokens, cert.certPem, cert.keyPem, PASS_TYPE_ID)
    if (stale.length) {
      await sb.from('vautcher_pass_registrations')
        .delete().eq('serial_number', serialNumber).in('push_token', stale)
    }
    return json({ pushed: tokens.length - stale.length, pruned: stale.length })
  }

  // --- PassKit web service: /v1/... ---
  if (seg[0] === 'v1') {
    // POST /v1/log — Apple posts diagnostic messages here.
    if (seg[1] === 'log' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      console.log('[passkit-log]', JSON.stringify(body))
      return new Response(null, { status: 200 })
    }

    // /v1/devices/{deviceId}/registrations/{passTypeId}[/{serial}]
    if (seg[1] === 'devices' && seg[3] === 'registrations') {
      const deviceId = seg[2]
      const passTypeId = seg[4]
      const serial = seg[5]

      // Register / unregister a device for a specific pass.
      if (serial) {
        if (!(await checkApplePassAuth(req, serial))) {
          return new Response(null, { status: 401 })
        }
        if (req.method === 'POST') {
          const { pushToken } = await req.json().catch(() => ({}))
          if (!pushToken) return new Response(null, { status: 400 })
          const { data: existing } = await sb
            .from('vautcher_pass_registrations')
            .select('device_library_id')
            .eq('device_library_id', deviceId).eq('serial_number', serial).maybeSingle()
          await sb.from('vautcher_pass_registrations').upsert({
            device_library_id: deviceId,
            serial_number: serial,
            pass_type_id: passTypeId,
            push_token: pushToken,
            updated_at: new Date().toISOString(),
          })
          return new Response(null, { status: existing ? 200 : 201 })
        }
        if (req.method === 'DELETE') {
          await sb.from('vautcher_pass_registrations').delete()
            .eq('device_library_id', deviceId).eq('serial_number', serial)
          return new Response(null, { status: 200 })
        }
      }

      // GET /v1/devices/{deviceId}/registrations/{passTypeId}
      // -> serials updated since the given tag (no auth, per Apple spec).
      if (!serial && req.method === 'GET') {
        const since = url.searchParams.get('passesUpdatedSince')
        const sinceDate = since ? new Date(since) : null
        const { data: regs } = await sb
          .from('vautcher_pass_registrations')
          .select('serial_number')
          .eq('device_library_id', deviceId).eq('pass_type_id', passTypeId)

        const serials: string[] = []
        for (const r of regs ?? []) {
          const updated = await serialUpdatedAt(r.serial_number)
          if (!sinceDate || updated > sinceDate) serials.push(r.serial_number)
        }
        if (serials.length === 0) return new Response(null, { status: 204 })
        return json({ lastUpdated: new Date().toISOString(), serialNumbers: serials })
      }
    }

    // GET /v1/passes/{passTypeId}/{serial} — the refreshed pass.
    if (seg[1] === 'passes' && seg[3] && req.method === 'GET') {
      const serial = seg[3]
      if (!(await checkApplePassAuth(req, serial))) {
        return new Response(null, { status: 401 })
      }
      const updated = await serialUpdatedAt(serial)
      const ifModifiedSince = req.headers.get('if-modified-since')
      if (ifModifiedSince && updated <= new Date(ifModifiedSince)) {
        return new Response(null, { status: 304 })
      }
      const bytes = await makePkpass(serial)
      if (!bytes) return new Response(null, { status: 404 })
      return pkpassResponse(bytes, updated)
    }
  }

  return json({ error: 'not found' }, 404)
}

Deno.serve((req) => handle(req).catch((e) => {
  console.error('[vautcher-pass] unhandled:', e)
  return json({ error: 'internal error' }, 500)
}))
