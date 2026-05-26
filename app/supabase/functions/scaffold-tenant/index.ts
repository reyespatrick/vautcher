// ============================================================
//  scaffold-tenant — turn a restaurant URL into a vautcher tenant.
//
//  POST /functions/v1/scaffold-tenant
//    body: { url: "https://www.somerestaurant.ch/" }
//
//  Steps:
//   1. Verify caller is a moderator (RLS-style via JWT email lookup).
//   2. Crawl the URL (depth 2, ≤25 pages, prioritising menu/carte and
//      contact-ish urls so the most diner-relevant content lands first
//      even when the cap is reached).
//   3. Extract verbatim content blocks (cheerio): headings, paragraphs,
//      images, plus leaf <div>/<li>/<dd> text the strict no-invention
//      extractor needs. Drop orphan headings.
//   4. Sniff brand colour from the site's own CSS (frequency-tally of
//      `color:` / `background:` declarations, neutrals filtered).
//   5. Insert a vautcher_restaurants row with the resulting config.
//   6. If GITHUB_TOKEN is set, fire a workflow_dispatch on the
//      deploy-tenant.yml workflow so the row gets a live pages.dev
//      build. Otherwise return the slug for manual deploy.
//
//  Verify-JWT is ON: the caller's JWT is required so we can check
//  vautcher_moderators server-side. RLS-style auth, not a public
//  endpoint.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'
import * as cheerio from 'npm:cheerio@1.2.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') || ''
const GITHUB_REPO = Deno.env.get('GITHUB_REPO') || 'reyespatrick/vautcher'
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-4-6'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
// Use a real browser UA — some WordPress sites (dapaolo.ch among them)
// serve a stripped-down skeleton without entry titles to anything that
// identifies itself as a bot/crawler. The scraper otherwise looks at
// half-empty article cards and can't find dish names.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

// CORS headers — the function is called from restowner's browser
// origin (https://restowner.pages.dev), so it must answer the
// preflight OPTIONS and echo back Access-Control-Allow-* on every
// response. Without these the browser refuses to even send the POST.
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
  // Verify the JWT — getUser does the signature check via Supabase's
  // anon-key client, then we look up vautcher_moderators server-side.
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
function slugify(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'restaurant'
}
// 6-char uppercase code (no O/0/I/1/Z/2 ambiguity).
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
  // Astronomical odds we ever get here, but fall back deterministically.
  return generateClaimCode() + Date.now().toString(36).slice(-2).toUpperCase()
}

async function uniqueSlug(base: string): Promise<string> {
  const { data: existing } = await admin.from('vautcher_restaurants')
    .select('slug').like('slug', `${base}%`)
  const taken = new Set((existing || []).map((r: any) => r.slug))
  if (!taken.has(base)) return base
  for (let i = 2; i < 50; i++) {
    const cand = `${base}-${i}`
    if (!taken.has(cand)) return cand
  }
  return `${base}-${Date.now()}`
}

// ---------- CRAWL ----------
async function fetchHtml(url: string): Promise<{ html: string; url: string } | null> {
  try {
    // Full browser-like headers. WP sites behind Cloudflare / Wordfence /
    // similar serve a stripped skeleton (no entry-title, etc.) when the
    // request doesn't look like a real browser. Sec-Fetch-* + a normal
    // Accept matter as much as the UA.
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'fr-CH,fr;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      }
    })
    if (!res.ok) return null
    return { html: await res.text(), url: res.url }
  } catch { return null }
}
// Same-site check that tolerates a leading "www." swap. dapaolo.ch's
// home page lives at www.dapaolo.ch but every internal link points to
// dapaolo.ch (no www) — a strict origin comparison rejects them as
// cross-origin and the crawl stops at the home page. Strip "www."
// from both sides before comparing so the two count as the same site.
// Still rejects genuinely different hosts (subdomain.foo.com vs foo.com
// only match if one has "www." and the other doesn't).
function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    if (ua.protocol !== ub.protocol) return false
    const norm = (h: string) => h.replace(/^www\./i, '').toLowerCase()
    return norm(ua.hostname) === norm(ub.hostname)
  } catch { return false }
}
function isAssetUrl(u: string): boolean {
  return /\.(css|js|json|xml|ico|svg|png|jpe?g|gif|webp|pdf|mp4|webm|woff2?)(\?|$)/i.test(u)
}

