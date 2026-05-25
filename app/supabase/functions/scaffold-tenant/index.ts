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
import * as cheerio from 'npm:cheerio@1.0.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') || ''
const GITHUB_REPO = Deno.env.get('GITHUB_REPO') || 'reyespatrick/vautcher'
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-4-6'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const UA = 'Mozilla/5.0 (compatible; vautcher-scaffold/1.0)'

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
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
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

// ---------- BLOCK EXTRACTION ----------
const BLOCK_RE = /^(div|section|article|aside|main|p|h[1-6]|ul|ol|li|dl|dd|dt|table|tr|td|th|figure|figcaption)$/

// Pull the visible text out of a cheerio element while INSERTING a
// space between sibling text nodes. Cheerio's $el.text() concatenates
// without separators, so `<span>Allergènes</span><span>Lupin</span>`
// becomes "AllergènesLupin" — which is what was shipping in scraped
// menus. Walking the DOM and joining with spaces fixes that.
function flatText($: cheerio.CheerioAPI, el: cheerio.Element): string {
  const parts: string[] = []
  function walk(node: any) {
    if (!node) return
    if (node.type === 'text') {
      const s = String(node.data || '').replace(/\s+/g, ' ').trim()
      if (s) parts.push(s)
      return
    }
    if (node.type === 'tag') {
      const name = (node.tagName || '').toLowerCase()
      if (name === 'script' || name === 'style' || name === 'noscript') return
      // Suppress the brief content of <sup>, <sub>, <small> footnote
      // markers when they wedge between two adjacent words.
      const children = node.children || []
      for (const c of children) walk(c)
    }
  }
  walk(el)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

// Junk-pattern filter. Cookie banners, allergen lists, lone day-name
// labels (WEEKDAYS, LUN, MAR…), pure-uppercase blob without sentences,
// and other metadata-only fragments shouldn't make it into the
// scaffolded content. Returns true → drop the block.
function isJunkText(t: string): boolean {
  const s = t.trim()
  if (!s) return true

  // Allergen / nutritional list — body text that's mostly chemistry
  // jargon. "Allergènes…", "Contains gluten", "Sulfites & sulfureux…".
  if (/^allerg[èe]nes?\b/i.test(s)) return true
  if (/^contient\b/i.test(s) || /^contains\b/i.test(s)) return true
  // Sulfite/lactose/gluten mash-ups with no surrounding sentence —
  // count allergen tokens vs total words.
  const allergenTokens = (s.match(/(allerg[èe]nes?|sulfites?|sulfureux|anhydride|gluten|lactose|lupin|moutarde|c[ée]leri|crustac[ée]s|mollusques|fruits? [aà] coque|s[ée]same|soja|arachide|sulfite|sulfite)/gi) || []).length
  const totalTokens = s.split(/\s+/).filter(Boolean).length
  if (totalTokens > 0 && allergenTokens / totalTokens > 0.4) return true

  // Lone day-or-period label (WEEKDAYS, WEEKEND, LUN MAR MER, MIDI, SOIR)
  // with no times attached. If the string is short, ALL-CAPS, and made
  // of these tokens, drop it.
  if (s.length < 40 && /^[\sA-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ&\-/]+$/.test(s)) {
    if (/^(weekdays|weekend|weekends|holidays?|lun|mar|mer|jeu|ven|sam|dim|midi|soir|du|au|et|monday|tuesday|wednesday|thursday|friday|saturday|sunday)([\s&/\-]|$)/i.test(s)) {
      // No hours / minutes present anywhere.
      if (!/\d/.test(s)) return true
    }
  }

  // Cookie / consent / GDPR boilerplate.
  if (/cookies?\s+(sont|nous|permettent|utilis)/i.test(s)) return true
  if (/politique\s+de\s+confidentialit/i.test(s)) return true

  // Single uppercase word that's not a dish name (>= 3 chars).
  if (/^[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]{3,30}$/.test(s)) return true

  return false
}
function isIconImage(src: string): boolean {
  return /(favicon|logo|icon|sprite|spacer|arrow_)/i.test(src)
}
function isNavLikeText(t: string): boolean {
  return t.length < 25 || /^[A-Z\s·/|→\-]+$/.test(t)
}
function looksLikeNav($: cheerio.CheerioAPI, el: cheerio.Element): boolean {
  let cur: cheerio.Cheerio<cheerio.Element> | null = $(el)
  while (cur && cur.length) {
    const cls = cur.attr('class') || ''
    if (/(?:^|\s)(nav|menu|breadcrumb|navbar|topbar|sidebar)(?:\s|$|--|__|-)/i.test(cls)) {
      return true
    }
    const parent = cur.parent()
    if (!parent || !parent.length || parent.is('body, html')) break
    cur = parent
  }
  return false
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

function extractBlocks($: cheerio.CheerioAPI, pageUrl: string) {
  const out: any[] = []
  $('header, nav, footer, script, style, noscript').remove()
  $('body *').each((_: number, el: cheerio.Element) => {
    const tag = (el.tagName || '').toLowerCase()
    const $el = $(el)
    if (tag === 'img') {
      const src = realImageUrl($el)
      if (!src) return
      let abs: string
      try { abs = new URL(src, pageUrl).href } catch { return }
      if (isIconImage(abs)) return
      // Relaxed extension check — accept a content-image path even if
      // there's a query string or no extension (CDN-style URLs). Still
      // reject obvious assets we know aren't useful.
      if (/\.(svg|ico|webmanifest)(\?|$)/i.test(abs)) return
      out.push({ type: 'image', src: abs, alt: ($el.attr('alt') || '').trim() })
    } else if (/^h[1-4]$/.test(tag)) {
      const text = flatText($, el)
      if (text && text.length <= 140 && !isJunkText(text)) {
        out.push({ type: 'heading', level: +tag[1], text })
      }
    } else if (tag === 'p') {
      const text = flatText($, el)
      if (text.length >= 25 && !isNavLikeText(text) && !isJunkText(text)) {
        out.push({ type: 'text', text })
      }
    } else if (tag === 'li' || tag === 'dd' || tag === 'dt') {
      if (looksLikeNav($, el)) return
      const hasBlockChild = $el.find(BLOCK_RE).length > 0
      if (hasBlockChild) return
      const text = flatText($, el)
      if (text.length >= 2 && text.length <= 400
          && !isNavLikeText(text) && !isJunkText(text)) {
        out.push({ type: 'text', text })
      }
    } else if (tag === 'div') {
      if (looksLikeNav($, el)) return
      const hasBlockChild = $el.find(BLOCK_RE).length > 0
      if (hasBlockChild) return
      const direct = $el.contents().filter((_: number, n: any) => n.type === 'text')
        .map((_: number, n: any) => n.data).get().join(' ').replace(/\s+/g, ' ').trim()
      if (direct.length < 2) return
      const leaf = flatText($, el)
      if (!leaf || leaf.length > 500) return
      if (isNavLikeText(leaf) || isJunkText(leaf)) return
      out.push({ type: 'text', text: leaf })
    }
  })
  return out
}

// Post-extract sanity check. Real signal-of-quality isn't "did we get
// some text blocks", it's "did we get the things a diner needs":
// address, phone, hours, a description, photos, and ideally a menu.
//
// Returns:
//   ok    — structured fields are populated; safe to ship
//   low   — partial extraction; moderator should verify before publishing
//   bad   — almost no usable structured data; do NOT publish as-is
function scoreScaffold(
  blocks: any[],
  structured: {
    address: string | null
    phone: string | null
    hours: any[]
    description: string
    specialties: any[]
    images: any[]
  }
): { quality: 'ok'|'low'|'bad'; reasons: string[] } {
  const reasons: string[] = []
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text)
  const headings = blocks.filter((b) => b.type === 'heading').map((b) => b.text)

  // Structured-field misses are weighted heavily — those are what
  // matters for a real diner page.
  if (!structured.address) reasons.push('address not found')
  if (!structured.phone) reasons.push('phone not found')
  if (!structured.hours.length) reasons.push('opening hours not found')
  if (!structured.description || structured.description.length < 40) {
    reasons.push('restaurant description too short or missing')
  }
  if (!structured.specialties.length) reasons.push('no menu/specialty items detected')
  if (structured.images.length < 3) reasons.push(`only ${structured.images.length} usable image(s)`)

  // Verbatim-block tells (kept as secondary signals).
  if (text.length + headings.length === 0) {
    return { quality: 'bad', reasons: ['no text or heading blocks extracted'] }
  }
  if (text.length > 0) {
    const avg = text.reduce((a, s) => a + s.length, 0) / text.length
    if (avg < 30) reasons.push(`avg text block too short (${Math.round(avg)} chars)`)
  }
  const capsHeavy = text.filter((s) => {
    const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, '')
    if (letters.length < 5) return false
    const upper = letters.replace(/[^A-ZÀ-ÖØ-Þ]/g, '').length
    return upper / letters.length > 0.7
  }).length
  if (text.length > 4 && capsHeavy / text.length > 0.4) {
    reasons.push(`${capsHeavy}/${text.length} text blocks are mostly UPPERCASE`)
  }

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

// Heuristic regex extractor for opening hours in unstructured text.
// Matches "Lundi 11h30 – 14h00", "Mon - Sat: 11:30 - 14:00", etc.
function extractHoursFromText(pages: { $: cheerio.CheerioAPI }[]): { days: string; time: string }[] {
  const out: { days: string; time: string }[] = []
  const dayRe = '(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lun|mar|mer|jeu|ven|sam|dim|mon|tue|wed|thu|fri|sat|sun)'
  const rangeRe = new RegExp(`(${dayRe}(?:\\s*[-–à]\\s*${dayRe})?)\\s*[:\\.]?\\s*(\\d{1,2}[h:]\\d{2}\\s*[-–]\\s*\\d{1,2}[h:]\\d{2}(?:\\s*[/,]\\s*\\d{1,2}[h:]\\d{2}\\s*[-–]\\s*\\d{1,2}[h:]\\d{2})?)`, 'gi')
  for (const { $ } of pages) {
    const text = $('body').text().replace(/\s+/g, ' ')
    let m
    while ((m = rangeRe.exec(text))) {
      const rawDays = m[1].trim()
      const days = rawDays.split(/\s*[-–à]\s*/).map((d) => {
        const t = d.toLowerCase()
        const longForm = /^(lun|mar|mer|jeu|ven|sam|dim)/.test(t) ||
          /^(mon|tue|wed|thu|fri|sat|sun)/.test(t)
        return longForm ? d : d
      }).join(' – ')
      const time = m[2].replace(/\s+/g, '').replace(':', 'h').replace('-', ' – ')
      if (out.length > 14) break
      if (out.find((o) => o.days.toLowerCase() === days.toLowerCase() && o.time === time)) continue
      out.push({ days, time })
    }
    if (out.length) break
  }
  return out
}

// Pull phone from tel: links + JSON-LD before falling back to regex.
function extractPhone($h: cheerio.CheerioAPI, ld: any, pages: { html: string }[]): string | null {
  if (ld?.telephone) return String(ld.telephone).trim()
  const tel = $h('a[href^="tel:"]').first().attr('href')
  if (tel) return tel.replace(/^tel:/i, '').trim()
  return fallbackPhone(pages)
}
function extractEmail($h: cheerio.CheerioAPI, ld: any, pages: { html: string }[]): string | null {
  if (ld?.email) return String(ld.email).trim()
  const mail = $h('a[href^="mailto:"]').first().attr('href')
  if (mail) return mail.replace(/^mailto:/i, '').split('?')[0].trim()
  return fallbackEmail(pages)
}
function extractAddress($h: cheerio.CheerioAPI, ld: any, pages: { html: string }[]): string | null {
  const fromLd = formatLdAddress(ld?.address)
  if (fromLd) return fromLd
  // Microdata: <span itemprop="streetAddress"> etc.
  const street = $h('[itemprop="streetAddress"]').first().text().trim()
  const locality = $h('[itemprop="addressLocality"]').first().text().trim()
  const postal = $h('[itemprop="postalCode"]').first().text().trim()
  const composed = [street, [postal, locality].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  if (composed.length > 5) return composed
  return fallbackAddress(pages)
}

// Find menu / specialties sections and extract dish items. Returns
// items as { icon, title, text } so they slot straight into the
// diner-app's specialties config.
function extractSpecialties($: cheerio.CheerioAPI): { icon: string; title: string; text: string }[] {
  const items: { icon: string; title: string; text: string }[] = []
  const headingRe = /^(notre |nos |la |le )?(menu|carte|plats?|spécialit[ée]s|specialites?|signature|incontournab|nos suggestions|à la carte)/i

  // Build a list of "menu container" elements by walking each h1/h2/h3
  // whose text matches a menu-ish heading and grabbing the following
  // siblings up to the next heading.
  $('h1, h2, h3').each((_: number, h: cheerio.Element) => {
    const ht = flatText($, h)
    if (!headingRe.test(ht)) return

    // Collect dish elements: each subsequent h3/h4/li/dt within the
    // same logical section, stopping at the next h1/h2.
    const stop = (el: cheerio.Element) => /^h[12]$/.test((el.tagName || '').toLowerCase())
    let cur: any = ($ as any)(h).next()
    let scanned = 0
    while (cur && cur.length && scanned < 200) {
      const node = cur.get(0)
      if (!node) break
      if (stop(node)) break
      // Within `cur`, find dish-leaf elements.
      cur.find('h3, h4, li, dt').each((_: number, el: cheerio.Element) => {
        const $el = $(el)
        const title = flatText($, el)
        if (!title || title.length < 3 || title.length > 80) return
        if (isJunkText(title)) return
        if (headingRe.test(title)) return
        // Skip if it has block children (means we'll catch the leaf in
        // a nested iteration instead).
        if ($el.find('h3, h4, li, dt').length > 0) return
        // Description: a sibling <p> or <dd> immediately after.
        let desc = ''
        const $sib = $el.next()
        if ($sib.is('p, dd, span')) desc = flatText($, $sib.get(0)!)
        if (desc && isJunkText(desc)) desc = ''
        const cleanTitle = title.replace(/\s*\d+[.,]\d{2}\s*(CHF|EUR|€|F)?$/i, '').trim()
        items.push({ icon: '🍽️', title: cleanTitle, text: desc })
      })
      scanned++
      cur = cur.next()
    }
  })

  // Dedupe by title.
  const seen = new Set<string>()
  return items.filter((i) => {
    const k = i.title.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 8)  // cap so the home page isn't overwhelmed
}

// A menu item, as stored in config.menu[*].items[*].
//
// Scraper only fills name/description/price reliably (those come from
// the page's own structure). ingredients / variants / allergens are
// almost always inferred by the AI grouping pass, because they sit in
// unstructured prose like "Allergènes: …" annotations or "(en entrée)"
// portion chips next to a price. The scraper-side fields default to
// empty arrays so the merge/render layers never have to null-check.
type MenuItem = {
  name: string
  description: string
  price: string | null
  ingredients: string[]
  variants: { label: string; price: string }[]
  allergens: string[]
}

// A "dish-ish" name: must contain at least one letter sequence and not
// look like a pure price tag ("16.-"), a portion chip ("(en entrée)"),
// or a form-field label ("Variantes / commentaires : …"). These are
// the fragments dapaolo.ch produced before the gate.
function isDishyName(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  // Pure prices like "16.-", "23.- (en plat)", "CHF 12.50".
  if (/^\s*(CHF|EUR|€|F)?\s*\d+[.,]?-?\d*\s*(CHF|EUR|€|F)?\s*(\([^)]+\))?\s*$/i.test(t)) return false
  // Form-field labels — "Variantes / commentaires : épinards frais",
  // "Allergènes : gluten", "Suppléments : ..."
  if (/^\s*(variantes?|commentaires?|options?|all[ée]rg[ée]nes?|suppl[ée]ments?|ingr[ée]dients?)\b[\s/]*[:•]/i.test(t)) return false
  // Bare portion chip — "(en entrée)", "(en plat)", "(en dessert)".
  if (/^\s*\(?\s*en\s+(entr[ée]e|plat|dessert|accompagnement)s?\s*\)?\s*$/i.test(t)) return false
  // Need at least two letters.
  if ((t.match(/[\p{L}]/gu) || []).length < 2) return false
  return true
}

// Many WordPress restaurant themes (and the like) render each menu
// item as an <article class="dish"> / <li class="menu-item"> card,
// with the name in .entry-title (or an h1-h4), portion variants in
// repeated .dish-price-line elements, and a description in
// .dish-description / .entry-content. The dish name does NOT sit
// under the category heading as an h3 — it's nested inside its own
// card. This strategy walks the cards directly so we capture name +
// per-variant price + description from the markup, with no AI needed.
// Note: "menu-item" is deliberately NOT in this regex — WordPress uses
// it on every nav-bar <li>, which produces hundreds of false positives.
// We accept menu-item only via the title+price predicate below.
const DISH_CARD_CLASS_RE = /(?:^|\s)(?:dish|food-item|wprm-recipe|product-item|carte-item|plat-item|menu-product|menu-item)(?:$|\s|--|__|-(?:[a-z]))/i
const DISH_NAME_SEL = '.entry-title, .menu-item-title, .dish-title, .product-title, .plat-title, h1, h2, h3, h4'
const DISH_PRICE_LINE_SEL = '.dish-price-line, .price-line, .menu-item-price-line, .product-price-line, .variant'
const DISH_PRICE_SEL = '.dish-price, .menu-item-price, .product-price, .price, .amount'
const DISH_LABEL_SEL = '.dish-price-label, .price-label, .variant-label, .menu-item-price-label'
const DISH_DESC_SEL = '.dish-description, .menu-item-description, .product-description, .entry-content p, .entry-summary p'

function extractDishCards(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  fallbackCategory: string
): { category: string; items: MenuItem[] }[] {
  // Find the page's own category title (e.g. <h3 class="category-title">).
  let pageCategory = fallbackCategory
  $('.category-title, .archive-title, .page-title, .term-name').each((_: number, h: cheerio.Element) => {
    const t = flatText($, h)
    if (t && t.length > 1 && t.length < 80 && !pageCategory) { pageCategory = t }
    if (t && t.length > 1 && t.length < 80) { pageCategory = t; return false as any }
  })
  if (!pageCategory) {
    // URL slug → "Les Suggestions"
    try {
      const segs = new URL(pageUrl).pathname.split('/').filter(Boolean)
      const last = segs[segs.length - 1] || segs[segs.length - 2] || ''
      pageCategory = last.replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    } catch { /* ignore */ }
  }

  const cards: cheerio.Element[] = []
  const _dbg = { scanned: 0, classMatch: 0, classSamples: [] as string[], pastNav: 0, pastTitlePrice: 0, pastNested: 0 }
  $('article, li, div').each((_: number, el: cheerio.Element) => {
    _dbg.scanned++
    const cls = ($(el).attr('class') || '')
    if (!DISH_CARD_CLASS_RE.test(cls)) return
    _dbg.classMatch++
    if (_dbg.classSamples.length < 5) _dbg.classSamples.push(cls.slice(0, 100))
    const $el = ($ as any)(el)
    // Exclude items inside nav/header/footer (WP nav uses .menu-item too).
    if ($el.parents('nav, header, footer').length) return
    _dbg.pastNav++
    // A real dish card has BOTH a title and a price somewhere inside.
    // A nav <li class="menu-item"> has neither.
    const hasTitle = $el.find(DISH_NAME_SEL).length > 0
    const hasPrice = $el.find(DISH_PRICE_SEL + ', ' + DISH_PRICE_LINE_SEL).length > 0
    if (!hasTitle || !hasPrice) return
    _dbg.pastTitlePrice++
    // Skip cards nested inside another card (avoid duplicates).
    const ancestors = $el.parents().toArray() as cheerio.Element[]
    if (ancestors.some((p) => DISH_CARD_CLASS_RE.test(($(p).attr('class') || '')))) return
    _dbg.pastNested++
    cards.push(el)
  })
  ;(globalThis as any).__lastCardDbg = _dbg

  if (!cards.length || !pageCategory) return []

  const items: MenuItem[] = []
  const seenNames = new Set<string>()

  for (const el of cards) {
    if (items.length >= 30) break

    const $el = ($ as any)(el)
    const nameEl = $el.find(DISH_NAME_SEL).first()
    const name = nameEl.length ? flatText($, nameEl.get(0)) : ''
    if (!name || !isDishyName(name)) continue
    const key = name.toLowerCase().trim()
    if (seenNames.has(key)) continue
    seenNames.add(key)

    // Variants: <li class="dish-price-line"> with .dish-price + .dish-price-label.
    const variants: { label: string; price: string }[] = []
    $el.find(DISH_PRICE_LINE_SEL).each((_: number, ln: cheerio.Element) => {
      const $ln = ($ as any)(ln)
      const p = flatText($, $ln.find(DISH_PRICE_SEL).first().get(0))
      const l = flatText($, $ln.find(DISH_LABEL_SEL).first().get(0))
      if (p && l) variants.push({ label: l, price: p })
    })

    // Headline price: first .dish-price either in a variant or top-level.
    let price: string | null = null
    if (variants.length) {
      price = variants[0].price
    } else {
      const pEl = $el.find(DISH_PRICE_SEL).first()
      if (pEl.length) price = flatText($, pEl.get(0)) || null
    }

    // Description (avoid grabbing the dish name itself).
    let description = ''
    const dEl = $el.find(DISH_DESC_SEL).first()
    if (dEl.length) {
      const t = flatText($, dEl.get(0))
      if (t && t !== name && !isJunkText(t) && t.length < 400) description = t
    }

    items.push({ name, description, price, ingredients: [], variants, allergens: [] })
  }

  if (!items.length) return []
  return [{ category: pageCategory, items }]
}

// Hierarchical menu extractor. Output:
//   [ { category: 'Les entrées', items: [MenuItem, ...] } ]
//
// Two strategies, applied per crawled page:
//   1. Heading-based: <h2>Category</h2> ... <h3>Dish</h3> + <p>desc</p>
//   2. Dish-card-based: <article class="dish"> ... .entry-title +
//      .dish-price-line cards (WordPress / restaurant plugins).
// Anonymous bare-paragraph fragments are intentionally NOT extracted —
// they produced garbage rows on dapaolo (price chips, form labels,
// isolated ingredient lines). The AI enhancement pass reads the full
// source corpus and groups those into proper dishes when neither
// strategy catches anything.
function extractMenu(pages: { url: string; $: cheerio.CheerioAPI }[]): {
  category: string;
  items: MenuItem[];
}[] {
  const menuUrlRe = /\/(menu|carte|dishes|plats|specialites|sp[ée]cialit[ée]s)\b/i
  const menuHeadRe = /^(notre |nos |la |le |les )?(menu|carte|plats?|sp[ée]cialit[ée]s|specialites?|signature|incontournab|nos suggestions|à la carte|entr[ée]es|pizz|p[âa]tes|p[âa]tes|poissons|viandes|desserts|antipast|primi|secondi|riz)/i
  const PRICE_RE = /(\d+[.,]\d{2})\s*(CHF|EUR|€|F)?/i

  const out: { category: string; items: MenuItem[] }[] = []

  for (const p of pages) {
    const isMenuPage = menuUrlRe.test(p.url)
    const $ = p.$

    // Strategy 2: dish-card scan. Cheap to attempt — returns [] if the
    // page has no card markup. Done first so card-style pages (the WP
    // /dishes/<cat>/ archives) get their proper category from the
    // page's own .category-title even when no menu-ish heading exists.
    const cardSections = extractDishCards($, p.url, '')
    for (const sec of cardSections) out.push(sec)

    // Find every h1/h2/h3 that could be a category header.
    const candidates: { el: cheerio.Element; text: string }[] = []
    $('h1, h2, h3').each((_: number, h: cheerio.Element) => {
      const t = flatText($, h)
      if (!t) return
      if (!isMenuPage && !menuHeadRe.test(t)) return
      // On a menu URL we accept any heading as a potential category;
      // on a non-menu URL only headings that look menu-ish.
      if (t.length > 80) return
      candidates.push({ el: h, text: t })
    })

    for (const cand of candidates) {
      const category = cand.text.trim()
      const items: MenuItem[] = []

      // Walk subsequent siblings until the next h1/h2 of equal or
      // higher level, harvesting dish leaves.
      const stop = (el: cheerio.Element) => {
        const tn = (el.tagName || '').toLowerCase()
        return tn === 'h1' || tn === 'h2'
      }
      let cur: any = ($ as any)(cand.el).next()
      let scanned = 0
      while (cur && cur.length && scanned < 200 && items.length < 30) {
        const node = cur.get(0)
        if (!node) break
        if (stop(node)) break

        // Only one extraction strategy: named dishes.
        //   <h3>/<h4>/<dt> = name, next <p>/<dd> = description.
        cur.find('h3, h4, dt').each((_: number, h: cheerio.Element) => {
          if (items.length >= 30) return
          const name = flatText($, h)
          if (!name || name.length < 3 || name.length > 100) return
          if (isJunkText(name)) return
          if (!isDishyName(name)) return
          // Avoid re-using a category title as a dish name.
          if (menuHeadRe.test(name) && name.length < 25) return
          let desc = ''
          const $sib = ($ as any)(h).next()
          if ($sib.is('p, dd, span, div')) desc = flatText($, $sib.get(0))
          if (desc && isJunkText(desc)) desc = ''
          const priceM = (name + ' ' + desc).match(PRICE_RE)
          const cleanName = name.replace(/\s*\d+[.,]\d{2}\s*(CHF|EUR|€|F)?$/i, '').trim()
          const cleanDesc = desc.replace(/\s*\d+[.,]\d{2}\s*(CHF|EUR|€|F)?\s*$/i, '').trim()
          items.push({
            name: cleanName,
            description: cleanDesc,
            price: priceM ? priceM[0] : null,
            ingredients: [],
            variants: [],
            allergens: []
          })
        })

        scanned++
        cur = cur.next()
      }

      if (items.length >= 1) {
        // Dedupe items by (name, description).
        const seen = new Set<string>()
        const deduped = items.filter((i) => {
          const k = (i.name + '|' + i.description).toLowerCase()
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
        out.push({ category, items: deduped })
      }
    }
  }

  // Dedupe categories by name (across pages) and merge items.
  const byCategory = new Map<string, MenuItem[]>()
  for (const sec of out) {
    const key = sec.category.toLowerCase().trim()
    if (!byCategory.has(key)) byCategory.set(key, [])
    const dest = byCategory.get(key)!
    for (const item of sec.items) {
      const k = (item.name + '|' + item.description).toLowerCase()
      if (!dest.some((d) => (d.name + '|' + d.description).toLowerCase() === k)) {
        dest.push(item)
      }
    }
  }
  // Materialize back with original category casing (first occurrence wins).
  const final: { category: string; items: MenuItem[] }[] = []
  const seenKeys = new Set<string>()
  for (const sec of out) {
    const key = sec.category.toLowerCase().trim()
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    final.push({ category: sec.category, items: byCategory.get(key) || [] })
  }
  return final
}

// ---------- HELPERS ----------
function fallbackPhone(pages: { html: string }[]): string | null {
  for (const { html } of pages) {
    const matches = html.match(/(?:\+|00)\s?\d{1,3}[\s.\-]?(?:\(?\d{2,3}\)?[\s.\-]?){2,4}\d{2,4}/g)
    if (matches) {
      const valid = matches.find((s: string) => /[\s.\-]/.test(s))
      if (valid) return valid.replace(/\s+/g, ' ').trim()
    }
  }
  return null
}
function fallbackEmail(pages: { html: string }[]): string | null {
  for (const { html } of pages) {
    const m = html.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,8}/)
    if (m && !/example\.|test\./i.test(m[0])) return m[0]
  }
  return null
}
function fallbackAddress(pages: { html: string }[]): string | null {
  for (const { html } of pages) {
    const m = html.match(/[A-ZÀ-Ž][\wÀ-ž'\-\s,]{3,80}\d{4,5}\s+[A-ZÀ-Ž][\wÀ-ž'\-]{2,30}/)
    if (m) return m[0].replace(/\s+/g, ' ').trim()
  }
  return null
}

// ---------- BUILD CONFIG ----------
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

  // og:description is sometimes a single nav word ("Adresse", "Menu")
  // because the site author left the WordPress default. Skip values
  // that look like nav copy so they don't become the hero lead.
  function safeLead(s: string | null): string {
    if (!s) return ''
    const t = s.trim()
    if (t.length < 20) return ''
    if (isNavLikeText(t)) return ''
    return t
  }
  og.description = safeLead(og.description)

  // Aggregate blocks across pages, dedupe, drop orphan headings.
  const all: any[] = []
  for (const p of pages) {
    for (const b of extractBlocks(p.$, p.url)) all.push(b)
  }
  const seen = new Set<string>()
  const deduped = []
  for (const b of all) {
    const k = b.type === 'image' ? 'i:' + b.src : `${b.type[0]}:${b.text}`
    if (seen.has(k)) continue
    seen.add(k)
    deduped.push(b)
  }
  const sections: any[] = []
  for (let i = 0; i < deduped.length; i++) {
    const b = deduped[i]
    if (b.type === 'heading') {
      let j = i + 1
      while (j < deduped.length && deduped[j].type === 'heading') j++
      const next = deduped[j]
      if (!next || next.type === 'heading') continue
    }
    sections.push(b)
  }

  const headings = sections.filter((s) => s.type === 'heading')
  const texts = sections.filter((s) => s.type === 'text')
  const images = sections.filter((s) => s.type === 'image')

  return {
    name,
    sections,
    headings,
    texts,
    images,
    og,
    baseUrl
  }
}

// ---------- AI ENHANCER ----------
//
// Hybrid strategy (chose in /loop discussion):
//   1. Scraper runs first — cheap, deterministic baseline.
//   2. If the result is missing key fields (address, phone, hours,
//      description, specialties) AND ANTHROPIC_API_KEY is configured,
//      ask Claude to fill ONLY those gaps from the source HTML.
//   3. Anti-hallucination gate — every AI-claimed string MUST appear
//      verbatim in the scraped source corpus, otherwise it's rejected.
//      This is how we keep the no-invention rule mechanically enforced
//      instead of trusting it to a prompt.
//   4. If the key is missing, the API errors, or the response is
//      malformed, the function returns null and the scraper output
//      ships untouched. Graceful no-op.
async function enhanceWithAI(
  pages: { url: string; $: cheerio.CheerioAPI }[],
  currentConfig: any
): Promise<{ filled: Record<string, any>; rejected: string[] } | null> {
  if (!ANTHROPIC_API_KEY) return null

  // What's actually missing? Don't burn tokens if the scraper got
  // everything.
  const missing: string[] = []
  if (!currentConfig.address) missing.push('address')
  if (!currentConfig.phone) missing.push('phone')
  if (!currentConfig.email) missing.push('email')
  if (!currentConfig.hours?.length) missing.push('opening_hours')
  if (!currentConfig.specialties?.length) missing.push('specialties')
  if (!currentConfig.about?.paragraphs?.length) missing.push('description')
  // We always ask AI to fill in the menu — even a partial scraper menu
  // benefits from AI filling in dish names the scraper couldn't tease
  // out of unstructured paragraphs.
  if (!currentConfig.menu?.length || currentConfig.menu.some((c: any) => !c.items?.length)) {
    missing.push('menu')
  }
  if (missing.length === 0) return { filled: {}, rejected: [] }

  // Build the source corpus the AI can read — JSON-LD scripts (gold
  // standard structured data) + cleaned body text per page. Markup
  // and scripts are dropped so we don't waste tokens on chrome.
  const corpus: string[] = []
  for (const p of pages) {
    const $ = p.$
    const ldScripts = $('script[type="application/ld+json"]').toArray()
      .map((el: cheerio.Element) => $(el).text().trim())
      .filter((s: string) => !!s)
    if (ldScripts.length) {
      corpus.push(`# ${p.url} — STRUCTURED DATA\n${ldScripts.join('\n---\n')}`)
    }
    // Clone, strip chrome, harvest body text.
    const $c = cheerio.load($.html())
    $c('header, nav, footer, script, style, noscript, .menu, .navbar, .breadcrumb').remove()
    const text = $c('body').text().replace(/\s+/g, ' ').trim()
    if (text) corpus.push(`# ${p.url}\n${text.slice(0, 8000)}`)
  }
  const source = corpus.join('\n\n').slice(0, 60000)
  if (!source.trim()) return null

  const prompt = `Extract missing restaurant information from the source text below.

The scraper already found these fields (do NOT contradict or re-extract them):
${JSON.stringify({
    name: currentConfig.pwa_name,
    address: currentConfig.address,
    phone: currentConfig.phone,
    email: currentConfig.email,
    hours: currentConfig.hours,
    specialties: currentConfig.specialties?.slice(0, 3),
    description: currentConfig.about?.paragraphs?.[0]?.slice(0, 200)
  }, null, 2)}

MISSING fields to fill: ${missing.join(', ')}

Critical rules:
1. Every string you return MUST appear verbatim somewhere in the source text below.
   Do NOT paraphrase. Do NOT invent. Do NOT translate prose, dish names, or
   descriptions — those have to be the exact words from the source.
2. EXCEPTION for opening_hours: the digits (times) must be exact, but day labels
   may be normalized to French. Convert English day labels you find in source
   to their French equivalents in your output:
     "Weekdays"/"weekdays"/"Mon-Fri" → "Lundi – Vendredi"
     "Weekend"/"weekends" → "Samedi – Dimanche"
     "Weekends & Holidays" → "Samedi, Dimanche & jours fériés"
     "Monday"/"Mon" → "Lundi", "Tuesday"/"Tue" → "Mardi", etc.
   Always format times as "11h30 – 14h00" (use 'h' as the hour separator and
   en-dash with spaces around it). Never use "TO" or ":" in the output time.
3. If a field is not findable in the source, return null for it.
4. For specialties: return at most 6, only items that look like signature dishes
   or menu section headlines. Each must have a title that appears in source.
5. For menu: return the full hierarchical menu — one entry per category, each with
   its list of dishes. Each dish has:
     - name (REQUIRED): the dish's actual name, verbatim from source.
       A bare price ("16.-"), portion chip ("en entrée"), or form-field label
       ("Variantes / commentaires") is NOT a dish name — skip it. If you cannot
       identify a real dish name in the source, do not invent one; drop the row.
     - description: one-line prose description, verbatim. May be empty.
     - ingredients: list of distinct ingredients mentioned for the dish, each
       verbatim from source (e.g. "tagliatelle", "épinards frais", "parmesan").
       Empty array if not listed.
     - price: the dish's headline price, as displayed. Null if not stated.
     - variants: when one dish is sold in multiple portions/sizes (e.g.
       "16.- (en entrée)" + "23.- (en plat)"), group those under the dish as
       [{ label: "en entrée", price: "16.-" }, { label: "en plat", price: "23.-" }].
       Both label and price must appear verbatim in source. Empty array if
       there's only one portion.
     - allergens: distinct allergen names found in an explicit "Allergènes: …"
       annotation tied to this dish. Each verbatim. Empty array if none.
   Skip categories with zero dishes you can name. Max 12 categories, 30 dishes
   per category.

Source text:
${source}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      tools: [{
        name: 'fill_restaurant_gaps',
        description: 'Fill in the missing restaurant fields. Every string must appear verbatim in the provided source text.',
        input_schema: {
          type: 'object',
          properties: {
            address: { type: ['string', 'null'], description: 'Full postal address, one line.' },
            phone: { type: ['string', 'null'], description: 'Phone number as displayed on the site.' },
            email: { type: ['string', 'null'], description: 'Contact email.' },
            description: { type: ['string', 'null'], description: 'One-paragraph restaurant description, copied verbatim.' },
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
              description: 'Hierarchical menu grouped by category. Every dish MUST have a real name (verbatim from source). Group portion variants and allergen annotations into the parent dish — never emit them as standalone rows.',
              items: {
                type: 'object',
                properties: {
                  category: { type: 'string' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string', description: 'Dish name, verbatim from source. Required.' },
                        description: { type: ['string', 'null'], description: 'One-line description, verbatim. May be omitted.' },
                        ingredients: {
                          type: ['array', 'null'],
                          description: 'Distinct ingredients listed for this dish, each verbatim from source.',
                          items: { type: 'string' }
                        },
                        price: { type: ['string', 'null'], description: 'Headline price as displayed.' },
                        variants: {
                          type: ['array', 'null'],
                          description: 'Portion variants for the same dish (e.g. entrée vs plat). Each variant has label + price, both verbatim.',
                          items: {
                            type: 'object',
                            properties: {
                              label: { type: 'string' },
                              price: { type: 'string' }
                            },
                            required: ['label', 'price']
                          }
                        },
                        allergens: {
                          type: ['array', 'null'],
                          description: 'Allergens declared for this dish, each verbatim from source.',
                          items: { type: 'string' }
                        }
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
      tool_choice: { type: 'tool', name: 'fill_restaurant_gaps' },
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) {
    console.error('Anthropic API failed:', res.status, await res.text())
    return null
  }
  const data = await res.json()
  const toolUse = (data.content || []).find((c: any) => c.type === 'tool_use')
  if (!toolUse) return null
  const ai = toolUse.input || {}

  // Anti-hallucination gate. Normalize the source for matching:
  // collapse whitespace, casefold, also keep a no-accent version so
  // small encoding differences don't false-reject ("café" vs "cafe").
  const norm = (s: string) =>
    String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim()
  const sourceN = norm(source)
  const inSource = (s: string, minLen = 4): boolean => {
    if (!s) return false
    const n = norm(s)
    if (n.length < minLen) return false
    // For long strings, accept if a 40-char window matches (handles
    // trivial reformatting like dropped punctuation).
    if (n.length > 80) {
      for (let i = 0; i + 40 <= n.length; i += 20) {
        if (sourceN.includes(n.slice(i, i + 40))) return true
      }
      return false
    }
    return sourceN.includes(n)
  }
  const inSourceLoose = (s: string): boolean => {
    // For phone/email/hours patterns, normalize digits only.
    const digits = (x: string) => String(x || '').replace(/[^\d]/g, '')
    if (digits(s).length >= 5 && sourceN.replace(/[^\d]/g, '').includes(digits(s))) return true
    return inSource(s, 3)
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
    const valid = ai.opening_hours.filter((h: any) =>
      h && h.days && h.time && inSourceLoose(h.days + ' ' + h.time))
    if (valid.length) filled.hours = valid.map(normalizeHourEntry)
    for (const h of ai.opening_hours) {
      if (!valid.includes(h)) rejected.push(`hours: ${h?.days} ${h?.time}`)
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

  // Menu — hierarchical { category, items: [MenuItem, ...] }.
  // Gate rules:
  //   - category must be inSource (≥3 chars)
  //   - name is REQUIRED, must be inSource and pass isDishyName()
  //   - description, ingredients[], variants[].label, allergens[] each
  //     verbatim; offending fields are dropped, item kept if name+core
  //     remain valid
  //   - prices pass through digit-loose
  if (Array.isArray(ai.menu)) {
    const validCats: any[] = []
    for (const cat of ai.menu) {
      if (!cat || !cat.category || !Array.isArray(cat.items)) continue
      if (!inSource(cat.category, 3)) {
        rejected.push(`menu category: ${cat.category}`)
        continue
      }
      const validItems: MenuItem[] = []
      for (const it of cat.items) {
        if (!it || !it.name) {
          rejected.push(`dish (no name): ${String(it?.description || '').slice(0, 50)}…`)
          continue
        }
        const rawName = String(it.name).trim()
        if (!isDishyName(rawName)) {
          rejected.push(`dish (not a name): ${rawName}`)
          continue
        }
        if (!inSource(rawName, 4)) {
          rejected.push(`dish name: ${rawName}`)
          continue
        }
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

  return { filled, rejected }
}

// ---------- GITHUB DISPATCH ----------
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
  const inputUrl: string = (body?.url || '').trim()
  if (!inputUrl) return json({ error: 'url required' }, 400)

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

  // Structured extraction — JSON-LD is the gold standard, then microdata,
  // then heuristic regex. Each source fills in only what the prior
  // sources missed.
  const ld = extractJsonLd($h)
  const phone = extractPhone($h, ld, pages)
  const email = extractEmail($h, ld, pages)
  const address = extractAddress($h, ld, pages)

  // Opening hours: schema.org → openingHoursSpecification first (the
  // structured shape), then openingHours strings, then text regex.
  // Every entry is normalized so the stored format is canonical no
  // matter which source produced it.
  let hours: { days: string; service?: string | null; time: string }[] = []
  if (ld.openingHoursSpec) hours = parseSchemaHoursSpec(ld.openingHoursSpec)
  if (!hours.length && ld.openingHours) {
    const raw = Array.isArray(ld.openingHours) ? ld.openingHours : [ld.openingHours]
    for (const r of raw) hours.push(...parseSchemaHoursStr(String(r)))
  }
  if (!hours.length) hours = extractHoursFromText(pages)
  hours = hours.map(normalizeHourEntry)

  // Restaurant description: JSON-LD wins, then og:description (filtered
  // through safeLead so nav words don't slip through), then meta name=
  // description, then the first long paragraph we extracted.
  const safeOgDesc = cfg.og.description // already safeLead'd in buildConfig
  const description = (ld.description && ld.description.length > 30)
    ? ld.description
    : (safeOgDesc || $h('meta[name="description"]').attr('content') || cfg.texts[0]?.text || '')

  // Specialties — try to pull dish names + descriptions from any
  // menu/carte/spécialités section on any crawled page.
  let specialties: { icon: string; title: string; text: string }[] = []
  for (const p of pages) {
    specialties.push(...extractSpecialties(p.$))
    if (specialties.length >= 8) break
  }
  // Dedupe across pages.
  {
    const seen = new Set<string>()
    specialties = specialties.filter((s) => {
      const k = s.title.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).slice(0, 8)
  }

  // Hierarchical menu — { category, items: [{ name, description, price }] }.
  // The scraper walks every crawled page; categories with no items are
  // dropped. AI may add or extend this through enhanceWithAI.
  const menu = extractMenu(pages.map((p) => ({ url: p.url, $: p.$ })))

  const heroTitle = ld.name || cfg.headings.find((h: any) => h.level === 1)?.text || cfg.og.title || cfg.name
  const heroLead = (description || '').slice(0, 220)

  // About paragraphs — prefer the structured description as the first
  // paragraph, then pad with extracted text blocks (deduped against the
  // description).
  const aboutParagraphs: string[] = []
  if (description) aboutParagraphs.push(description)
  for (const t of cfg.texts) {
    if (aboutParagraphs.length >= 4) break
    if (aboutParagraphs.some((p) => p.includes(t.text) || t.text.includes(p))) continue
    aboutParagraphs.push(t.text)
  }

  // Reservation slots — keep empty by default. Once we detect a BookingForm
  // / reservation system we can pre-populate, but until then any value
  // would be invented (violates the no-invention rule).

  const config = {
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
    specialties,
    menu,
    gallery: cfg.images.slice(0, 12).map((img: any) => ({
      src: img.src, caption: img.alt || ''
    })),
    sections: cfg.sections,
    source_url: target
  }

  // Score the scrape on the STRUCTURED fields, not just block counts.
  // This is what the moderator should look at — "did we get the things
  // a diner actually needs?".
  let score = scoreScaffold(cfg.sections, {
    address: config.address,
    phone: config.phone,
    hours: config.hours,
    description,
    specialties: config.specialties,
    images: config.gallery
  })

  // ---------- AI ENHANCEMENT (Option B) ----------
  // If the scraper missed key fields, ask Claude to fill them in from
  // the source text. Every AI-claimed string is gated through an
  // exact-substring check against the scraped corpus so we keep the
  // no-invention rule even when the LLM is uncertain.
  let aiUsed = false
  let aiFilled: string[] = []
  let aiRejected: string[] = []
  if (score.quality !== 'ok' && ANTHROPIC_API_KEY) {
    const enhanced = await enhanceWithAI(pages, config)
    if (enhanced && Object.keys(enhanced.filled).length > 0) {
      aiUsed = true
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
      if (f.email && !config.email) {
        config.email = f.email
        aiFilled.push('email')
      }
      if (f.description && !(config.about?.paragraphs || []).length) {
        config.about.paragraphs = [f.description]
        config.pwa_description = f.description
        config.tagline = config.tagline || f.description.slice(0, 140)
        config.hero.lead = config.hero.lead || f.description.slice(0, 220)
        aiFilled.push('description')
      }
      if (Array.isArray(f.hours) && f.hours.length && !config.hours.length) {
        config.hours = f.hours
        aiFilled.push('hours')
      }
      if (Array.isArray(f.specialties) && f.specialties.length && !config.specialties.length) {
        config.specialties = f.specialties
        aiFilled.push('specialties')
      }
      if (Array.isArray(f.menu) && f.menu.length) {
        // AI menu generally wins — the scraper only produces name+description
        // shells, while AI adds ingredients/variants/allergens. When the same
        // dish (matched by name) appears in both, prefer the AI row because
        // it carries the enriched fields.
        if (!config.menu?.length) {
          config.menu = f.menu
        } else {
          const byKey = new Map<string, any>()
          for (const c of config.menu) byKey.set(c.category.toLowerCase().trim(), c)
          for (const c of f.menu) {
            const k = String(c.category).toLowerCase().trim()
            if (!byKey.has(k)) {
              byKey.set(k, c)
              config.menu.push(c)
            } else {
              const dest = byKey.get(k)
              const dishKey = (i: any) => String(i.name || '').toLowerCase().trim()
              const seen = new Map<string, number>()
              dest.items.forEach((i: any, idx: number) => seen.set(dishKey(i), idx))
              for (const item of c.items) {
                const k2 = dishKey(item)
                if (seen.has(k2)) {
                  // Replace the scraper-shell entry with the richer AI one.
                  dest.items[seen.get(k2)!] = item
                } else {
                  dest.items.push(item)
                  seen.set(k2, dest.items.length - 1)
                }
              }
            }
          }
        }
        aiFilled.push('menu')
      }
      aiRejected = enhanced.rejected

      // Re-score after the merge — the moderator should see the post-AI
      // verdict, not the original "scraper-only" one.
      score = scoreScaffold(cfg.sections, {
        address: config.address,
        phone: config.phone,
        hours: config.hours,
        description: config.about.paragraphs[0] || '',
        specialties: config.specialties,
        images: config.gallery
      })
    }
  }

  // 2. Insert the restaurant row (uniqueified slug).
  const slug = await uniqueSlug(slugify(cfg.name))
  const { data: inserted, error } = await admin.from('vautcher_restaurants').insert({
    name: cfg.name, slug, config, deploy_status: GITHUB_TOKEN ? 'pending' : 'idle'
  }).select('id, slug, name').single()
  if (error) return json({ error: error.message }, 500)

  // 3. Provision a pre-claimed admin user.
  //   email = 'pending+<code>@<slug>.vautcher.local' (placeholder PK)
  //   claim_code = 6-char code the moderator hands to the future owner
  //   trusted = true (scaffolded tenants come pre-vetted by the
  //     moderator running this flow)
  const claimCode = await uniqueClaimCode()
  const placeholderEmail = `pending+${claimCode.toLowerCase()}@${slug}.vautcher.local`
  const { error: ownerErr } = await admin.from('vautcher_owners').insert({
    email: placeholderEmail,
    restaurant_id: inserted.id,
    name: `Propriétaire ${cfg.name}`,
    trusted: true,
    locked: false,
    claim_code: claimCode
  })
  if (ownerErr) {
    // Don't blow away the restaurant row if owner creation failed —
    // the moderator can still use the existing "+ Ajouter un
    // propriétaire" flow once they have an email.
    console.error('owner provisioning failed', ownerErr.message)
  }

  // 4. Optionally dispatch the Cloudflare Pages build.
  const workflowUrl = await dispatchDeploy(slug)
  if (workflowUrl) {
    await admin.from('vautcher_restaurants')
      .update({ deploy_log_url: workflowUrl })
      .eq('id', inserted.id)
  }

  return json({
    id: inserted.id,
    name: inserted.name,
    slug: inserted.slug,
    blocks: cfg.sections.length,
    pages_crawled: pages.length,
    pages_crawled_urls: pages.map((p: any) => p.url),
    deploy: workflowUrl ? 'dispatched' : 'manual',
    deploy_log_url: workflowUrl,
    pages_url: `https://${inserted.slug}.pages.dev`,
    // Surface scraper quality so the moderator knows whether to trust
    // the auto-generated content or open the config editor immediately.
    quality: score.quality,               // 'ok' | 'low' | 'bad'
    quality_reasons: score.reasons,
    // AI enhancement bookkeeping — empty arrays when AI wasn't used.
    ai_used: aiUsed,                      // boolean
    ai_filled: aiFilled,                  // ['address', 'hours', …]
    ai_rejected: aiRejected,              // hallucinations we dropped
    // Debug: per-page dish-card counts to diagnose why menu is empty.
    debug_menu: {
      menu_categories: (config.menu || []).length,
      menu_items: (config.menu || []).reduce((n: number, c: any) => n + (c.items?.length || 0), 0),
      dish_cards_per_page: pages.map((p: any) => {
        try {
          ;(globalThis as any).__lastCardDbg = null
          const sections = extractDishCards(p.$, p.url, '')
          return {
            url: p.url,
            sections: sections.length,
            items: sections.reduce((n, s) => n + s.items.length, 0),
            dbg: (globalThis as any).__lastCardDbg
          }
        } catch (e) {
          return { url: p.url, error: String((e as any)?.message || e) }
        }
      })
    },
    owner: ownerErr ? null : {
      placeholder_email: placeholderEmail,
      claim_code: claimCode
    }
  })
})
