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

// Strip HTML to a lowercase text blob suitable for naive substring search.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

// Map an OSM-style ISO country code to the TLD we expect the official
// restaurant site to use most of the time. .com / .net / .org are
// always allowed; the bias just means a clear country mismatch is one
// strike against the candidate.
function preferredTld(country: string): string | null {
  const c = (country || '').toUpperCase()
  if (c === 'CH') return '.ch'
  if (c === 'FR') return '.fr'
  if (c === 'DE') return '.de'
  if (c === 'IT') return '.it'
  if (c === 'AT') return '.at'
  if (c === 'BE') return '.be'
  return null
}

// Fetch a candidate page and check whether it credibly belongs to the
// OSM entry by looking for the city, postcode or country TLD.
// Verification ladder (strongest first):
//   1. OSM postcode appears verbatim in the page text  → STRONG match
//   2. OSM city/town/village name appears in the text  → MEDIUM match
//   3. TLD matches the OSM country                     → WEAK match
// Returns true if at least one signal hits. The home page is usually
// enough (most sites have the address in the footer); we additionally
// try common contact URLs when the home page text is inconclusive.
async function verifyCandidate(
  url: string,
  locality: string,
  postcode: string,
  country: string
): Promise<{ ok: boolean; signal: string }> {
  const tld = preferredTld(country)
  try {
    const u = new URL(url)
    const tldHit = tld && u.hostname.toLowerCase().endsWith(tld)

    const paths = ['', '/', '/contact', '/contact/', '/contact-us', '/nous-contacter', '/kontakt']
    const seen = new Set<string>()
    for (const p of paths) {
      const target = new URL(p || '/', u.origin).toString()
      if (seen.has(target)) continue
      seen.add(target)
      try {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 5000)
        const res = await fetch(target, {
          headers: { 'User-Agent': UA, 'Accept-Language': 'fr,en;q=0.7' },
          redirect: 'follow', signal: ctl.signal
        })
        clearTimeout(timer)
        if (!res.ok) continue
        const text = htmlToText(await res.text())
        if (postcode && text.includes(postcode.toLowerCase())) {
          return { ok: true, signal: `postcode ${postcode}` }
        }
        if (locality && text.includes(locality.toLowerCase())) {
          // City+TLD together is a confident match; city alone is still
          // accepted but flagged so the caller can tell it through.
          return { ok: true, signal: tldHit ? `city+tld` : 'city' }
        }
      } catch { /* try the next path */ }
    }

    // Nothing in the page text — accept only on a country-TLD match. A
    // restaurant in Geneva on example.ch with no extractable footer is
    // a much safer bet than a US developer studio on example.com.
    if (tldHit) return { ok: true, signal: 'tld-only' }
  } catch { /* fall through to no-match */ }
  return { ok: false, signal: 'no-match' }
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

  let body: { name?: string; locality?: string; postcode?: string; country?: string }
  try { body = await req.json() } catch { return json({ error: 'bad json' }, 400) }
  const name = String(body.name ?? '').trim()
  const locality = String(body.locality ?? '').trim()
  const postcode = String(body.postcode ?? '').trim()
  const country = String(body.country ?? '').trim()
  if (!name) return json({ error: 'name required' }, 400)

  // Search query mirrors what root would type into Google — name plus
  // the most specific locality we have.
  const qParts = [name, locality, postcode].filter(Boolean)
  const q = qParts.join(' ')
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

  // Walk candidates in DDG-rank order and accept the FIRST one whose
  // home/contact page contains the OSM address (or shares the country
  // TLD). This is the fix for the "Inglewood" case where DDG's top hit
  // was a US developer studio on a .com — the address check now sends
  // those to the discard pile and continues to the next result.
  const tried: Array<{ url: string; reason: string }> = []
  for (const href of anchors) {
    const real = await unwrapDdg(href)
    if (!real) continue
    let parsed: URL
    try { parsed = new URL(real) } catch { continue }
    if (!/^https?:$/.test(parsed.protocol)) continue
    if (isAggregator(parsed.hostname)) continue
    const verdict = await verifyCandidate(parsed.href, locality, postcode, country)
    if (verdict.ok) {
      return json({ url: parsed.href, source: 'ddg', signal: verdict.signal })
    }
    tried.push({ url: parsed.href, reason: verdict.signal })
    if (tried.length >= 6) break  // don't fan out indefinitely
  }

  return json({ url: null, source: null, tried })
})