// BFS crawl with a configurable depth and a page cap. Depth is the
// number of link-hops from the start URL — depth 0 is the start page
// itself, depth 1 is anything linked from it, depth 2 is one level
// further (e.g. /carte → /carte/pizzas). Stays same-origin and skips
// asset URLs.
//
// Pages are visited in priority order: menu / carte / specialty
// pages first (highest diner-value), then contact / info / hours,
// then everything else. The priority sort is applied to the queue
// AFTER each new-link batch is added so deeper menu pages jump ahead
// of shallow generic pages.
async function crawl(startUrl: string, maxDepth = 2, maxPages = 25) {
  const visited = new Set<string>()
  const pages: { url: string; html: string; $: cheerio.CheerioAPI }[] = []
  const queue: { u: string; d: number }[] = [{ u: startUrl, d: 0 }]

  const priority = (u: string): number => {
    // Lower number = higher priority. Sort key, not user-visible.
    if (/menu|carte|plat|sp[ée]cialit|dish/i.test(u)) return 0
    if (/contact|infos?|coord|adress|hor[ai]/i.test(u)) return 1
    return 2
  }

  while (queue.length && visited.size < maxPages) {
    const { u, d } = queue.shift()!
    if (visited.has(u)) continue
    visited.add(u)
    const page = await fetchHtml(u)
    if (!page) continue
    const $ = cheerio.load(page.html)
    pages.push({ url: page.url, html: page.html, $ })
    if (d >= maxDepth) continue

    $('a[href]').each((_: number, el: cheerio.Element) => {
      const href = $(el).attr('href')
      if (!href) return
      if (/^(#|javascript:|mailto:|tel:|data:)/i.test(href)) return
      try {
        const abs = new URL(href, page.url).href
        if (!sameOrigin(abs, startUrl)) return
        if (isAssetUrl(abs)) return
        if (visited.has(abs)) return
        if (queue.find((q) => q.u === abs)) return
        queue.push({ u: abs, d: d + 1 })
      } catch { /* ignore bad URLs */ }
    })
    // Re-sort the entire queue so any high-value page (menu, contact)
    // discovered at any depth is visited before generic ones.
    queue.sort((a, b) => priority(a.u) - priority(b.u))
  }
  return pages
}

function isIconImage(src: string): boolean {
  return /(favicon|logo|icon|sprite|spacer|arrow_)/i.test(src)
}
// Resolve the "real" image URL from an <img> element. WordPress
// lazy-loading replaces src with a data:image/svg placeholder and
// stuffs the real URL into data-lazy-src / data-lazy-srcset (and
// srcset for non-lazy fallback). Walk the candidates in order.
function realImageUrl($el: cheerio.Cheerio<cheerio.Element>): string | null {
  const candidates = [
    $el.attr('data-lazy-src'),
    $el.attr('data-src'),
    $el.attr('data-original'),
    $el.attr('src')
  ]
  for (const c of candidates) {
    if (c && !c.startsWith('data:')) return c
  }
  // Parse srcset / data-lazy-srcset: "url1 480w, url2 768w" — take the
  // largest entry.
  const sets = [$el.attr('data-lazy-srcset'), $el.attr('srcset')]
  for (const s of sets) {
    if (!s) continue
    const entries = s.split(',').map((e) => e.trim()).filter(Boolean)
      .map((e) => {
        const [url, sizeStr] = e.split(/\s+/)
        const size = parseInt((sizeStr || '0').replace(/[^\d]/g, ''), 10) || 0
        return { url, size }
      })
      .filter((e) => e.url && !e.url.startsWith('data:'))
    if (entries.length) {
      entries.sort((a, b) => b.size - a.size)
      return entries[0].url
    }
  }
  return null
}

// Quality verdict based purely on structured fields. The moderator
// uses this to decide whether to promote the tenant to a higher
// scaffold tier (AI/vision) or accept T1 as-is.
function scoreScaffold(
  structured: {
    address: string | null
    phone: string | null
    hours: any[]
    description: string
    specialties: any[]
    menu: any[]
    images: any[]
  }
): { quality: 'ok'|'low'|'bad'; reasons: string[] } {
  const reasons: string[] = []
  if (!structured.address) reasons.push('address not found')
  if (!structured.phone) reasons.push('phone not found')
  if (!structured.hours.length) reasons.push('opening hours not found')
  if (!structured.description || structured.description.length < 40) {
    reasons.push('restaurant description too short or missing')
  }
  if (!structured.menu.length) reasons.push('no menu extracted')
  if (structured.images.length < 3) reasons.push(`only ${structured.images.length} usable image(s)`)

  let quality: 'ok'|'low'|'bad' = 'ok'
  if (reasons.length >= 4) quality = 'bad'
  else if (reasons.length >= 1) quality = 'low'
  return { quality, reasons }
}

// ---------- BRAND COLOUR ----------
function isNeutralHex(hex: string): boolean {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6) return true
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  if (mx - mn < 30) return true
  if (mx > 240 || mx < 30) return true
  return false
}
function darken(hex: string, amount = 0.3): string {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = Math.max(0, Math.floor(parseInt(h.slice(0, 2), 16) * (1 - amount)))
  const g = Math.max(0, Math.floor(parseInt(h.slice(2, 4), 16) * (1 - amount)))
  const b = Math.max(0, Math.floor(parseInt(h.slice(4, 6), 16) * (1 - amount)))
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
}
// Fetches all same-origin stylesheets + inline <style> content and
// returns the concatenated CSS string. Cached at the call site.
async function loadAllCss($: cheerio.CheerioAPI, baseUrl: string): Promise<string> {
  const cssUrls: string[] = []
  $('link[rel="stylesheet"][href]').each((_: number, el: cheerio.Element) => {
    const href = $(el).attr('href')
    if (!href) return
    try {
      const abs = new URL(href, baseUrl).href
      if (sameOrigin(abs, baseUrl)) cssUrls.push(abs)
    } catch { /* ignore */ }
  })
  let css = ''
  $('style').each((_: number, el: cheerio.Element) => { css += '\n' + $(el).text() })
  for (const u of cssUrls.slice(0, 6)) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA } })
      if (r.ok) css += '\n' + await r.text()
    } catch { /* skip */ }
  }
  return css
}

