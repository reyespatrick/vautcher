#!/usr/bin/env node
// =============================================================
//  Strict, no-invention extractor for the vautcher pipeline.
//
//  Crawls the home page + the internal pages it links to (depth 1,
//  capped) and pulls VERBATIM content into:
//    - top-level structured fields when the source exposes them
//      (name, slug, contact, hours via JSON-LD / OG / /contact regex)
//    - a `sections` array of typed blocks rendered in source order:
//        { type: 'heading', level, text }
//        { type: 'text', text }
//        { type: 'image', src, alt }
//
//  Hard rule (see memory/no-invention.md): the script never fabricates
//  content. If a value isn't on the source, it stays empty. The owner /
//  root reviews and fills the gaps via the restowner config editor.
//
//  Usage:  node extract-restaurant.js <url> [--out file] [--depth N]
//  Prereq: cd scripts && npm install
// =============================================================
import { load } from 'cheerio'
import { writeFile } from 'fs/promises'

const args = process.argv.slice(2)
let url = null
let outFile = null
let depth = 1
let maxPages = 12
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--out') outFile = args[++i]
  else if (a.startsWith('--out=')) outFile = a.slice(6)
  else if (a === '--depth') depth = Number(args[++i])
  else if (a.startsWith('--depth=')) depth = Number(a.slice(8))
  else if (a === '--max-pages') maxPages = Number(args[++i])
  else if (!url) url = a
}
if (!url) {
  console.error('usage: node extract-restaurant.js <url> [--out file] [--depth N]')
  process.exit(1)
}

const UA = 'Mozilla/5.0 (compatible; vautcher-extractor/2.0)'
async function fetchPage(u) {
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA } })
    if (!res.ok) return null
    const html = await res.text()
    return { html, url: res.url }
  } catch { return null }
}

const visited = new Set()
const pageData = [] // [{ url, $, html }]

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin } catch { return false }
}
function isAssetUrl(u) {
  return /\.(css|js|json|xml|ico|svg|png|jpe?g|gif|webp|pdf|mp4|webm|woff2?)(\?|$)/i.test(u)
}
function isNavLikeText(t) {
  return t.length < 25 || /^[A-Z\s·/|→\-]+$/.test(t)
}
function isIconImage(src) {
  return /(favicon|logo|icon|sprite|spacer|arrow_)/i.test(src)
}

async function crawl(startUrl) {
  const queue = [{ u: startUrl, d: 0 }]
  while (queue.length && visited.size < maxPages) {
    const { u, d } = queue.shift()
    if (visited.has(u)) continue
    visited.add(u)
    const page = await fetchPage(u)
    if (!page) continue
    const $ = load(page.html)
    pageData.push({ url: page.url, $, html: page.html })
    if (d >= depth) continue
    const newLinks = []
    $('a[href]').each((_, el) => {
      let href = $(el).attr('href')
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
      } catch { /* ignore */ }
    })
    // Prioritise pages likely to hold address / hours / contact info.
    newLinks.sort((a, b) => {
      const pri = (u) => /contact|infos?|coord|adress|hor[ai]/i.test(u) ? 0 : 1
      return pri(a.u) - pri(b.u)
    })
    queue.push(...newLinks)
  }
}

await crawl(url)

if (!pageData.length) {
  console.error(`fetch ${url} failed`)
  process.exit(1)
}

// Use the home page for the structured-data pass.
const home = pageData[0]
const $h = home.$
const baseUrl = home.url

// ---------- JSON-LD ----------
function collectJsonLd($) {
  const out = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text())
      const list = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of list) {
        if (item['@graph']) out.push(...item['@graph'])
        else out.push(item)
      }
    } catch { /* ignore malformed JSON-LD */ }
  })
  return out
}
function findByType(blobs, types) {
  for (const b of blobs) {
    const t = b['@type']
    const has = Array.isArray(t) ? t.some((x) => types.includes(x)) : types.includes(t)
    if (has) return b
  }
  return null
}
const ld = collectJsonLd($h)
const r = findByType(ld, ['Restaurant', 'FoodEstablishment', 'LocalBusiness']) || {}

// ---------- meta ----------
const meta = ($, name, attr = 'name') =>
  $(`meta[${attr}="${name}"]`).attr('content') || null
