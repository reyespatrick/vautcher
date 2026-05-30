// ============================================================
//  osm-website-search — find a restaurant's official website
//
//  POST /functions/v1/osm-website-search
//    body: { name: string, locality?: string }
//    -> { url: string | null, source: 'ddg' | null }
//
//  Why this lives in an edge function:
//    DuckDuckGo's HTML endpoint blocks CORS, so the diner / restowner
//    SPAs can't hit it directly. We do the scrape server-side, filter
//    out aggregator domains (Facebook, TripAdvisor, Lafourchette, Maps,
//    …), and HEAD-check the candidate before returning so the caller
//    doesn't get a 404 fed into the scaffold-tenant pipeline.
//
//  Auth: any JWT — only the Découvrir UI calls it and that page is
//  already isRoot-gated.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

// Domains that index or rate restaurants — never the official site.
const AGGREGATORS = [
  'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'tripadvisor.', 'yelp.', 'thefork.com', 'lafourchette.com', 'thefork.fr',
  'google.com', 'google.fr', 'google.ch', 'google.de', 'goo.gl', 'maps.google.',
  'g.page', 'youtube.com', 'youtu.be',
  'openstreetmap.org', 'osm.org', 'wikipedia.org', 'wikimedia.org',
  'bing.com', 'yandex.', 'duckduckgo.com', 'qwant.com',
  'foursquare.com', 'swarmapp.com', 'happycow.net',
  'restaurantguru.com', 'restaurantes.com', 'michelin.com', 'guide.michelin.com',
  'gaultmillau.com', 'gault-millau.', 'pagesjaunes.fr', 'local.ch', 'search.ch',
  'doctolib.', 'malt.fr', 'linkedin.com',
  'pages.dev', 'vautcher.local'
]

function isAggregator(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return AGGREGATORS.some((a) => h === a.replace(/\.$/, '') || h.includes(a))
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS }
  })
}

// Decode the redirect link DuckDuckGo wraps every result in:
//   //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F
async function unwrapDdg(href: string): Promise<string | null> {
  try {
    const u = new URL(href, 'https://duckduckgo.com/')
    const uddg = u.searchParams.get('uddg')
    if (uddg) return decodeURIComponent(uddg)
    if (/^https?:\/\//i.test(href)) return href
    return null
  } catch { return null }
}

async function headOk(url: string): Promise<boolean> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 4000)
    // Some hosts reject HEAD — fall back to a tiny ranged GET if HEAD 405s.
    let res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctl.signal })
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': UA, 'Range': 'bytes=0-1024' },
        redirect: 'follow', signal: ctl.signal
      })
    }
    clearTimeout(timer)
    return res.status >= 200 && res.status < 400
  } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Any authenticated caller — the Discover page is already root-gated.
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'auth required' }, 401)
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: u } = await client.auth.getUser()
  if (!u?.user) return json({ error: 'auth required' }, 401)

  let body: { name?: string; locality?: string }
  try { body = await req.json() } catch { return json({ error: 'bad json' }, 400) }
  const name = String(body.name ?? '').trim()
  const locality = String(body.locality ?? '').trim()
  if (!name) return json({ error: 'name required' }, 400)

  const q = locality ? `${name} ${locality}` : name
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`

  let html = ''
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 7000)
    const res = await fetch(ddgUrl, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'fr,en;q=0.7' },
      signal: ctl.signal
    })
    clearTimeout(timer)
    if (!res.ok) return json({ url: null, source: null, note: `ddg ${res.status}` })
    html = await res.text()
  } catch (e) {
    return json({ url: null, source: null, note: `ddg fetch: ${(e as Error).message}` })
  }

  // Pull every result anchor in order — DuckDuckGo paints them like
  // <a class="result__a" href="//duckduckgo.com/l/?uddg=…">Title</a>
  const anchors = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi)]
    .map((m) => m[1])

  for (const href of anchors) {
    const real = await unwrapDdg(href)
    if (!real) continue
    let parsed: URL
    try { parsed = new URL(real) } catch { continue }
    if (!/^https?:$/.test(parsed.protocol)) continue
    if (isAggregator(parsed.hostname)) continue
    if (await headOk(parsed.href)) {
      return json({ url: parsed.href, source: 'ddg' })
    }
  }

  return json({ url: null, source: null })
})