// Most-frequent saturated colour in the site's CSS — used as a body
// brand colour. Falls back to null when there are no saturated hits.
function frequencyBrandColor(css: string): string | null {
  if (!css) return null
  const tally = new Map<string, number>()
  const re = /(?:color|background(?:-color)?)\s*:\s*(#[0-9a-fA-F]{3,8})/g
  let m
  while ((m = re.exec(css))) {
    const hex = m[1].toLowerCase().slice(0, 7)
    if (isNeutralHex(hex)) continue
    tally.set(hex, (tally.get(hex) || 0) + 1)
  }
  if (!tally.size) return null
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

// Pulls the background-color from header-ish CSS selectors. Tries the
// usual suspects (header, .site-header, .navbar, etc.) and returns
// the first hex it finds. This is the "tenant's dark header" colour
// the frequency tally tends to miss because the header CSS only
// declares it once or twice vs. body colours used everywhere.
function headerBgFromCss(css: string): string | null {
  if (!css) return null
  // Walk every rule and only consider ones whose selector list contains
  // a header-like token. The regex captures: full selector, declarations
  // block. Then we scan the block for background-color.
  const ruleRe = /([^{}]+)\{([^}]+)\}/g
  let r
  while ((r = ruleRe.exec(css))) {
    const sel = r[1].trim().toLowerCase()
    const body = r[2]
    // Skip @media wrappers (they don't have direct declarations).
    if (sel.startsWith('@')) continue
    if (!/(^|[\s,>+~])(header|\.header|\.site-header|\.main-header|\.page-header|\.navbar|\.navbar-default|\.topbar|\.site-nav|\.masthead)([\s,>+~:.#\[]|$)/.test(sel)) continue
    const m = body.match(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/i)
    if (!m) continue
    const hex = m[1].toLowerCase().slice(0, 7)
    if (isNeutralHex(hex)) continue
    return hex
  }
  return null
}

// Parses <link href="https://fonts.googleapis.com/css...?family=..."> tags
// and returns the list of font families. Skips webfont sources we can't
// safely redistribute (Adobe, MyFonts, self-hosted commercial paths).
function extractGoogleFonts($: cheerio.CheerioAPI): { families: string[]; href: string | null } {
  const families: string[] = []
  let href: string | null = null
  $('link[rel="stylesheet"][href], link[rel="preconnect"][href]').each((_: number, el: cheerio.Element) => {
    const h = $(el).attr('href') || ''
    if (!/fonts\.googleapis\.com\/css/.test(h)) return
    href = h
    // family=Name|Name2 (css1) or family=Name&family=Name2 (css2)
    const params = new URLSearchParams(h.split('?')[1] || '')
    for (const v of params.getAll('family')) {
      const name = v.split(':')[0].replace(/\+/g, ' ').trim()
      if (name && !families.includes(name)) families.push(name)
    }
  })
  return { families, href }
}

// Picks the "decorative" / heading family from the captured Google
// Fonts. Heuristic: scripty / serif-decorative families have markers
// like "Vibes", "Script", "Display", "Cursive", common decorative
// surnames; otherwise default to the LAST family declared (sites
// typically declare body first, decorative second).
const DECORATIVE_HINTS = [
  'Vibes', 'Script', 'Display', 'Cursive', 'Handwriting',
  'Allura', 'Dancing', 'Lobster', 'Pacifico', 'Sacramento',
  'Tangerine', 'Rufina', 'Playfair', 'Cinzel', 'Italianno',
  'Great', 'Yellowtail', 'Cookie', 'Kalam', 'Caveat'
]
function pickHeadingFont(families: string[]): string | null {
  if (!families.length) return null
  const decorative = families.find((f) => DECORATIVE_HINTS.some((h) => f.includes(h)))
  if (decorative) return decorative
  return families[families.length - 1]
}

// ---------- STRUCTURED EXTRACTORS ----------
//
// The scaffolder needs to produce real restaurant data (hours, menu,
// contacts, gallery, description, branding), not just a bag of text
// blocks. We try the highest-quality source first and fall through:
//
//   1. JSON-LD (schema.org Restaurant/FoodEstablishment/LocalBusiness)
//   2. Microdata (itemprop="*")
//   3. Open Graph + meta tags
//   4. Heuristic class names (.menu-item, .opening-hours, …)
//   5. Regex pattern matching across full-page text
//
// Each extractor is independent. If JSON-LD gives us hours, we use them
// verbatim; otherwise we fall to the regex matcher.

// Parse every <script type="application/ld+json"> on the page and merge
// any restaurant-like entity we find.
function extractJsonLd($: cheerio.CheerioAPI): any {
  const out: any = {}
  $('script[type="application/ld+json"]').each((_: number, el: cheerio.Element) => {
    try {
      const raw = $(el).contents().text() || $(el).text() || ''
      if (!raw.trim()) return
      const data = JSON.parse(raw)
      const arr = Array.isArray(data) ? data : (data['@graph'] || [data])
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue
        const type = item['@type']
        const types = Array.isArray(type) ? type : [type]
        const restaurantLike = types.some((t: string) =>
          /restaurant|foodestablishment|cafe|bar|localbusiness|organization/i.test(String(t || '')))
        if (!restaurantLike) continue
        if (item.name && !out.name) out.name = String(item.name)
        if (item.description && !out.description) out.description = String(item.description)
        if (item.telephone && !out.telephone) out.telephone = String(item.telephone)
        if (item.email && !out.email) out.email = String(item.email)
        if (item.image && !out.image) {
          const img = Array.isArray(item.image) ? item.image[0] : item.image
          out.image = typeof img === 'string' ? img : (img?.url || null)
        }
        if (item.address && !out.address) out.address = item.address
        if (item.openingHours && !out.openingHours) out.openingHours = item.openingHours
        if (item.openingHoursSpecification && !out.openingHoursSpec) {
          out.openingHoursSpec = item.openingHoursSpecification
        }
        if (item.servesCuisine && !out.cuisine) out.cuisine = item.servesCuisine
        if (item.priceRange && !out.priceRange) out.priceRange = String(item.priceRange)
        if (item.url && !out.url) out.url = String(item.url)
      }
    } catch { /* unparseable JSON-LD — try the next script tag */ }
  })
  return out
}

// Flatten a schema.org PostalAddress object into a single string.
function formatLdAddress(a: any): string | null {
  if (!a) return null
  if (typeof a === 'string') return a.replace(/\s+/g, ' ').trim()
  if (Array.isArray(a)) return formatLdAddress(a[0])
  const parts: string[] = []
  if (a.streetAddress) parts.push(String(a.streetAddress))
  const cityLine = [a.postalCode, a.addressLocality].filter(Boolean).join(' ').trim()
  if (cityLine) parts.push(cityLine)
  if (a.addressCountry) {
    const c = typeof a.addressCountry === 'string'
      ? a.addressCountry
      : (a.addressCountry.name || a.addressCountry['@id'])
    if (c && c.length > 2) parts.push(String(c))
  }
  const flat = parts.join(', ').trim()
  return flat || null
}

// schema.org day codes → French day names.
const DAY_FR: Record<string, string> = {
  Mo: 'Lundi', Tu: 'Mardi', We: 'Mercredi', Th: 'Jeudi',
  Fr: 'Vendredi', Sa: 'Samedi', Su: 'Dimanche',
  Monday: 'Lundi', Tuesday: 'Mardi', Wednesday: 'Mercredi',
  Thursday: 'Jeudi', Friday: 'Vendredi', Saturday: 'Samedi', Sunday: 'Dimanche',
  PublicHolidays: 'Jours fériés'
}

// Final-pass normalizer applied to EVERY {days, time} entry that ends
// up in config.hours, whether it came from the scraper or the AI. The
// dapaolo.ch test revealed that scrapers and LLMs both faithfully echo
// "WEEKDAYS" / "11:30 TO 23:00" from English-labelled source sites; we
// want a single canonical French form in the stored config.
function normalizeHourEntry(e: { days?: string; time?: string; service?: string | null }): { days: string; time: string; service?: string | null } {
  const dayBlocks: Record<string, string> = {
    'weekdays': 'Lundi – Vendredi',
    'weekday': 'Lundi – Vendredi',
    'weekend': 'Samedi – Dimanche',
    'weekends': 'Samedi – Dimanche',
    'weekends & holidays': 'Samedi, Dimanche & jours fériés',
    'weekend & holidays': 'Samedi, Dimanche & jours fériés',
    'holidays': 'Jours fériés',
    'public holidays': 'Jours fériés',
    'every day': 'Tous les jours',
    'everyday': 'Tous les jours',
    'all days': 'Tous les jours',
    'daily': 'Tous les jours'
  }
  const dayTokens: Record<string, string> = {
    monday: 'Lundi', tuesday: 'Mardi', wednesday: 'Mercredi',
    thursday: 'Jeudi', friday: 'Vendredi', saturday: 'Samedi', sunday: 'Dimanche',
    mon: 'Lundi', tue: 'Mardi', tues: 'Mardi', wed: 'Mercredi',
    thu: 'Jeudi', thur: 'Jeudi', thurs: 'Jeudi',
    fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche',
    // French is identity-mapped so we just title-case it.
    lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi',
    vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche'
  }

  // ---- Days ----
  let days = String(e.days ?? '').trim().replace(/\s+/g, ' ')
  // Try a multi-word "block" match first (weekdays, weekends, etc.).
  const blockKey = days.toLowerCase()
  if (dayBlocks[blockKey]) {
    days = dayBlocks[blockKey]
  } else {
    // Walk tokens. Keep separators intact.
    days = days
      .replace(/\s*[-–]\s*/g, ' – ')
      .replace(/\s+to\s+/gi, ' – ')
      .replace(/\s*&\s*/g, ' & ')
      .replace(/\s*,\s*/g, ', ')
    days = days.replace(/[A-Za-zÀ-ÿ]+/g, (w) => {
      const k = w.toLowerCase()
      return dayTokens[k] || w
    })
  }

  // ---- Time ----
  let time = String(e.time ?? '').trim()
  time = time
    .replace(/\s+to\s+/gi, ' – ')           // "11:30 TO 14:00"
    .replace(/\s*[-–]\s*/g, ' – ')           // hyphens → en-dash w/ spaces
    .replace(/(\d{1,2}):(\d{2})/g, '$1h$2')  // 11:30 → 11h30
    .replace(/\s+/g, ' ')
    .trim()

  return { days, time, service: e.service ?? null }
}
function frDay(d: string): string {
  const k = String(d || '').split('/').pop() || ''
  return DAY_FR[k] || DAY_FR[k.slice(0, 2)] || k
}

// "Mo-Sa 11:30-14:00,18:30-23:30" → [{days, time}, …]
function parseSchemaHoursStr(s: string): { days: string; time: string }[] {
  const out: { days: string; time: string }[] = []
  const m = String(s).match(/^([A-Za-z]+(?:-[A-Za-z]+)?(?:,\s*[A-Za-z]+(?:-[A-Za-z]+)?)*)\s+(.+)$/)
  if (!m) return out
  const days = m[1].includes('-')
    ? m[1].split('-').map(frDay).join(' – ')
    : m[1].split(',').map((p) => frDay(p.trim())).join(', ')
  for (const t of m[2].split(',')) {
    const time = t.trim().replace(/(\d{1,2}):(\d{2})/g, '$1h$2').replace(/-/, ' – ')
    if (time) out.push({ days, time })
  }
  return out
}

function parseSchemaHoursSpec(spec: any): { days: string; time: string }[] {
  const arr = Array.isArray(spec) ? spec : [spec]
  const out: { days: string; time: string }[] = []
  for (const s of arr) {
    if (!s) continue
    const dayList = Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek]
    const days = dayList.filter(Boolean).map(frDay).join(', ')
    const fmt = (t: any) => String(t || '').replace(/(\d{1,2}):(\d{2})(?::\d{2})?/, '$1h$2')
    const time = `${fmt(s.opens)} – ${fmt(s.closes)}`
    if (days && s.opens && s.closes) out.push({ days, time })
  }
  return out
}


// ---------- BUILD CONFIG ----------
// Cheap, deterministic config baseline. T1 (and T2's pre-AI step) read
// only the structured stuff: og: meta, page title, JSON-LD, brand/CSS,
// gallery <img>. No per-CMS DOM heuristics — those were brittle and
// site-specific. If a value isn't expressed structurally, T1 returns
// nothing for it; T2's AI call fills the gaps (with verbatim gating).
function buildConfig(pages: { url: string; html: string; $: cheerio.CheerioAPI }[]) {
  const home = pages[0]
  const $h = home.$
  const baseUrl = home.url

  const meta = (name: string, attr = 'name') =>
    $h(`meta[${attr}="${name}"]`).attr('content') || null
  const og = {
    title: meta('og:title', 'property'),
    description: meta('og:description', 'property'),
    image: meta('og:image', 'property'),
    site_name: meta('og:site_name', 'property')
  }

  const pageTitle = ($h('title').first().text() || '').trim()
  const name = og.title || og.site_name || pageTitle || 'Restaurant'

  // Collect <img> sources across every crawled page for the gallery.
  // Cap at 12, dedupe by URL, skip icon-ish and known-asset paths.
  const images: { src: string; alt: string }[] = []
  const seenSrc = new Set<string>()
  for (const p of pages) {
    p.$('img').each((_: number, el: cheerio.Element) => {
      if (images.length >= 12) return
      const $img = p.$(el)
      const src = realImageUrl($img)
      if (!src) return
      let abs: string
      try { abs = new URL(src, p.url).href } catch { return }
      if (isIconImage(abs)) return
      if (/\.(svg|ico|webmanifest)(\?|$)/i.test(abs)) return
      if (seenSrc.has(abs)) return
      seenSrc.add(abs)
      images.push({ src: abs, alt: ($img.attr('alt') || '').trim() })
    })
    if (images.length >= 12) break
  }

  return { name, og, baseUrl, images }
}

// ---------- T2: STRUCTURAL-MARKDOWN OUTLINE ----------
// Walk a crawled page's DOM and emit a compact markdown outline that
// preserves the semantic shape (headings, list items, paragraphs,
// prices in context) without the class-name noise. The AI reads these
// outlines instead of raw HTML — it's far cheaper in tokens and
// keeps the model focused on content, not markup.
//
// Layout:
//   # https://www.example.com/menu/
//   ## Notre carte
//   ### Les entrées
//   - Salade verte (7.-)
//   - Salade de crudités (8.-)
//   …
function pageToOutline($: cheerio.CheerioAPI, url: string): string {
  // Clone before mutating so we don't disturb the original $.
  const $c = cheerio.load($.html())
  $c('script, style, noscript, svg, iframe, link, meta').remove()
  // Drop site chrome on archive/menu pages.
  $c('nav, header, footer').remove()

  const lines: string[] = [`# ${url}`]
  const seenLine = new Set<string>()
  const push = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim()
    if (!t) return
    if (seenLine.has(t)) return
    seenLine.add(t)
    lines.push(t)
  }

  // Direct text content of an element (its own text nodes only),
  // collapsed. Used for elements like <li> whose nested blocks are
  // walked separately.
  const ownText = (el: cheerio.Element): string => {
    const $el = $c(el)
    return $el.clone().children().remove().end().text().replace(/\s+/g, ' ').trim()
  }
  // Full inner text (including descendants), collapsed. Capped so a
  // single sprawling <p> can't eat the whole outline.
  const fullText = (el: cheerio.Element, cap = 400): string => {
    const t = $c(el).text().replace(/\s+/g, ' ').trim()
    return t.length > cap ? t.slice(0, cap) + '…' : t
  }

  function walk(el: cheerio.Element, listDepth: number) {
    if (!el || !(el as any).tagName) return
    const tag = ((el as any).tagName || '').toLowerCase()

    // Headings — emit as # / ## / ### …
    const h = tag.match(/^h([1-6])$/)
    if (h) {
      push('#'.repeat(parseInt(h[1], 10)) + ' ' + fullText(el, 200))
      return
    }
    // Paragraph — emit as a plain line.
    if (tag === 'p') {
      push(fullText(el))
      return
    }
    // List item — emit as "- text", recurse into nested lists.
    if (tag === 'li' || tag === 'dd' || tag === 'dt') {
      // The element's own text (not its sublist content) becomes the
      // bullet; nested <ul>/<ol>/<dl> are walked at depth+1.
      const own = ownText(el)
      // If "own" is empty but the li has a single <p>/<span>/<a> child
      // with real text, use that instead.
      let line = own
      if (!line) line = fullText(el, 300)
      if (line) push('  '.repeat(listDepth) + '- ' + line)
      $c(el).find('> ul, > ol, > dl').each((_: number, sub: cheerio.Element) => {
        $c(sub).children().each((_: number, c: cheerio.Element) => walk(c, listDepth + 1))
      })
      return
    }
    // Table row — emit a "| cell | cell |" line so menus laid out as
    // tables stay parseable.
    if (tag === 'tr') {
      const cells: string[] = []
      $c(el).find('> th, > td').each((_: number, td: cheerio.Element) => {
        cells.push(fullText(td, 150))
      })
      if (cells.length) push('| ' + cells.join(' | ') + ' |')
      return
    }

    // Containers: recurse into children.
    if (/^(div|section|article|aside|main|header|footer|ul|ol|dl|table|tbody|thead|tfoot|figure|figcaption|details|summary)$/.test(tag)) {
      $c(el).children().each((_: number, c: cheerio.Element) => walk(c, listDepth))
      return
    }

    // Inline-ish leaves (span, a, strong, em, b, i, small, sup, sub,
    // br, hr, img) — emit nothing here; their text gets picked up by
    // the parent block element's fullText() / ownText().
  }

  $c('body').children().each((_: number, el: cheerio.Element) => walk(el, 0))

  // Cap total outline size — anything beyond ~8KB per page is noise.
  let out = lines.join('\n')
  if (out.length > 8000) out = out.slice(0, 8000) + '\n…[truncated]'
  return out
}

// ---------- T2: SINGLE AI CALL EXTRACTOR ----------
// One Claude call per scaffold. Reads:
//   - JSON-LD scripts (gold-standard structured data)
//   - The current T1-extracted config (so the AI doesn't re-extract
//     what we already know — saves tokens, prevents conflict)
//   - Markdown outlines of every crawled page
//   - A cleaned-text corpus of every crawled page (for the verbatim
//     gate — every claim must substring-match this text)
//
// Returns the AI's structured output filtered through the verbatim
// gate. Each rejected claim shows up in `rejected` for the moderator
// to inspect.
async function extractAllWithAI(
  pages: { url: string; html: string; $: cheerio.CheerioAPI }[],
  currentConfig: any
): Promise<{ filled: Record<string, any>; rejected: string[]; tokensUsed: number } | null> {
  if (!ANTHROPIC_API_KEY) return null

  // Build the AI's source package.
  const jsonLdScripts: string[] = []
  const outlines: string[] = []
  const cleanedTexts: string[] = []
  for (const p of pages) {
    p.$('script[type="application/ld+json"]').each((_: number, el: cheerio.Element) => {
      const t = p.$(el).text().trim()
      if (t) jsonLdScripts.push(t)
    })
    outlines.push(pageToOutline(p.$, p.url))
    // Cleaned text corpus is only used for the verbatim gate.
    const $c = cheerio.load(p.html)
    $c('script, style, noscript, svg, iframe').remove()
    const text = $c('body').text().replace(/\s+/g, ' ').trim()
    if (text) cleanedTexts.push(`# ${p.url}\n${text.slice(0, 12000)}`)
  }
  const verbatimCorpus = cleanedTexts.join('\n\n').slice(0, 100000)
  if (!verbatimCorpus.trim()) return null

  const prompt = `Extract the restaurant's content from the source below.

Already extracted by the structured pass (do NOT contradict; only fill what's missing):
${JSON.stringify({
    name: currentConfig.pwa_name,
    address: currentConfig.address,
    phone: currentConfig.phone,
    email: currentConfig.email,
    hours_count: (currentConfig.hours || []).length,
    description_present: !!(currentConfig.about?.paragraphs?.[0])
  }, null, 2)}

Rules:
1. Every string you return MUST appear VERBATIM in the source text (JSON-LD or page outlines).
   No paraphrasing. No translation. No invention. If a fact is not in source, omit it.
2. EXCEPTION for opening_hours day labels: the digits (times) must match the source exactly,
   but English day labels may be normalised to French in the output:
     Weekdays/Mon-Fri → "Lundi – Vendredi"
     Weekend/Weekends → "Samedi – Dimanche"
     "Weekends & Holidays" → "Samedi, Dimanche & jours fériés"
     Monday → "Lundi", Tuesday → "Mardi", etc.
   Format times as "11h30 – 14h00".
   IMPORTANT — list EVERY distinct schedule line you find in the source. If the source has
   separate lines for weekdays vs weekend (or weekend vs holidays), emit BOTH entries even
   when the time digits are identical. Do not collapse duplicates: each labelled line in
   source becomes one row in your output. Every entry MUST include the full normalised
   "time" field (e.g. "11h30 – 23h00") — never leave time empty or blank just because
   another entry has the same value. Repeat the time on every row.
3. For menu: every dish needs a real name (e.g. "Tagliatelle aux épinards").
   A bare price ("16.-"), a portion chip ("en entrée"), or a form-field label
   ("Variantes / commentaires:") is NOT a dish name — drop the row.
   Group portion variants under their parent dish:
     "16.- (en entrée), 23.- (en plat)" → one dish with two variants.
   Group allergen annotations under their parent dish in the allergens[] array.
   Max 12 categories, 30 dishes per category.
4. For specialties: at most 6 signature/highlighted dishes. Each must have a verbatim title.

JSON-LD scripts:
${jsonLdScripts.join('\n---\n').slice(0, 30000)}

Page outlines (one per crawled page):
${outlines.join('\n\n---\n\n').slice(0, 80000)}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8192,
      tools: [{
        name: 'set_restaurant_content',
        description: 'Set the restaurant\'s extracted content. Every string must appear verbatim in the source.',
        input_schema: {
          type: 'object',
          properties: {
            address: { type: ['string', 'null'], description: 'Full postal address, one line.' },
            phone: { type: ['string', 'null'], description: 'Phone number as displayed.' },
            email: { type: ['string', 'null'], description: 'Contact email.' },
            description: { type: ['string', 'null'], description: 'One-paragraph restaurant description, verbatim.' },
            opening_hours: {
              type: ['array', 'null'],
              items: {
                type: 'object',
                properties: {
                  days: { type: 'string' },
                  service: { type: ['string', 'null'] },
                  time: { type: 'string' }
                },
                required: ['days', 'time']
              }
            },
            specialties: {
              type: ['array', 'null'],
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  text: { type: ['string', 'null'] }
                },
                required: ['title']
              }
            },
            menu: {
              type: ['array', 'null'],
              description: 'Hierarchical menu. Every dish needs a real name; portion variants and allergens group under the parent dish.',
              items: {
                type: 'object',
                properties: {
                  category: { type: 'string' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        description: { type: ['string', 'null'] },
                        ingredients: { type: ['array', 'null'], items: { type: 'string' } },
                        price: { type: ['string', 'null'] },
                        variants: {
                          type: ['array', 'null'],
                          items: {
                            type: 'object',
                            properties: {
                              label: { type: 'string' },
                              price: { type: 'string' }
                            },
                            required: ['label', 'price']
                          }
                        },
                        allergens: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['name']
                    }
                  }
                },
                required: ['category', 'items']
              }
            }
          }
        }
      }],
      tool_choice: { type: 'tool', name: 'set_restaurant_content' },
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) {
    console.error('Anthropic API failed:', res.status, await res.text())
    return null
  }
  const data = await res.json()
  const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
  const toolUse = (data.content || []).find((c: any) => c.type === 'tool_use')
  if (!toolUse) return { filled: {}, rejected: [], tokensUsed }
  const ai = toolUse.input || {}

  // Verbatim gate. Case-folded + accent-stripped substring match
  // against the cleaned text corpus.
  const norm = (s: string) =>
    String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim()
  const sourceN = norm(verbatimCorpus)
  const inSource = (s: string, minLen = 4): boolean => {
    if (!s) return false
    const n = norm(s)
    if (n.length < minLen) return false
    if (n.length > 80) {
      for (let i = 0; i + 40 <= n.length; i += 20) {
        if (sourceN.includes(n.slice(i, i + 40))) return true
      }
      return false
    }
    return sourceN.includes(n)
  }
  const inSourceLoose = (s: string): boolean => {
    const digits = (x: string) => String(x || '').replace(/[^\d]/g, '')
    if (digits(s).length >= 5 && sourceN.replace(/[^\d]/g, '').includes(digits(s))) return true
    return inSource(s, 3)
  }

  // The "dish name" shape rule. Pure prices, portion chips, and form
  // labels can pass a substring check (they're verbatim in source!),
  // but they're not dish names.
  const isDishyName = (s: string): boolean => {
    const t = (s || '').trim()
    if (!t) return false
    if (/^\s*(CHF|EUR|€|F)?\s*\d+[.,]?-?\d*\s*(CHF|EUR|€|F)?\s*(\([^)]+\))?\s*$/i.test(t)) return false
    if (/^\s*(variantes?|commentaires?|options?|all[ée]rg[ée]nes?|suppl[ée]ments?|ingr[ée]dients?)\b[\s/]*[:•]/i.test(t)) return false
    if (/^\s*\(?\s*en\s+(entr[ée]e|plat|dessert|accompagnement)s?\s*\)?\s*$/i.test(t)) return false
    if ((t.match(/[\p{L}]/gu) || []).length < 2) return false
    return true
  }

  const filled: Record<string, any> = {}
  const rejected: string[] = []

  if (ai.address) {
    if (inSource(ai.address, 8)) filled.address = String(ai.address).trim()
    else rejected.push(`address: ${ai.address}`)
  }
  if (ai.phone) {
    if (inSourceLoose(ai.phone)) filled.phone = String(ai.phone).trim()
    else rejected.push(`phone: ${ai.phone}`)
  }
  if (ai.email) {
    if (inSource(ai.email, 5)) filled.email = String(ai.email).trim()
    else rejected.push(`email: ${ai.email}`)
  }
  if (ai.description) {
    if (inSource(ai.description, 20)) filled.description = String(ai.description).trim()
    else rejected.push(`description: ${String(ai.description).slice(0, 60)}…`)
  }
  if (Array.isArray(ai.opening_hours)) {
    // Models often emit a second entry (e.g. weekend) and omit the
    // time field because "it's the same as the previous row". Fall
    // back to the most common time from sibling entries so we don't
    // lose that row when it really did exist in source.
    const timesSeen: Record<string, number> = {}
    for (const h of ai.opening_hours) {
      const t = (h?.time || '').trim()
      if (t) timesSeen[t] = (timesSeen[t] || 0) + 1
    }
    const fallbackTime = Object.entries(timesSeen).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    const hydrated = ai.opening_hours.map((h: any) => {
      if (!h || !h.days) return h
      const t = (h.time || '').trim()
      return t ? h : { ...h, time: fallbackTime }
    })
    const valid = hydrated.filter((h: any) =>
      h && h.days && h.time && inSourceLoose(h.days + ' ' + h.time))
    if (valid.length) filled.hours = valid.map(normalizeHourEntry)
    for (let i = 0; i < hydrated.length; i++) {
      if (!valid.includes(hydrated[i])) {
        const orig = ai.opening_hours[i]
        rejected.push(`hours: ${orig?.days} ${orig?.time}`)
      }
    }
  }
  if (Array.isArray(ai.specialties)) {
    const valid = ai.specialties.filter((s: any) => s && s.title && inSource(s.title, 4))
    if (valid.length) {
      filled.specialties = valid.map((s: any) => ({
        icon: '🍽️',
        title: String(s.title).trim(),
        text: s.text && inSource(s.text, 6) ? String(s.text).trim() : ''
      }))
    }
    for (const s of ai.specialties) {
      if (!valid.includes(s)) rejected.push(`specialty: ${s?.title}`)
    }
  }
  if (Array.isArray(ai.menu)) {
    const validCats: any[] = []
    for (const cat of ai.menu) {
      if (!cat || !cat.category || !Array.isArray(cat.items)) continue
      if (!inSource(cat.category, 3)) {
        rejected.push(`menu category: ${cat.category}`)
        continue
      }
      const validItems: any[] = []
      for (const it of cat.items) {
        if (!it || !it.name) { rejected.push(`dish (no name): ${String(it?.description || '').slice(0, 50)}…`); continue }
        const rawName = String(it.name).trim()
        if (!isDishyName(rawName)) { rejected.push(`dish (not a name): ${rawName}`); continue }
        if (!inSource(rawName, 4)) { rejected.push(`dish name: ${rawName}`); continue }
        let desc = ''
        if (it.description) {
          const d = String(it.description).trim()
          if (inSource(d, 8)) desc = d
          else rejected.push(`dish desc (${rawName}): ${d.slice(0, 40)}…`)
        }
        const ingredients: string[] = []
        if (Array.isArray(it.ingredients)) {
          for (const ing of it.ingredients) {
            const s = String(ing || '').trim()
            if (s && inSource(s, 3)) ingredients.push(s)
            else if (s) rejected.push(`ingredient (${rawName}): ${s}`)
          }
        }
        const variants: { label: string; price: string }[] = []
        if (Array.isArray(it.variants)) {
          for (const v of it.variants) {
            if (!v || !v.label || !v.price) continue
            const lbl = String(v.label).trim()
            const pr = String(v.price).trim()
            if (inSource(lbl, 3) && inSourceLoose(pr)) variants.push({ label: lbl, price: pr })
            else rejected.push(`variant (${rawName}): ${lbl} / ${pr}`)
          }
        }
        const allergens: string[] = []
        if (Array.isArray(it.allergens)) {
          for (const al of it.allergens) {
            const s = String(al || '').trim()
            if (s && inSource(s, 3)) allergens.push(s)
            else if (s) rejected.push(`allergen (${rawName}): ${s}`)
          }
        }
        validItems.push({
          name: rawName,
          description: desc,
          price: it.price ? String(it.price).trim() : null,
          ingredients,
          variants,
          allergens
        })
      }
      if (validItems.length) validCats.push({ category: String(cat.category).trim(), items: validItems })
    }
    if (validCats.length) filled.menu = validCats
  }

  return { filled, rejected, tokensUsed }
}

async function dispatchDeploy(slug: string): Promise<string | null> {
  if (!GITHUB_TOKEN) return null
  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/deploy-tenant.yml/dispatches`
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
    console.error('github dispatch failed', res.status, await res.text())
    return null
  }
  return `https://github.com/${GITHUB_REPO}/actions/workflows/deploy-tenant.yml`
}