const og = {
  title: meta($h, 'og:title', 'property'),
  description: meta($h, 'og:description', 'property'),
  image: meta($h, 'og:image', 'property'),
  site_name: meta($h, 'og:site_name', 'property')
}
const themeColor = meta($h, 'theme-color')

// ---------- logo (highest-res favicon → og:image) ----------
function pickLogo() {
  if (r.logo) return typeof r.logo === 'string' ? r.logo : (r.logo.url || null)
  const icons = $h('link[rel*="icon"]').toArray()
    .map((el) => ({ href: $h(el).attr('href'), sizes: $h(el).attr('sizes') || '' }))
    .filter((i) => i.href)
  icons.sort((a, b) => {
    const az = parseInt((a.sizes.match(/\d+/) || ['0'])[0], 10)
    const bz = parseInt((b.sizes.match(/\d+/) || ['0'])[0], 10)
    return bz - az
  })
  if (icons[0]) {
    try { return new URL(icons[0].href, baseUrl).href } catch { return icons[0].href }
  }
  return og.image || null
}

// ---------- contact heuristics across ALL crawled pages ----------
function findInAllPages(re) {
  for (const { html } of pageData) {
    const m = html.match(re)
    if (m) return m[0].replace(/\s+/g, ' ').trim()
  }
  return null
}
function fallbackPhone() {
  // Require an explicit separator to avoid false positives like long digit runs.
  for (const { html } of pageData) {
    const matches = html.match(/(?:\+|00)\s?\d{1,3}[\s.\-]?(?:\(?\d{2,3}\)?[\s.\-]?){2,4}\d{2,4}/g)
    if (matches) {
      const valid = matches.find((s) => /[\s.\-]/.test(s))
      if (valid) return valid.replace(/\s+/g, ' ').trim()
    }
  }
  return null
}
function fallbackAddress() {
  // Allow commas inside the street portion ("Route de Suisse, 21 1290 …").
  return findInAllPages(/[A-ZÀ-Ž][\wÀ-ž'\-\s,]{3,80}\d{4,5}\s+[A-ZÀ-Ž][\wÀ-ž'\-]{2,30}/)
}
function fallbackEmail() {
  for (const { html } of pageData) {
    const m = html.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,8}/)
    if (m && !/example\.|test\./i.test(m[0])) return m[0]
  }
  return null
}

