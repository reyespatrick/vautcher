// ============================================================
//  rephrase-text — AI "make my description nicer" for restowner.
//
//  POST /functions/v1/rephrase-text   body: { text }
//    → { text: "<reformulated, <=200 chars>" }
//
//  Auth: the caller must be a vautcher_moderator OR an unlocked
//  vautcher_owner (verify_jwt is ON, so the JWT is already validated;
//  this extra check stops a logged-in diner from using it as a free LLM).
//  The Anthropic key stays server-side (project secret ANTHROPIC_API_KEY).
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_CHARS = 200

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

// Two prompts: REPHRASE when the owner already wrote something, and
// COMPOSE when only the title exists. The compose path also has to be
// careful not to invent facts (dates, prices, dishes), since with just
// a title there is nothing concrete to anchor those to.
const SYSTEM_REPHRASE =
  'Tu es rédacteur pour une app de restaurants. Reformule la description ' +
  "(événement ou offre) en français : attrayante, chaleureuse, soignée. " +
  'Contraintes STRICTES : maximum 200 caractères, 1 à 2 phrases, garde tous ' +
  'les faits (dates, prix, plats, horaires) intacts, n\'invente rien, pas de ' +
  'guillemets. Réponds UNIQUEMENT avec le texte reformulé.'

const SYSTEM_COMPOSE =
  'Tu es rédacteur pour une app de restaurants. À partir du titre d’un ' +
  'événement ou d’une offre, écris une description courte en français : ' +
  'attrayante, chaleureuse, donne envie de venir. Contraintes STRICTES : ' +
  'maximum 200 caractères, 1 à 2 phrases, n’invente AUCUN fait spécifique ' +
  '(pas de date, prix, plat ou horaire qui ne soit pas dans le titre), reste ' +
  'général et évocateur. Pas de guillemets. Réponds UNIQUEMENT avec la ' +
  'description.'

async function callerEmail(req: Request): Promise<string | null> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data } = await userClient.auth.getUser()
  return (data?.user?.email || '').toLowerCase() || null
}

async function authorized(email: string | null): Promise<boolean> {
  if (!email) return false
  const { data: mod } = await admin.from('vautcher_moderators')
    .select('email').eq('email', email).maybeSingle()
  if (mod) return true
  const { data: own } = await admin.from('vautcher_owners')
    .select('email').eq('email', email).eq('locked', false).maybeSingle()
  return !!own
}

// Hard cap at MAX_CHARS, trimming back to a word boundary when possible.
function cap(s: string): string {
  s = (s || '').trim().replace(/^["“”']+|["“”']+$/g, '')
  if (s.length <= MAX_CHARS) return s
  const cut = s.slice(0, MAX_CHARS)
  const sp = cut.lastIndexOf(' ')
  return (sp > MAX_CHARS * 0.6 ? cut.slice(0, sp) : cut).trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    const email = await callerEmail(req)
    if (!(await authorized(email))) return json({ error: 'not authorized' }, 403)

    const body = await req.json().catch(() => ({} as any))
    const text = (body?.text ?? '').toString().trim()
    const title = (body?.title ?? '').toString().trim()
    if (!text && !title) return json({ error: 'empty' }, 400)

    // Compose-from-title vs rephrase-existing-text. When both are
    // present, give Claude the title for context and ask it to refine
    // the existing description against that title.
    const compose = !text
    const system = compose ? SYSTEM_COMPOSE : SYSTEM_REPHRASE
    const userContent = compose
      ? `Titre : ${title}`
      : (title
          ? `Titre : ${title}\nDescription actuelle : ${text}`
          : text
        )

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system,
        messages: [{ role: 'user', content: userContent.slice(0, 1200) }]
      })
    })
    if (!res.ok) return json({ error: 'ai_failed' }, 502)
    const data = await res.json()
    const out = cap(data?.content?.[0]?.text || '')
    if (!out) return json({ error: 'ai_failed' }, 502)
    return json({ text: out })
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})