// ---------- HANDLER ----------
Deno.serve(async (req: Request) => {
  // CORS preflight — answered before any auth check so browsers
  // don't reject the actual POST.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  if (!(await callerIsModerator(req))) {
    return json({ error: 'forbidden' }, 403)
  }

  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad json' }, 400) }

  // Three call modes:
  //   1. Fresh scaffold:   { url, tier? }                    — create a new tenant.
  //   2. Promote existing: { restaurant_id, tier }           — re-scaffold an
  //                                                           existing tenant at a higher tier.
  //   3. Redeploy only:    { restaurant_id, redeploy: true } — fire deploy-tenant.yml
  //                                                           without re-extracting (e.g. after a
  //                                                           template flip).
  if (body?.restaurant_id && body?.redeploy === true) {
    const { data: row, error } = await admin.from('vautcher_restaurants')
      .select('id, slug, name').eq('id', body.restaurant_id).single()
    if (error || !row) return json({ error: 'restaurant not found' }, 404)
    const workflowUrl = await dispatchDeploy(row.slug)
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

  const requestedTier = Math.max(1, Math.min(3, parseInt(String(body?.tier || '1'), 10) || 1))
  let inputUrl: string = (body?.url || '').trim()
  let existingId: string | null = body?.restaurant_id || null
  let existingRow: any = null

  if (existingId) {
    const { data, error } = await admin.from('vautcher_restaurants')
      .select('id, slug, name, config').eq('id', existingId).single()
    if (error || !data) return json({ error: 'restaurant not found' }, 404)
    existingRow = data
    inputUrl = data.config?.source_url || ''
    if (!inputUrl) return json({ error: 'no source_url on existing tenant — cannot promote' }, 422)
  }
  if (!inputUrl) return json({ error: 'url or restaurant_id required' }, 400)

  const target = /^https?:\/\//.test(inputUrl) ? inputUrl : 'https://' + inputUrl

  // 1. Crawl + extract.
  const pages = await crawl(target)
  if (!pages.length) return json({ error: `fetch ${target} failed` }, 422)

  const cfg = buildConfig(pages)
  const home = pages[0]
  const $h = home.$
  const baseUrl = home.url

  // Brand colour: site-declared theme-color FIRST, but only when it's
  // actually a brand colour. Sites often ship a neutral white/black
  // theme-color that would tint every PWA chrome to off-brand.
  const rawThemeColor = $h('meta[name="theme-color"]').attr('content') || null
  const themeColor = rawThemeColor && !isNeutralHex(rawThemeColor) ? rawThemeColor : null
  const allCss = await loadAllCss($h, baseUrl)
  const headerBg = headerBgFromCss(allCss)
  const cssBrand = frequencyBrandColor(allCss)
  const brand = themeColor || cssBrand || null
  // brand_dark prefers the actual header background colour (what the
  // user sees on the top of the site) over a darker-tinted brand.
  const brandDark = headerBg
    || (cssBrand ? darken(cssBrand, 0.35) : null)
    || (brand ? darken(brand, 0.35) : null)
    || null

  // Google Fonts pass-through — capture families + the link tag so the
  // diner app can inject the same stylesheet and apply the decorative
  // face to its headings.
  const gf = extractGoogleFonts($h)
  const headingFont = pickHeadingFont(gf.families)

  // Pick a logo: highest-res favicon > og:image.
  const icons = $h('link[rel*="icon"]').toArray()
    .map((el: cheerio.Element) => ({
      href: $h(el).attr('href'),
      sizes: $h(el).attr('sizes') || ''
    }))
    .filter((i: any) => i.href)
  icons.sort((a: any, b: any) => {
    const az = parseInt((a.sizes.match(/\d+/) || ['0'])[0], 10)
    const bz = parseInt((b.sizes.match(/\d+/) || ['0'])[0], 10)
    return bz - az
  })
  let logoUrl: string | null = null
  if (icons[0]) {
    try { logoUrl = new URL(icons[0].href, baseUrl).href } catch { logoUrl = icons[0].href }
  } else if (cfg.og.image) {
    logoUrl = cfg.og.image
  }

  // Structured identity. JSON-LD Restaurant entries are the gold
  // standard — when present they give us name, address, phone, email,
  // cuisine, image, and opening hours in one shot. Everything else
  // (per-CMS DOM walking) was the brittle layer; it's gone in T1.
  const ld = extractJsonLd($h)
  const phone = ld.telephone || null
  const email = ld.email || null
  const address = formatLdAddress(ld.address) || (typeof ld.address === 'string' ? ld.address : null)

  // Opening hours: schema.org → openingHoursSpecification first (the
  // structured shape), then openingHours strings. No heuristic regex.
  let hours: { days: string; service?: string | null; time: string }[] = []
  if (ld.openingHoursSpec) hours = parseSchemaHoursSpec(ld.openingHoursSpec)
  if (!hours.length && ld.openingHours) {
    const raw = Array.isArray(ld.openingHours) ? ld.openingHours : [ld.openingHours]
    for (const r of raw) hours.push(...parseSchemaHoursStr(String(r)))
  }
  hours = hours.map(normalizeHourEntry)

  // Restaurant description: JSON-LD wins, then og:description, then
  // meta name=description. No body-text fallback in T1.
  const description = (ld.description && ld.description.length > 30)
    ? ld.description
    : (cfg.og.description
      || $h('meta[name="description"]').attr('content')
      || '')

  const heroTitle = ld.name || cfg.og.title || cfg.name
  const heroLead = (description || '').slice(0, 220)
  const aboutParagraphs: string[] = description ? [description] : []

  const config: any = {
    tagline: description ? description.slice(0, 140) : (cfg.og.description || null),
    address,
    phone,
    phone_href: phone ? 'tel:' + phone.replace(/[^\d+]/g, '') : null,
    email,
    maps_href: address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
      : null,
    logo_url: logoUrl,
    brand_primary: brand,
    brand_dark: brandDark,
    theme_color: themeColor || cssBrand || null,
    heading_font: headingFont,
    google_fonts_families: gf.families,
    pwa_name: cfg.name,
    pwa_short_name: cfg.name,
    pwa_description: description || cfg.og.description || null,
    hours,
    reservation_slots: [],
    hero: {
      eyebrow: ld.cuisine
        ? (Array.isArray(ld.cuisine) ? ld.cuisine.join(' · ') : String(ld.cuisine))
        : null,
      title: heroTitle,
      lead: heroLead,
      image_url: ld.image || cfg.images[0]?.src || cfg.og.image || null
    },
    about: {
      kicker: '',
      title: '',
      image_url: cfg.images[1]?.src || cfg.images[0]?.src || cfg.og.image || null,
      paragraphs: aboutParagraphs
    },
    specialties: [],
    menu: [],
    gallery: cfg.images.slice(0, 12).map((img: any) => ({
      src: img.src, caption: img.alt || ''
    })),
    sections: [],
    source_url: target
  }

  // ---------- T2: AI EXTRACTION ----------
  // At T2 we fold in everything an AI can pull from the structural
  // outlines + cleaned text corpus — menu, specialties, and any
  // identity fields the JSON-LD pass missed. The verbatim gate inside
  // extractAllWithAI drops every claim that doesn't substring-match
  // the source, so this still respects the no-invention rule.
  let aiUsed = false
  const aiFilled: string[] = []
  let aiRejected: string[] = []
  let tokensUsed = 0
  if (requestedTier >= 2 && ANTHROPIC_API_KEY) {
    const enhanced = await extractAllWithAI(pages, config)
    if (enhanced) {
      aiUsed = Object.keys(enhanced.filled).length > 0
      tokensUsed = enhanced.tokensUsed
      aiRejected = enhanced.rejected
      const f = enhanced.filled
      if (f.address && !config.address) {
        config.address = f.address
        config.maps_href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.address)}`
        aiFilled.push('address')
      }
      if (f.phone && !config.phone) {
        config.phone = f.phone
        config.phone_href = 'tel:' + String(f.phone).replace(/[^\d+]/g, '')
        aiFilled.push('phone')
      }
      if (f.email && !config.email) { config.email = f.email; aiFilled.push('email') }
      if (f.description && !(config.about?.paragraphs || []).length) {
        config.about.paragraphs = [f.description]
        config.pwa_description = f.description
        config.tagline = config.tagline || f.description.slice(0, 140)
        config.hero.lead = config.hero.lead || f.description.slice(0, 220)
        aiFilled.push('description')
      }
      if (Array.isArray(f.hours) && f.hours.length && !config.hours.length) {
        config.hours = f.hours; aiFilled.push('hours')
      }
      if (Array.isArray(f.specialties) && f.specialties.length) {
        config.specialties = f.specialties; aiFilled.push('specialties')
      }
      if (Array.isArray(f.menu) && f.menu.length) {
        config.menu = f.menu; aiFilled.push('menu')
      }
    }
  }

  const scaffoldTier = requestedTier

  // Score (post-AI when applicable).
  const score = scoreScaffold({
    address: config.address,
    phone: config.phone,
    hours: config.hours,
    description: config.about.paragraphs[0] || '',
    specialties: config.specialties,
    menu: config.menu,
    images: config.gallery
  })

  // Insert OR update the restaurant row.
  let inserted: { id: string; slug: string; name: string }
  if (existingRow) {
    // Promote-existing path: update config + tier on the row we loaded.
    const { data, error } = await admin.from('vautcher_restaurants')
      .update({
        config,
        scaffold_tier: scaffoldTier,
        scaffold_tokens_used: tokensUsed,
        deploy_status: GITHUB_TOKEN ? 'pending' : 'idle'
      })
      .eq('id', existingRow.id)
      .select('id, slug, name').single()
    if (error) return json({ error: error.message }, 500)
    inserted = data
  } else {
    const slug = await uniqueSlug(slugify(cfg.name))
    const { data, error } = await admin.from('vautcher_restaurants').insert({
      name: cfg.name,
      slug,
      config,
      deploy_status: GITHUB_TOKEN ? 'pending' : 'idle',
      scaffold_tier: scaffoldTier,
      scaffold_tokens_used: tokensUsed
    }).select('id, slug, name').single()
    if (error) return json({ error: error.message }, 500)
    inserted = data
  }

  // Owner provisioning only happens on fresh scaffolds. Promoting an
  // existing tenant doesn't touch the owner row.
  let claimCode: string | null = null
  let placeholderEmail: string | null = null
  let ownerErr: any = null
  if (!existingRow) {
    claimCode = await uniqueClaimCode()
    placeholderEmail = `pending+${claimCode.toLowerCase()}@${inserted.slug}.vautcher.local`
    const { error } = await admin.from('vautcher_owners').insert({
      email: placeholderEmail,
      restaurant_id: inserted.id,
      name: `Propriétaire ${cfg.name}`,
      trusted: true,
      locked: false,
      claim_code: claimCode
    })
    if (error) {
      console.error('owner provisioning failed', error.message)
      ownerErr = error
    }
  }

  // Dispatch the Cloudflare Pages build (same workflow for fresh +
  // promote — the build picks up the updated config either way).
  const workflowUrl = await dispatchDeploy(inserted.slug)
  if (workflowUrl) {
    await admin.from('vautcher_restaurants')
      .update({ deploy_log_url: workflowUrl })
      .eq('id', inserted.id)
  }

  return json({
    id: inserted.id,
    name: inserted.name,
    slug: inserted.slug,
    pages_crawled: pages.length,
    scaffold_tier: scaffoldTier,
    scaffold_tokens_used: tokensUsed,
    deploy: workflowUrl ? 'dispatched' : 'manual',
    deploy_log_url: workflowUrl,
    pages_url: `https://${inserted.slug}.pages.dev`,
    quality: score.quality,
    quality_reasons: score.reasons,
    ai_used: aiUsed,
    ai_filled: aiFilled,
    ai_rejected: aiRejected,
    menu_categories: (config.menu || []).length,
    menu_items: (config.menu || []).reduce((n: number, c: any) => n + (c.items?.length || 0), 0),
    owner: (existingRow || ownerErr) ? null : {
      placeholder_email: placeholderEmail,
      claim_code: claimCode
    }
  })
})