// ---------- structured hours from JSON-LD ----------
function pickHours() {
  const spec = r.openingHoursSpecification
  if (!spec) return []
  const list = Array.isArray(spec) ? spec : [spec]
  return list
    .map((s) => ({
      days: (Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek])
        .filter(Boolean)
        .map((d) => String(d).replace(/^https?:\/\/schema\.org\//, ''))
        .join(', '),
      service: '',
      time: s.opens && s.closes ? `${s.opens.slice(0, 5)} – ${s.closes.slice(0, 5)}` : ''
    }))
    .filter((h) => h.time)
}

// ---------- address composition ----------
function addressString() {
  if (typeof r.address === 'string') return r.address
  if (r.address && typeof r.address === 'object') {
    return [
      r.address.streetAddress,
      r.address.postalCode && r.address.addressLocality
        ? `${r.address.postalCode} ${r.address.addressLocality}`
        : (r.address.addressLocality || r.address.postalCode)
    ].filter(Boolean).join(', ')
  }
  return fallbackAddress()
}

// ---------- SECTION BLOCKS — verbatim, in source order ----------
// Walk each page's DOM and emit { type, ... } blocks for headings,
// paragraphs and content images. Carousel duplicates and navigation
// chrome are deduped after collection.
function extractBlocksFromPage($, pageUrl) {
  const out = []
  const $body = $('body').length ? $('body') : $.root()
  // Skip obvious header/nav/footer regions.
  $body.find('header, nav, footer, script, style, noscript').remove()
  $body.find('*').each((_, el) => {
    const tag = (el.tagName || '').toLowerCase()
    const $el = $(el)
    if (tag === 'img') {
      const src = $el.attr('src') || $el.attr('data-src')
      if (!src) return
      let abs
      try { abs = new URL(src, pageUrl).href } catch { return }
      if (isIconImage(abs)) return
      if (!/\.(jpe?g|png|webp|gif)(\?|$)/i.test(abs)) return
      out.push({ type: 'image', src: abs, alt: ($el.attr('alt') || '').trim() })
    } else if (/^h[1-4]$/.test(tag)) {
      const text = $el.text().replace(/\s+/g, ' ').trim()
      if (text && text.length <= 140) {
        out.push({ type: 'heading', level: +tag[1], text })
      }
    } else if (tag === 'p') {
      const text = $el.text().replace(/\s+/g, ' ').trim()
      if (text.length >= 25 && !isNavLikeText(text)) {
        out.push({ type: 'text', text })
      }
    }
  })
  return out
}

const allBlocks = []
for (const p of pageData) {
  for (const b of extractBlocksFromPage(p.$, p.url)) allBlocks.push(b)
}

// Dedupe by (type + content). Carousel slides repeat headings.
const seen = new Set()
function key(b) {
  if (b.type === 'image') return 'i:' + b.src
  if (b.type === 'heading') return 'h:' + b.text
  if (b.type === 'text') return 't:' + b.text
  return Math.random()
}
const sections = []
for (const b of allBlocks) {
  const k = key(b)
  if (seen.has(k)) continue
  seen.add(k)
  sections.push(b)
}

// ---------- back-compat: also flatten sections into legacy fields ----------
// The current diner-app views read about.paragraphs[] + gallery[] +
// hero.{eyebrow,title,lead}. Populate those from the first matching
// blocks; everything else stays in `sections` for the future
// block-renderer to surface verbatim.
const headings = sections.filter((s) => s.type === 'heading')
const texts = sections.filter((s) => s.type === 'text')
const images = sections.filter((s) => s.type === 'image')

const pageTitle = ($h('title').first().text() || '').trim()
const heroTitle = headings.find((h) => h.level === 1)?.text || og.title || pageTitle || ''
const heroLead = headings.find((h) => h.level === 2)?.text || og.description || ''

const aboutParagraphs = texts.slice(0, 4).map((t) => t.text)
const gallery = images.slice(0, 12).map((img) => ({ src: img.src, caption: img.alt || '' }))

// ---------- build the payload ----------
const phone = r.telephone || fallbackPhone()
const address = addressString()
const name = r.name || og.title || og.site_name || pageTitle || ''

const config = {
  tagline: og.description || meta($h, 'description') || null,
  address,
  phone,
  phone_href: phone ? 'tel:' + phone.replace(/[^\d+]/g, '') : null,
  email: r.email || fallbackEmail(),
  maps_href: r.hasMap ||
    (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null),
  logo_url: pickLogo(),
  // Brand colors: only set when explicitly published (theme-color meta).
  // Otherwise null and the diner app falls back to the system default —
  // never picked by eye, never sampled from a screenshot.
  brand_primary: themeColor || null,
  brand_dark: null,
  theme_color: themeColor || null,
  pwa_name: name,
  pwa_short_name: name,
  pwa_description: og.description || r.description || null,
  hours: pickHours(),
  reservation_slots: [],
  hero: {
    eyebrow: (r.address && r.address.addressLocality) || null,
    title: heroTitle,
    lead: heroLead
  },
  about: {
    kicker: '',
    title: '',
    image_url: images[0]?.src || null,
    paragraphs: aboutParagraphs
  },
  specialties: [],
  gallery,
  // Full verbatim stream for the future block-renderer. Source-ordered,
  // deduped, no synthesis. Keep alongside the legacy fields above.
  sections
}

const payload = { name, slug: null, config }

const stats = {
  pages_crawled: pageData.length,
  blocks_total: sections.length,
  headings: headings.length,
  texts: texts.length,
  images: images.length,
  phone: !!config.phone,
  address: !!config.address,
  email: !!config.email,
  hours: config.hours.length
}

const json = JSON.stringify(payload, null, 2)
if (outFile) {
  await writeFile(outFile, json)
  console.error(`→ wrote ${outFile}`)
  console.error('  ' + JSON.stringify(stats))
} else {
  console.log(json)
  console.error('--')
  console.error(JSON.stringify(stats, null, 2))
}
