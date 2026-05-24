// ============================================================
//  scaffold-tenant — turn a restaurant URL into a vautcher tenant.
//
//  POST /functions/v1/scaffold-tenant
//    body: { url: "https://www.somerestaurant.ch/" }
//
//  Steps:
//   1. Verify caller is a moderator (RLS-style via JWT email lookup).
//   2. Crawl the URL (depth 1, ≤12 pages, prioritising contact-ish urls).
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
function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin } catch { return false }
}
function isAssetUrl(u: string): boolean {
  return /\.(css|js|json|xml|ico|svg|png|jpe?g|gif|webp|pdf|mp4|webm|woff2?)(\?|$)/i.test(u)
}

async function crawl(startUrl: string, maxPages = 12) {
  const visited = new Set<string>()
  const pages: { url: string; html: string; $: cheerio.CheerioAPI }[] = []
  const queue: { u: string; d: number }[] = [{ u: startUrl, d: 0 }]
  while (queue.length && visited.size < maxPages) {
    const { u, d } = queue.shift()!
    if (visited.has(u)) continue
    visited.add(u)
    const page = await fetchHtml(u)
    if (!page) continue
    const $ = cheerio.load(page.html)
    pages.push({ url: page.url, html: page.html, $ })
    if (d >= 1) continue

    const newLinks: { u: string; d: number }[] = []
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
        if (newLinks.find((q) => q.u === abs)) return
        newLinks.push({ u: abs, d: d + 1 })
      } catch { /* ignore bad URLs */ }
    })
    // Prioritise contact-ish pages so the address/hours/phone land
    // even on a many-page site.
    newLinks.sort((a, b) => {
      const pri = (u: string) => /contact|infos?|coord|adress|hor[ai]/i.test(u) ? 0 : 1
      return pri(a.u) - pri(b.u)
    })
    queue.push(...newLinks)
  }
  return pages
}

// ---------- BLOCK EXTRACTION ----------
const BLOCK_RE = /^(div|section|article|aside|main|p|h[1-6]|ul|ol|li|dl|dd|dt|table|tr|td|th|figure|figcaption)$/
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
      const text = $el.text().replace(/\s+/g, ' ').trim()
      if (text && text.length <= 140) out.push({ type: 'heading', level: +tag[1], text })
    } else if (tag === 'p') {
      const text = $el.text().replace(/\s+/g, ' ').trim()
      if (text.length >= 25 && !isNavLikeText(text)) out.push({ type: 'text', text })
    } else if (tag === 'li' || tag === 'dd' || tag === 'dt') {
      if (looksLikeNav($, el)) return
      const hasBlockChild = $el.find(BLOCK_RE).length > 0
      if (hasBlockChild) return
      const text = $el.text().replace(/\s+/g, ' ').trim()
      if (text.length >= 2 && text.length <= 400 && !isNavLikeText(text)) {
        out.push({ type: 'text', text })
      }
    } else if (tag === 'div') {
      if (looksLikeNav($, el)) return
      const hasBlockChild = $el.find(BLOCK_RE).length > 0
      if (hasBlockChild) return
      const direct = $el.contents().filter((_: number, n: any) => n.type === 'text')
        .map((_: number, n: any) => n.data).get().join(' ').replace(/\s+/g, ' ').trim()
      if (direct.length < 2) return
      const leaf = $el.text().replace(/\s+/g, ' ').trim()
      if (!leaf || leaf.length > 500) return
      if (isNavLikeText(leaf)) return
      out.push({ type: 'text', text: leaf })
    }
  })
  return out
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
async function sampleBrandColor($: cheerio.CheerioAPI, baseUrl: string): Promise<string | null> {
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
  const cssBrand = await sampleBrandColor($h, baseUrl)
  const brand = themeColor || cssBrand || null

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

  const phone = fallbackPhone(pages)
  const email = fallbackEmail(pages)
  const address = fallbackAddress(pages)

  const heroTitle = cfg.headings.find((h: any) => h.level === 1)?.text || cfg.og.title || cfg.name
  const heroLead = cfg.headings.find((h: any) => h.level === 2)?.text || cfg.og.description || ''

  const config = {
    tagline: cfg.og.description || $h('meta[name="description"]').attr('content') || null,
    address,
    phone,
    phone_href: phone ? 'tel:' + phone.replace(/[^\d+]/g, '') : null,
    email,
    maps_href: address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
      : null,
    logo_url: logoUrl,
    brand_primary: brand,
    brand_dark: cssBrand ? darken(cssBrand, 0.35) : null,
    theme_color: themeColor || cssBrand || null,
    pwa_name: cfg.name,
    pwa_short_name: cfg.name,
    pwa_description: cfg.og.description || null,
    hours: [],
    reservation_slots: [],
    hero: {
      eyebrow: null,
      title: heroTitle,
      lead: heroLead,
      // Prefer an extracted image; fall back to og:image so the hero
      // is never empty for sites that only declare images via meta.
      image_url: cfg.images[0]?.src || cfg.og.image || null
    },
    about: {
      kicker: '',
      title: '',
      image_url: cfg.images[1]?.src || cfg.images[0]?.src || cfg.og.image || null,
      paragraphs: cfg.texts.slice(0, 4).map((t: any) => t.text)
    },
    specialties: [],
    gallery: cfg.images.slice(0, 12).map((img: any) => ({
      src: img.src, caption: img.alt || ''
    })),
    sections: cfg.sections,
    source_url: target
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
    deploy: workflowUrl ? 'dispatched' : 'manual',
    deploy_log_url: workflowUrl,
    pages_url: `https://${inserted.slug}.pages.dev`,
    owner: ownerErr ? null : {
      placeholder_email: placeholderEmail,
      claim_code: claimCode
    }
  })
})
