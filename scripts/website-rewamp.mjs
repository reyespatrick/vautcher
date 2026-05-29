#!/usr/bin/env node
// website-rewamp.mjs — Claude-as-designer + verbatim fact gate.
//
//   node website-rewamp.mjs <url>
//
// Architecture:
//   1. Crawl the owner's site (home + obvious sub-pages).
//   2. Send Claude the source text + logo URL + candidate images with a
//      SENIOR DESIGNER brief: "design a completely unique single-page
//      site for THIS specific restaurant". Claude returns the full HTML.
//   3. Run a fact-check pass on Claude's output — extract every price /
//      phone / address-looking token, verify each appears verbatim in
//      the source. Report verified vs unverified counts. Stays light:
//      we don't auto-redact, we flag.
//
// No template. Every owner gets its own design from Claude.

import { load } from 'cheerio'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse')
const { chromium } = require('playwright')

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

const ANTHROPIC_KEY_PATH = '/Users/patrick/VMSharedFolder/Projects/restaurants/.secrets/anthropic-key'
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY?.trim()
  || (existsSync(ANTHROPIC_KEY_PATH) ? readFileSync(ANTHROPIC_KEY_PATH, 'utf8').trim() : null)
if (!ANTHROPIC_KEY) {
  console.error('Anthropic API key not found.')
  process.exit(1)
}
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

const SUBPAGE_RE = /\/(menu|carte|dishes|plats|specialites|sp[ée]cialit[ée]s|about|a[\-_]propos|notre[\-_]histoire|contact|infos?|horaires|reservation|reservations|gallery|galerie|photos)\b/i
// Visible link-text patterns. A nav button literally labelled "Menu",
// "Carte", "La carte" etc. is the strongest signal that the linked page
// IS the menu — even if its URL is something opaque like /p_53d2.
const LINK_TEXT_MENU_RE = /^(menu|carte|la\s+carte|notre\s+carte|menus|nos\s+menus|dishes|plats|sp[ée]cialit[ée]s|food|table|our\s+menu)$/i
// Contact-shaped link text — same idea as menu detection. Sites with
// opaque URLs (/p_…, /pg/…) often still label the contact page
// "Contact", "Nous contacter", "Coordonnées", "Réservation" etc.
const LINK_TEXT_CONTACT_RE = /^(contact|nous\s+contacter|nos\s+coordonn[ée]es|coordonn[ée]es|informations?|infos?|horaires|adresse|trouve[rz]\s+nous|find\s+us|où\s+nous\s+trouver|reservation|réservation|reserver|réserver|booking)$/i
const LINK_TEXT_GALLERY_RE = /^(gallery|galerie|galleries|photos|nos\s+photos|images?|album|portfolio|notre\s+galerie)$/i
const LINK_TEXT_OTHER_RE = /^(about|à\s+propos|notre\s+maison|histoire)$/i

// ---------- crawl ----------
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-CH,fr;q=0.9,en;q=0.8',
      'Upgrade-Insecure-Requests': '1'
    },
    redirect: 'follow'
  })
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`)
  return { html: await res.text(), url: res.url }
}

// Headless renderer — used when a page is JS-rendered (Wix, Squarespace,
// Webflow, etc.) so the static fetch returns an empty shell. Lazy-init
// the browser; the caller closes it at the end of the run.
let _browser = null
async function getBrowser() {
  if (_browser) return _browser
  _browser = await chromium.launch({ headless: true })
  return _browser
}
async function renderHtml(url) {
  const browser = await getBrowser()
  const ctx = await browser.newContext({ userAgent: UA, locale: 'fr-CH' })
  const page = await ctx.newPage()
  // Capture every PDF the page (or any iframe inside it) requests —
  // this is how we discover the menu PDF on Wix sites that embed an
  // Adobe DC viewer with the PDF URL passed via postMessage.
  const networkPdfs = new Set()
  ctx.on('request', (req) => {
    const u = req.url()
    if (/\.pdf(\?|#|$)/i.test(u)) networkPdfs.add(u.split('#')[0])
  })
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(4500)  // a bit longer so embedded viewers fire their PDF requests
    const html = await page.content()

    // Append same-origin iframe content where accessible.
    const NOISE_RE = /chat-widget|widget-server|engage\.wix|google|gstatic|doubleclick|recaptcha|gtm|analytics|hotjar/i
    const frameBlobs = []
    for (const f of page.frames()) {
      const furl = f.url()
      if (!furl || furl === 'about:blank' || furl === page.url()) continue
      if (NOISE_RE.test(furl)) continue
      try {
        const fhtml = await f.content()
        if (fhtml && fhtml.length > 500) frameBlobs.push(`<!-- frame: ${furl} -->\n${fhtml}`)
      } catch { /* cross-origin frame — skip */ }
    }
    const combined = frameBlobs.length ? html + '\n<!-- ATTACHED FRAMES -->\n' + frameBlobs.join('\n') : html
    return { html: combined, url: page.url(), pdfs: [...networkPdfs] }
  } finally {
    await ctx.close()
  }
}
async function closeBrowser() {
  if (_browser) { try { await _browser.close() } catch { /* ignore */ } _browser = null }
}

// How much visible body text does a page actually contain after we strip
// chrome? Anything under ~600 chars is almost certainly an empty shell
// from a JS-rendered framework.
function visibleBodyTextLength($) {
  const $$ = load($.html())
  $$('script, style, noscript, svg, iframe, link, meta, nav, header, footer').remove()
  return ($$('body').text() || '').replace(/\s+/g, ' ').trim().length
}
function sameOrigin(a, b) {
  try { const ua = new URL(a), ub = new URL(b); if (ua.protocol !== ub.protocol) return false
    const n = (h) => h.replace(/^www\./i, '').toLowerCase(); return n(ua.hostname) === n(ub.hostname)
  } catch { return false }
}
function absUrl(src, base) { try { return new URL(src, base).href } catch { return null } }

// Lazy-loading CDNs serve a heavily blurred low-quality image
// placeholder (LQIP) at tiny dimensions; the real image swaps in via
// JS on scroll. We never run their JS, so without normalising we'd
// embed the blurred thumbnail. Rule: every image URL we hand to the
// designer goes through this normaliser first — Wix, Cloudinary,
// Optimole, etc.
function cleanImageUrl(url) {
  if (!url) return url
  let u = url

  // Wix: …/v1/fill/w_113,h_141,…blur_2,q_80,enc_avif,…/file.jpg
  if (/static\.wixstatic\.com/.test(u)) {
    u = u.replace(/,blur_\d+/g, '')
    u = u.replace(/w_(\d+),h_(\d+)/g, (m, ws, hs) => {
      const w = parseInt(ws, 10), h = parseInt(hs, 10)
      if (w < 800 || h < 600) {
        const ratio = w / h || 4 / 3
        return `w_1600,h_${Math.round(1600 / ratio)}`
      }
      return m
    })
    u = u.replace(/q_\d{1,2},/g, 'q_90,')
  }

  // Cloudinary: …/upload/e_blur:NNN,w_200,h_200,…/file.jpg
  if (/res\.cloudinary\.com/.test(u)) {
    u = u.replace(/[/,]e_blur(?::\d+)?/g, '')
    u = u.replace(/[/,](w|h)_\d{1,3}\b/g, '') // drop tiny dimension constraints
  }

  // Optimole: ?quality=eco / -quality=eco / ?width=20
  if (/optimole\.com|i\.optimole\.com/.test(u)) {
    u = u.replace(/[?&]quality=eco/g, '')
    u = u.replace(/[?&]width=\d{1,3}(&|$)/g, '$1')
  }

  // Squarespace: ?format=300w (small) → ?format=2500w (large)
  if (/squarespace-cdn\.com|images\.squarespace-cdn\.com/.test(u)) {
    u = u.replace(/(\?|&)format=\d+w/g, '$1format=2500w')
  }

  return u
}

// Reject obvious placeholder/icon images BEFORE they reach Claude.
// Very-low-res sources or known lazy-placeholder markers don't survive.
function isPlaceholderImage(url) {
  if (!url) return true
  if (/^data:/i.test(url)) return true
  if (/(favicon|sprite|spacer|arrow_|placeholder|lqip|svg-loaders|tail-spin|loader|spinner)/i.test(url)) return true
  if (/\.(svg|ico|webmanifest)(\?|$)/i.test(url)) return true
  // Wix dimension marker still small after cleanup → it was tiny in source
  const wix = url.match(/static\.wixstatic\.com[\s\S]*?w_(\d+),h_(\d+)/)
  if (wix && parseInt(wix[1], 10) < 600) return true
  // Generic ?w=NN tiny constraint
  const w = url.match(/[?&]w(?:idth)?=(\d{1,3})\b/)
  if (w && parseInt(w[1], 10) < 300) return true
  return false
}
function realImgSrc($el) {
  const cands = [$el.attr('data-lazy-src'), $el.attr('data-src'), $el.attr('data-original'), $el.attr('src')]
  for (const c of cands) if (c && !c.startsWith('data:')) return c
  for (const s of [$el.attr('data-lazy-srcset'), $el.attr('srcset')]) {
    if (!s) continue
    const entries = s.split(',').map((e) => e.trim()).filter(Boolean)
      .map((e) => { const [u, sz] = e.split(/\s+/); return { url: u, size: parseInt((sz || '0').replace(/[^\d]/g, ''), 10) || 0 } })
      .filter((e) => e.url && !e.url.startsWith('data:'))
    if (entries.length) { entries.sort((a, b) => b.size - a.size); return entries[0].url }
  }
  return null
}
function findLogo($, baseUrl) {
  // A favicon / sprite / data-URI / tracking pixel is NOT a usable logo —
  // it's tiny and blurs when shown at header size. Skip those so we fall
  // through to a real image instead of settling for the favicon.
  const bad = (u) => !u || u.startsWith('data:') ||
    /\.ico(\?|#|$)/i.test(u) || /favicon|sprite|spacer|1x1|pixel|blank\./i.test(u)
  const take = (s) => (s && !bad(s)) ? cleanImageUrl(absUrl(s, baseUrl)) : null
  let r

  // 1. Explicit logo/brand markup (case-insensitive class match).
  const sel = 'img.logo, img.brand, img[class*="logo" i], img[class*="brand" i], .logo img, .brand img, .navbar-brand img, .site-logo img, .elementskit-nav-logo img, .header-logo img'
  if ((r = take(realImgSrc($(sel).first())))) return r

  // 2. Any <img> that calls itself a logo via its src filename or alt text.
  let viaName = null
  $('img').each((_, el) => {
    if (viaName) return
    const $el = $(el)
    const src = realImgSrc($el)
    if (src && !bad(src) && (/logo/i.test(src) || /logo/i.test($el.attr('alt') || ''))) viaName = src
  })
  if ((r = take(viaName))) return r

  // 3. First image inside a header / nav container — semantic OR named by
  //    class/id (covers site-builders like Duda's "dmHeader", Wix, etc.).
  if ((r = take(realImgSrc($('header img, nav img, [class*="header" i] img, [id*="header" i] img, [class*="navbar" i] img').first())))) return r

  // 4. Last resort before favicons: the first real content image. On the
  //    large majority of restaurant sites the logo is the very first <img>
  //    (the hero is usually a CSS background). Skip obvious photos.
  let firstImg = null
  $('img').each((_, el) => {
    if (firstImg) return
    const src = realImgSrc($(el))
    if (src && !bad(src) && !/hero|banner|slide|cover|background/i.test(src)) firstImg = src
  })
  if ((r = take(firstImg))) return r

  // 5. Icons / og:image — may be a low-res favicon, but the diner header
  //    skips those, so it's a harmless final fallback.
  const ati = $('link[rel="apple-touch-icon"]').attr('href')
  if (ati) return cleanImageUrl(absUrl(ati, baseUrl))
  const icons = $('link[rel*="icon"]').toArray()
    .map((el) => ({ href: $(el).attr('href'), size: parseInt((($(el).attr('sizes') || '').match(/\d+/) || ['0'])[0], 10) }))
    .filter((i) => i.href).sort((a, b) => b.size - a.size)
  if (icons[0]) return cleanImageUrl(absUrl(icons[0].href, baseUrl))
  return cleanImageUrl(absUrl($('meta[property="og:image"]').attr('content'), baseUrl))
}
// Structured contact metadata extraction. The bespoke HTML alone doesn't
// give the diner's shared shell (ContactView, ReservationView, etc.)
// what it needs — address/phone/email/hours have to land in the row
// as separate config fields. We pull them from the most reliable
// sources first (JSON-LD Restaurant), then fall back to meta tags +
// visible mailto:/tel: links.
const DOW = { mo: 'Lundi', tu: 'Mardi', we: 'Mercredi', th: 'Jeudi', fr: 'Vendredi', sa: 'Samedi', su: 'Dimanche' }
function parseSchemaHours(spec) {
  // Handles both the object form (openingHoursSpecification) and the
  // string form (openingHours = "Mo-Sa 11:30-14:00 18:30-23:00").
  const out = []
  const arr = Array.isArray(spec) ? spec : [spec]
  for (const s of arr) {
    if (s && typeof s === 'object') {
      const days = []
      const raw = s.dayOfWeek || s.dayofweek || []
      for (const d of (Array.isArray(raw) ? raw : [raw])) {
        const k = String(d).replace(/.*\//, '').slice(0, 2).toLowerCase()
        if (DOW[k]) days.push(DOW[k])
      }
      const time = [s.opens, s.closes].filter(Boolean).join(' – ')
      if (days.length && time) out.push({ days: days.join(', '), time })
    } else if (typeof s === 'string') {
      const m = s.match(/([A-Z][a-z](?:-[A-Z][a-z])?)\s+(\d{2}:\d{2})-(\d{2}:\d{2})/g)
      if (m) for (const tok of m) {
        const mm = tok.match(/([A-Z][a-z](?:-[A-Z][a-z])?)\s+(\d{2}:\d{2})-(\d{2}:\d{2})/)
        if (!mm) continue
        const dayPart = mm[1].split('-').map((d) => DOW[d.toLowerCase()] || d).join(' – ')
        out.push({ days: dayPart, time: `${mm[2]} – ${mm[3]}` })
      }
    }
  }
  return out
}
// Hours from visible text — for the many restaurant sites that don't
// ship schema.org opening hours. Looks for a day-name (or day-range
// like "Mardi au samedi") followed within ~80 chars by either a
// time-range ("09:00 – 14:00", "11h30-14h00", "9.00 14.00") or
// "fermé"/"closed". Returns [{days, time}] in source order.
const DAY_FR = '(?:lun(?:di)?|mar(?:di)?|mer(?:credi)?|jeu(?:di)?|ven(?:dredi)?|sam(?:edi)?|dim(?:anche)?)'
const DAY_RANGE = new RegExp(`\\b${DAY_FR}\\b(?:\\s*(?:au|à|jusqu['’]au|-|–|—|et|,|/)\\s*\\b${DAY_FR}\\b)?`, 'gi')
const TIME_PAIR = /(\d{1,2}[h:.]\d{0,2})\s*(?:[-–—à]|\s+à\s+|\s+au\s+|\s+)\s*(\d{1,2}[h:.]\d{0,2})/i
// Trailing \b doesn't fire after accented letters in JS regex (the
// word-boundary spec treats é/è as non-word), so we use a negative
// lookahead for letter-like chars instead.
const CLOSED_RE = /\b(ferm[ée]s?|closed)(?![a-zéèêà-ÿ])/i
function normTime(s) {
  // "9", "9.00", "09:00", "9h", "9h30" → "09h00" / "09h30"
  const m = s.match(/(\d{1,2})[h:.]?(\d{0,2})/)
  if (!m) return s
  const h = m[1].padStart(2, '0'); const min = (m[2] || '00').padEnd(2, '0').slice(0, 2)
  return `${h}h${min}`
}
function cap(s) {
  return s.toLowerCase().replace(/\b([a-zà-ÿ])([a-zà-ÿ-]*)\b/g, (_, a, b) => a.toUpperCase() + b)
}
function hoursFromText(text) {
  const t = (text || '').replace(/\s+/g, ' ')
  const out = []
  let m
  while ((m = DAY_RANGE.exec(t)) !== null) {
    const daysLabel = cap(m[0].replace(/\s+/g, ' ').trim())
    const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 90)
    const tm = tail.match(TIME_PAIR)
    const fm = tail.match(CLOSED_RE)
    // Time match has to start within 40 chars to be "near" the day-range.
    if (tm && tail.indexOf(tm[0]) < 40) {
      out.push({ days: daysLabel, time: `${normTime(tm[1])} – ${normTime(tm[2])}` })
    } else if (fm && tail.indexOf(fm[0]) < 30) {
      out.push({ days: daysLabel, time: 'Fermé' })
    }
  }
  // Dedupe — same range can appear multiple times on a page.
  const seen = new Set(), uniq = []
  for (const h of out) {
    const k = h.days + '|' + h.time
    if (!seen.has(k)) { seen.add(k); uniq.push(h) }
  }
  return uniq
}

function ldAddressToString(a) {
  if (!a) return null
  if (typeof a === 'string') return a
  const parts = [a.streetAddress, [a.postalCode, a.addressLocality].filter(Boolean).join(' '), a.addressRegion, a.addressCountry].filter(Boolean)
  return parts.join(', ') || null
}
// Sniff a Swiss/French-style address from visible text. Matches lines
// that start with Route / Rue / Chemin / Avenue / Bd / Quai / Place /
// Av., followed by a number + city. Returns the longest match found,
// preferring lines with a 4-digit postal code on the same line.
const ADDR_RE = /(?:Route|Rue|Chemin|Avenue|Av\.|Boulevard|Bd\.?|Quai|Place|Pl\.)\s+[^,\n<]{3,80}(?:,?\s+\d{4}\s+[A-ZÉÈÊ][a-zéèêç-]+)?/gi
function addressFromText(text) {
  const matches = (text.match(ADDR_RE) || [])
    .map((m) => m.replace(/\s+/g, ' ').trim())
    .filter((m) => m.length > 12)
  // Prefer matches that include a postal code (e.g. "1290 Versoix").
  const withCity = matches.filter((m) => /\d{4}\s+[A-Z]/.test(m))
  return (withCity[0] || matches[0]) || null
}

function extractStructuredFromPage($, baseUrl) {
  const out = { name: null, description: null, address: null, phone: null, email: null, hours: [] }
  // 1) JSON-LD — the gold-standard source.
  const blobs = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text())
      const flat = Array.isArray(data) ? data : (data['@graph'] || [data])
      for (const d of flat) blobs.push(d)
    } catch {/* ignore */}
  })
  for (const d of blobs) {
    const t = String(d?.['@type'] || '').toLowerCase()
    if (!/restaurant|foodestablish|localbusiness|cafe|bar/.test(t)) continue
    out.name ||= d.name || null
    out.description ||= d.description || null
    out.address ||= ldAddressToString(d.address)
    out.phone ||= d.telephone || null
    out.email ||= d.email || null
    if (!out.hours.length) {
      const hrs = d.openingHoursSpecification || d.openingHours
      if (hrs) out.hours = parseSchemaHours(hrs)
    }
  }
  // 2) Visible tel:/mailto: + og/meta description.
  out.description ||= $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || null
  if (!out.phone) {
    const tel = $('a[href^="tel:"]').first().attr('href')
    if (tel) out.phone = tel.replace(/^tel:/i, '').trim()
  }
  if (!out.email) {
    const mail = $('a[href^="mailto:"]').first().attr('href')
    if (mail) out.email = mail.replace(/^mailto:/i, '').split('?')[0].trim()
  }
  // 3) Address + hours from visible body text — used when no JSON-LD
  //    ships them (most hand-built sites). The /contact page typically
  //    has both; the merge in extractStructured prefers earlier pages
  //    via ||= so contact-flagged pages can be hoisted by the caller.
  const bodyText = $('body').text().replace(/\s+/g, ' ')
  if (!out.address) out.address = addressFromText(bodyText)
  if (!out.hours.length) out.hours = hoursFromText(bodyText)
  return out
}

// Merge structured info across all crawled pages, EXPLICITLY favouring
// contact-flagged pages for address / phone / email / hours. The /contact
// page is the canonical source on hand-built sites; checking it first
// avoids picking up a partial mention from the home page (e.g. only a
// phone number in the footer, no address or hours).
function extractStructured(pages, _baseUrl) {
  const merged = { name: null, description: null, address: null, phone: null, email: null, hours: [], maps_href: null, source: {} }
  const ordered = [...pages].sort((a, b) => (b.isContact - a.isContact))
  for (const p of ordered) {
    const got = extractStructuredFromPage(p.$, p.url)
    const tag = p.isContact ? '☎' : p === pages[0] ? '⌂' : ' '
    for (const k of ['name', 'description', 'address', 'phone', 'email']) {
      if (!merged[k] && got[k]) { merged[k] = got[k]; merged.source[k] = `${tag} ${p.url}` }
    }
    if (!merged.hours.length && got.hours.length) {
      merged.hours = got.hours
      merged.source.hours = `${tag} ${p.url}`
    }
  }
  if (merged.address) merged.maps_href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(merged.address)}`
  return merged
}

function collectImages($, baseUrl, exclude) {
  const out = []
  const seen = new Set([exclude].filter(Boolean))
  $('img').each((_, el) => {
    const src = realImgSrc($(el))
    if (!src) return
    const abs = cleanImageUrl(absUrl(src, baseUrl))
    if (!abs || seen.has(abs)) return
    if (isPlaceholderImage(abs)) return
    seen.add(abs)
    out.push({ src: abs, alt: ($(el).attr('alt') || '').trim() })
  })
  return out
}
function pageToText($) {
  const $$ = load($.html())
  $$('script, style, noscript, svg, iframe, link, meta, nav, header.header, .site-header, footer, .footer, .ekit-nav-menu, .elementor-nav-menu').remove()
  return $$('body').text().replace(/\s+/g, ' ').trim().slice(0, 12000)
}

// ---------- source palette extraction ----------
// Tally hex/rgb colour references in the source CSS, drop neutrals,
// pick the most-used as the brand primary. Gives Claude something to
// anchor on so the redesign feels like "this restaurant", not generic.
function isNeutralHex(hex) {
  const m = hex.match(/^#?([0-9a-f]{3,8})$/i)
  if (!m) return true
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6)
  if (h.length !== 6) return true
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max < 30) return true       // near-black
  if (min > 235) return true      // near-white
  if (max - min < 18) return true // grey
  return false
}
function rgbToHex(r, g, b) { return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('') }
function darken(hex, amt = 0.32) {
  const h = hex.replace('#', '').padStart(6, '0')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return rgbToHex(r * (1 - amt), g * (1 - amt), b * (1 - amt))
}
async function loadAllCss($, baseUrl) {
  const out = []
  $('style').each((_, el) => out.push($(el).text() || ''))
  const links = []
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    const abs = absUrl(href, baseUrl)
    if (abs) links.push(abs)
  })
  for (const href of links.slice(0, 8)) {
    try {
      const res = await fetch(href, { headers: { 'User-Agent': UA }, redirect: 'follow' })
      if (res.ok) out.push(await res.text())
    } catch { /* ignore */ }
  }
  return out.join('\n')
}
function brandColorsFromCss(css) {
  const counts = new Map()
  const bump = (hex) => { if (!hex) return; const norm = hex.toLowerCase(); counts.set(norm, (counts.get(norm) || 0) + 1) }
  // Hex tokens
  ;(css.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi) || []).forEach((m) => {
    let h = m.replace('#', '')
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    bump('#' + h.toLowerCase())
  })
  // rgb()/rgba()
  ;(css.match(/rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}/g) || []).forEach((m) => {
    const [r, g, b] = m.match(/\d{1,3}/g).map(Number)
    bump(rgbToHex(r, g, b))
  })
  const ranked = [...counts.entries()].filter(([h]) => !isNeutralHex(h)).sort((a, b) => b[1] - a[1])
  return ranked.slice(0, 4).map(([h, n]) => ({ hex: h, count: n }))
}
function discoverSubpages($, baseUrl) {
  // Two ways in:
  //  - URL pattern matches /menu, /carte, /contact, etc.
  //  - Link text matches "Menu", "Carte", "Contact", etc. — covers
  //    sites whose URLs are opaque (e.g. /p_53d2, /pg/123).
  // The "menu"-shaped entry is hoisted to the front so it's crawled
  // (and headless-rendered if needed) first.
  const found = new Map() // url → { isMenu, isContact, isGallery, score }
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href || /^(#|javascript:|mailto:|tel:|data:)/i.test(href)) return
    const abs = absUrl(href, baseUrl)
    if (!abs || !sameOrigin(abs, baseUrl)) return
    const linkText = ($(el).text() || '').replace(/\s+/g, ' ').trim()
    const urlMenu = /\/(menu|carte|dishes|plats|specialites|sp[ée]cialit[ée]s)\b/i.test(abs)
    const textMenu = LINK_TEXT_MENU_RE.test(linkText)
    const urlContact = /\/(contact|coordonn[ée]es|infos?|horaires|reservation|reservations)\b/i.test(abs)
    const textContact = LINK_TEXT_CONTACT_RE.test(linkText)
    const urlGallery = /\/(gallery|galerie|galleries|photos|album|portfolio)\b/i.test(abs)
    const textGallery = LINK_TEXT_GALLERY_RE.test(linkText)
    const urlOther = SUBPAGE_RE.test(abs)
    const textOther = LINK_TEXT_OTHER_RE.test(linkText)
    if (!urlMenu && !textMenu && !urlContact && !textContact && !urlGallery && !textGallery && !urlOther && !textOther) return
    const cur = found.get(abs) || { isMenu: false, isContact: false, isGallery: false, score: 0 }
    cur.isMenu = cur.isMenu || urlMenu || textMenu
    cur.isContact = cur.isContact || urlContact || textContact
    cur.isGallery = cur.isGallery || urlGallery || textGallery
    // Score: menu (3) > contact (2) > gallery (2) > other (1). Higher
    // score = crawled earlier (priority queue).
    const s = (urlMenu || textMenu) ? 3 : (urlContact || textContact || urlGallery || textGallery) ? 2 : 1
    cur.score = Math.max(cur.score, s)
    found.set(abs, cur)
  })
  return [...found.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([url, info]) => ({ url, isMenu: info.isMenu, isContact: info.isContact, isGallery: info.isGallery }))
    .slice(0, 6)
}

// Many restaurants link their actual menu as a PDF rather than embedding
// it in HTML. Without reading those PDFs we have no real dish/price
// data and Claude ends up inventing the menu (verbatim gate then drops
// most claims). Discover PDFs on the crawled pages, prioritising
// menu-shaped link text + filenames, and extract their text.
const PDF_HINT_RE = /menu|carte|dishes|plats|specialites|sp[ée]cialit[ée]s|vins?|wine|drink|boisson/i
function discoverPdfs(pages, baseUrl) {
  const found = new Map() // url → score
  for (const { $, url } of pages) {
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || ''
      if (!/\.pdf(\?|#|$)/i.test(href)) return
      const abs = absUrl(href, url)
      if (!abs) return
      const linkText = ($(el).text() || '') + ' ' + (href.split('/').pop() || '')
      const hint = PDF_HINT_RE.test(linkText) ? 2 : 1
      found.set(abs, Math.max(found.get(abs) || 0, hint))
    })
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 3)
}

async function fetchPdf(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 30 * 1024 * 1024) throw new Error(`pdf too large (>${Math.round(buf.length / 1024 / 1024)}MB)`)
  const parser = new PDFParse({ data: buf })
  let text = ''
  try {
    const out = await parser.getText()
    text = (out.text || (out.pages || []).map((p) => p.text).join('\n') || '').replace(/\s+/g, ' ').trim()
  } finally {
    try { await parser.destroy() } catch { /* ignore */ }
  }
  return { buf, text, base64: buf.toString('base64') }
}

// ---------- Claude designer ----------
const DESIGNER_BRIEF = ({ sourceUrl, sourceText, logoUrl, images, palette, themeColor, hasPdfMenu }) => `You are a senior website designer. The owner has commissioned a single-page redesign of their existing site. Below is everything you have to work from.

OUTPUT FORMAT
Call the build_site tool with TWO inputs:
  - html: the page HTML+CSS for every section EXCEPT the menu. Put a literal "<!-- @MENU -->" marker where the menu section should go — our renderer fills it in using the structured menu data below. Inline all CSS. Google Fonts ok.
  - menu: structured data describing the menu — an array of { category, items: [{ name, description?, price?, variants? }] }. EVERY dish name and price here must appear verbatim in the source text / PDF below. Our code re-checks each one and drops anything not verifiable. Do not include dishes you cannot verify.
    Description rule (HARD): every dish that has descriptive text in the source (ingredients, garnishes, preparation notes — anything that follows the dish name on the menu) MUST appear in the description field, copied VERBATIM from source. Do not skip descriptions when they exist. Do not paraphrase. Example: for "BRIOCHE RÔTIE, compotée d'échalotes et gésiers à l'estragon, émulsion Comté caramélisée" → name="Brioche rôtie", description="compotée d'échalotes et gésiers à l'estragon, émulsion Comté caramélisée".
${hasPdfMenu ? `  THE MENU IS PROVIDED AS A PDF DOCUMENT (attached). Read it carefully — dishes and their prices sit in two visual columns on the same row, even though the extracted text dumps dishes first then prices. Use the PDF's visual layout to pair dishes with their correct prices.` : ''}

CSS HOOK FOR THE MENU
Our renderer injects this exact HTML structure at the marker. Style these classes in your <style> tag:

  <section class="rw-menu">
    <div class="rw-menu-head"><h2>{your title}</h2></div>
    <div class="rw-menu-cats">
      <article class="rw-cat">
        <h3 class="rw-cat-name">{category}</h3>
        <ul class="rw-dishes">
          <li class="rw-dish">
            <div class="rw-dish-head">
              <span class="rw-dish-name">{name}</span>
              <span class="rw-dish-price">{price}</span>
            </div>
            <p class="rw-dish-desc">{description}</p>
            <ul class="rw-variants">
              <li><span class="rw-v-label">{label}</span> <span class="rw-v-price">{price}</span></li>
            </ul>
          </li>
        </ul>
      </article>
    </div>
  </section>

You decide the visual treatment (grid vs single column, dotted leader vs box, serif vs sans, light vs dark panel, etc.) — match the rest of your design. Just style the classes above.

OUTPUT SIZE BUDGET (hard ceiling — must fit)
- The non-menu HTML stays under ~25,000 characters; menu data is separate.
- Keep CSS tight: no duplicate selectors, no over-decoration.
- One concise hero, one about, the @MENU marker, one info/hours, one footer.
- SVG/decoration: at most one small decorative SVG.

CSS CORRECTNESS — easy mistakes that ruin layouts
- ALWAYS prefix class selectors with a dot: ".nav-logo" not "nav-logo". Same for IDs (#hero not hero). If you write a selector without a dot, you're targeting an element type that doesn't exist and your styles silently never apply.
- ALWAYS cap the logo image size: any <img> inside the nav/header MUST have an explicit max-height or height in CSS (e.g. 40–80px). The source logo from the CDN can be 1600px+ — if you don't constrain it, it bleeds across the entire page and breaks the nav.
- Background images and decorative photos should have object-fit:cover and explicit dimensions.

DESIGN MANDATE
Design something UNIQUE to THIS restaurant. Read between the lines of the source text: cuisine, price level, neighbourhood, target audience, atmosphere. Then make every design choice — palette, typography pair, layout pattern, decorative elements, photo treatment, hero treatment, menu presentation — fit THIS owner. Two different restaurants you redesign should not look like minor variations of each other. A fine-dining table is not a casual pub. A trattoria is not a sushi spot. A lake-view terrace is not an urban bar.

Vary across designs you produce: serif vs sans display fonts, warm vs cool palettes, asymmetric vs grid layouts, dense menus vs spacious editorial, dark mode vs paper mode, photographic vs illustrated, animated vs static. Pick what fits THIS site.

COLOUR THEME
Keep the original site's main colour. The palette extracted from the source CSS is below — use the dominant hue (or its meta theme-color, if present) as the primary brand colour of your redesign. You may introduce complementary variants — a deeper shade for headers, a soft tint for surfaces, a contrast accent for CTAs — but the dominant colour of the redesign must be recognisably the same family as the source. Don't redesign a green restaurant into a burgundy one; keep them green.
${palette.length ? `Extracted palette (most-used non-neutral colours, descending):\n${palette.map((p) => `  ${p.hex} (×${p.count})`).join('\n')}` : '(no clear brand colour in source — choose one that fits the cuisine/vibe)'}
${themeColor ? `<meta name="theme-color"> on the source: ${themeColor}` : ''}

TYPOGRAPHY — MATCH THE MENU
Look at the typography in the menu (PDF or rendered page) and pick fonts for your design that respect it. The menu is the strongest typographic signal of the restaurant's identity — match its character:
  - Elegant high-contrast serif on the menu (Didone-style: tall thin verticals, hairline serifs) → use Playfair Display, Bodoni, Cormorant.
  - Humanist serif (Garamond, Caslon, classic book serif) → use EB Garamond, Cormorant Garamond, Crimson Text.
  - Slab serif on the menu → use Fraunces, Bitter, Rozha One.
  - Geometric sans (Futura-like, all-caps, tight tracking) → use Montserrat, Manrope, Inter with heavy weights.
  - Hand-script or display flourishes → use Cormorant Italic, or a single elegant script for headings (Italianno, Tangerine) paired with a clean sans.
  - Industrial / heavy condensed → use Oswald, Bebas Neue, Anton.
Then carry that family into the menu section of your design. The page can have a different body font from the menu (e.g. menu = serif, body = sans) but the menu typography must echo the source PDF's menu typography. Two glances should tell the diner "this is the same restaurant".

FONTS — OPEN-LICENSE ONLY (HARD RULE)
Use ONLY fonts hosted on Google Fonts (open / SIL OFL licence). NEVER @font-face the original site's own font files, and NEVER name a proprietary/commercial font in your CSS (Helvetica Neue, Avenir, Gotham, Proxima Nova, DIN, Futura, Trade Gothic, Circular, Brandon Grotesque, etc.). When the original site uses such a font, pick the CLOSEST-looking Google Font using the mapping above. The result will differ slightly from the original — that is expected and required: licensed fonts cannot be embedded. Always emit the matching Google Fonts <link> for every family you use.

HARD RULES (anti-hallucination — these get auto-checked)
1. Restaurant name, address, phone number, email, opening hours, dish names, prices, allergen labels, supplier names: MUST appear VERBATIM somewhere in the source text below. Do not invent any factual claim. If a fact isn't in source, omit it.
2. Times can be reformatted: "11:30" → "11h30 –" is fine; "WEEKDAYS" → "Lundi – Vendredi" is fine. The digits must match source.
3. Logo: use the provided LOGO URL exactly, as <img src="..."> in the header. Don't substitute.
4. Photos: only use images from the candidate image list below. If the list is empty, use no photos (rely on typography, gradients, illustrations, SVG).

FREE INVENTION (allowed, encouraged for variety)
Hero taglines, story/about prose, marquee phrases, section intros, section titles, button labels, CTA copy, marketing flavour. Make them fit the restaurant's inferred vibe. No dates, years, founders, neighbourhoods, awards, or other claimable facts unless they appear in source.

INPUT
Source URL: ${sourceUrl}
Logo URL: ${logoUrl || '(none found — design around typography or SVG)'}
Candidate images (use these for hero/gallery if helpful):
${images.length ? images.slice(0, 12).map((i) => `- ${i.src}${i.alt ? ` (alt: ${i.alt})` : ''}`).join('\n') : '(no usable images found)'}

Source text (the only truth source for facts):
${sourceText}`

const TOOL = {
  name: 'build_site',
  description: 'Submit the page HTML (minus menu) plus structured menu data.',
  input_schema: {
    type: 'object',
    properties: {
      html: { type: 'string', description: 'Complete <!doctype html>…</html> file with a literal <!-- @MENU --> marker where the menu section should be injected. Inline CSS in <style>.' },
      menu: {
        type: 'array',
        description: 'Structured menu — categories with items. Each name/price MUST appear verbatim in the source.',
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
                  price: { type: ['string', 'null'] },
                  variants: {
                    type: ['array', 'null'],
                    items: { type: 'object', properties: { label: { type: 'string' }, price: { type: 'string' } }, required: ['label', 'price'] }
                  }
                },
                required: ['name']
              }
            }
          },
          required: ['category', 'items']
        }
      },
      design_notes: { type: 'string', description: 'One-sentence summary of the design direction.' }
    },
    required: ['html', 'menu']
  }
}

async function askClaude(input, pdfDocs, attempt = 1) {
  // Build a multimodal user message: design brief + each PDF as a document block.
  const content = [{ type: 'text', text: DESIGNER_BRIEF({ ...input, hasPdfMenu: pdfDocs.length > 0 }) }]
  for (const pdf of pdfDocs) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdf.base64 },
      title: pdf.title || 'Menu PDF'
    })
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 16000,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'build_site' },
      messages: [{ role: 'user', content }]
    })
  })
  if (res.status === 429 && attempt < 2) {
    console.warn('  rate-limited (429) — waiting 65s and retrying once…')
    await new Promise((r) => setTimeout(r, 65000))
    return askClaude(input, pdfDocs, attempt + 1)
  }
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const tool = (data.content || []).find((c) => c.type === 'tool_use')
  if (!tool) throw new Error('No tool_use in Claude response')
  const html = (tool.input?.html || '').trim()
  const menu = Array.isArray(tool.input?.menu) ? tool.input.menu : []
  const stop = data.stop_reason
  if (!html) throw new Error(`empty html in tool_use (stop_reason=${stop})`)
  if (stop === 'max_tokens') throw new Error(`response truncated at max_tokens (16000) — html ${html.length} chars`)
  if (!/<\/html>\s*$/i.test(html)) throw new Error(`html doesn't end with </html> — likely truncated (length ${html.length}, stop=${stop})`)
  return { html, menu, notes: tool.input.design_notes || '', usage: data.usage || {} }
}

// ---------- fact gate ----------
// Normalise for verbatim matching: lowercase, strip accents, and unify
// typographic apostrophes/quotes (curly ' vs straight ') so a dish like
// "Souris d'agneau" isn't dropped just because the source uses a curly ’.
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[‘’ʼ`´]/g, "'")
  .replace(/[“”«»]/g, '"')
  .replace(/\s+/g, ' ').trim()

function isDishyName(s) {
  const t = (s || '').trim()
  if (!t) return false
  if (/^\s*(CHF|EUR|€|F)?\s*\d+[.,]?-?\d*\s*(CHF|EUR|€|F)?\s*(\([^)]+\))?\s*$/i.test(t)) return false
  if (/^\s*(variantes?|commentaires?|options?|all[ée]rg[ée]nes?|suppl[ée]ments?|ingr[ée]dients?)\b[\s/]*[:•]/i.test(t)) return false
  if ((t.match(/[\p{L}]/gu) || []).length < 2) return false
  return true
}

// Verbatim gate the structured menu. Every dish name (and its price)
// must be findable in the source corpus (HTML text + PDF text). Items
// that don't survive are dropped — the user wanted 100% verifiable,
// and silent dropping > shipping invented dishes.
function gateMenu(menu, sourceText) {
  const srcN = norm(sourceText)
  const srcDigits = srcN.replace(/[^\d]/g, '')
  const digits = (s) => String(s || '').replace(/[^\d]/g, '')

  // Punctuation-insensitive variant of the source — tolerate comma / dash /
  // apostrophe / parenthesis differences between source and model output.
  const stripPunct = (x) => norm(x).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const srcNP = stripPunct(sourceText)

  const matchIn = (needle, hay) => {
    if (!needle) return false
    if (needle.length > 80) {
      for (let i = 0; i + 40 <= needle.length; i += 20) if (hay.includes(needle.slice(i, i + 40))) return true
      return false
    }
    return hay.includes(needle)
  }
  const inSourceText = (s, minLen = 4) => {
    if (!s) return false
    const n = norm(s)
    if (n.length < minLen) return false
    if (matchIn(n, srcN)) return true
    // Fallback: ignore punctuation entirely (apostrophes, commas, dashes).
    const np = stripPunct(s)
    return np.length >= minLen && matchIn(np, srcNP)
  }
  const priceOk = (s) => { const d = digits(s); return d.length >= 1 && srcDigits.includes(d) }

  const out = []
  const dropped = []
  for (const cat of menu) {
    if (!cat || typeof cat !== 'object') continue
    const category = String(cat.category || '').trim()
    if (!category) continue
    const items = []
    for (const it of (Array.isArray(cat.items) ? cat.items : [])) {
      if (!it || !it.name) continue
      const name = String(it.name).trim()
      if (!isDishyName(name)) { dropped.push({ category, name, reason: 'not a dish name' }); continue }
      if (!inSourceText(name, 4)) { dropped.push({ category, name, reason: 'name not in source' }); continue }
      // Price: if provided, must verify
      let price = it.price ? String(it.price).trim() : null
      if (price && !priceOk(price)) { dropped.push({ category, name, reason: `price "${price}" not in source` }); price = null }
      // Description: if provided, must verify (lenient)
      let description = it.description ? String(it.description).trim() : ''
      if (description && !inSourceText(description, 10)) description = ''
      // Variants
      const variants = []
      for (const v of (Array.isArray(it.variants) ? it.variants : [])) {
        if (!v?.label || !v?.price) continue
        const lbl = String(v.label).trim(), pr = String(v.price).trim()
        if (inSourceText(lbl, 2) && priceOk(pr)) variants.push({ label: lbl, price: pr })
        else dropped.push({ category, name: `${name} (${lbl})`, reason: 'variant not in source' })
      }
      items.push({ name, description, price, variants })
    }
    if (items.length) out.push({ category, items })
  }
  return { menu: out, dropped }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderMenuHtml(menu) {
  // No verifiable dishes → drop the menu section entirely (the @MENU
  // marker becomes empty) rather than shipping an empty "La carte"
  // placeholder.
  if (!menu.length) return ''
  const cats = menu.map((cat) => {
    const items = cat.items.map((d) => {
      const variants = (d.variants || []).map((v) => `<li><span class="rw-v-label">${esc(v.label)}</span> <span class="rw-v-price">${esc(v.price)}</span></li>`).join('')
      return `<li class="rw-dish">
        <div class="rw-dish-head">
          <span class="rw-dish-name">${esc(d.name)}</span>
          ${d.price && !variants ? `<span class="rw-dish-price">${esc(d.price)}</span>` : ''}
        </div>
        ${d.description ? `<p class="rw-dish-desc">${esc(d.description)}</p>` : ''}
        ${variants ? `<ul class="rw-variants">${variants}</ul>` : ''}
      </li>`
    }).join('')
    return `<article class="rw-cat">
      <h3 class="rw-cat-name">${esc(cat.category)}</h3>
      <ul class="rw-dishes">${items}</ul>
    </article>`
  }).join('')
  return `<section class="rw-menu">
    <div class="rw-menu-head"><h2>La carte</h2></div>
    <div class="rw-menu-cats">${cats}</div>
  </section>`
}

function visibleText(html) {
  const $$ = load(html)
  $$('script, style, noscript').remove()
  return $$('body').text().replace(/\s+/g, ' ')
}

function factCheck(html, sourceText) {
  const text = visibleText(html)
  const srcN = norm(sourceText)
  const srcDigits = srcN.replace(/[^\d]/g, '')
  const digitsOnly = (s) => s.replace(/[^\d]/g, '')

  const verify = {
    prices: { ok: [], bad: [] },
    phones: { ok: [], bad: [] },
    addresses: { ok: [], bad: [] }
  }

  // Prices: "16.-" / "16.–" / "CHF 18" / "18 CHF" / "18.50"
  const priceTokens = new Set()
  ;(text.match(/(?:CHF\s*)?\d{1,4}(?:[.,]\d{2})?\s*[\-–](?!\d)/g) || []).forEach((m) => priceTokens.add(m.trim()))
  ;(text.match(/CHF\s*\d{1,4}(?:[.,]\d{2})?/g) || []).forEach((m) => priceTokens.add(m.trim()))
  ;(text.match(/\d{1,4}[.,]\d{2}\s*(CHF|EUR|€)/g) || []).forEach((m) => priceTokens.add(m.trim()))

  for (const t of priceTokens) {
    const d = digitsOnly(t)
    if (d.length < 1) continue
    // Match if digits sequence appears in source digits stream.
    if (srcDigits.includes(d) || srcN.includes(norm(t))) verify.prices.ok.push(t)
    else verify.prices.bad.push(t)
  }

  // Phones: +41 22 xxx xx xx / 022 xxx xx xx / etc.
  const phoneTokens = new Set()
  ;(text.match(/(?:\+|00)\s?\d{1,3}[\s.\-]?(?:\(?\d{2,3}\)?[\s.\-]?){2,4}\d{2,4}/g) || []).forEach((m) => phoneTokens.add(m.trim()))
  ;(text.match(/\b0\d{2}[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2}\b/g) || []).forEach((m) => phoneTokens.add(m.trim()))

  for (const t of phoneTokens) {
    const d = digitsOnly(t)
    if (d.length < 7) continue
    if (srcDigits.includes(d)) verify.phones.ok.push(t)
    else verify.phones.bad.push(t)
  }

  // Swiss-style addresses: "1290 Versoix", "1207 Genève"
  const addrTokens = new Set()
  ;(text.match(/\b\d{4}\s+[A-ZÀ-Ž][A-Za-zÀ-ÿ\-']+/g) || []).forEach((m) => addrTokens.add(m.trim()))

  for (const t of addrTokens) {
    if (norm(t).split(' ').every((w) => srcN.includes(w))) verify.addresses.ok.push(t)
    else verify.addresses.bad.push(t)
  }

  return verify
}

// ---------- main ----------
function hostSlug(url) { try { return new URL(url).hostname.replace(/^www\./, '').replace(/[^\w.-]+/g, '-') } catch { return 'preview' } }

async function main() {
  const url = process.argv[2]
  if (!url) { console.error('usage: node website-rewamp.mjs <url>'); process.exit(1) }
  const target = /^https?:\/\//.test(url) ? url : 'https://' + url

  console.log(`→ crawl home: ${target}`)
  let home = await fetchHtml(target)
  let $h = load(home.html)
  const networkPdfs = new Set()
  // If the home page is a JS-rendered shell (< 600 chars visible text),
  // re-fetch with the headless browser so we actually see the content.
  const homeVisible = visibleBodyTextLength($h)
  if (homeVisible < 600) {
    console.log(`  static fetch thin (${homeVisible} chars) → re-rendering with headless browser…`)
    try {
      const rendered = await renderHtml(target)
      home = rendered
      $h = load(home.html)
      ;(rendered.pdfs || []).forEach((u) => networkPdfs.add(u))
      console.log(`  rendered: ${visibleBodyTextLength($h)} chars${rendered.pdfs?.length ? `, ${rendered.pdfs.length} PDF(s) intercepted` : ''}`)
    } catch (e) { console.warn(`  headless failed: ${e.message}`) }
  }
  const logo = findLogo($h, home.url)
  console.log(`  logo: ${logo || '(none)'}`)

  // Source palette + theme-color → anchor the designer to the owner's colour identity.
  const themeColor = $h('meta[name="theme-color"]').attr('content') || null
  const css = await loadAllCss($h, home.url)
  const palette = brandColorsFromCss(css)
  console.log(`  palette: ${palette.length ? palette.map((p) => `${p.hex}(${p.count})`).join(' ') : '(none)'}${themeColor ? `  theme: ${themeColor}` : ''}`)

  const subs = discoverSubpages($h, home.url)
  console.log(`→ ${subs.length} sub-page(s)${subs.length ? ' (★=menu, ☎=contact, 📷=gallery)' : ''}`)
  const pages = [{ url: home.url, $: $h, isMenu: false, isContact: false, isGallery: false }]
  const corpora = [`# ${home.url}\n${pageToText($h)}`]
  const images = collectImages($h, home.url, logo)
  // Gallery-page images are tracked separately so we can prefer them
  // for the picker even when they're discovered later in the crawl.
  const galleryImages = []
  for (const sub of subs) {
    try {
      let p = await fetchHtml(sub.url)
      let $p = load(p.html)
      let visible = visibleBodyTextLength($p)
      // Menu pages always render with headless when static is thin —
      // the menu is the highest-value content for the redesign and
      // it's almost always JS-rendered on modern CMSes.
      const needHeadless = visible < 600 || (sub.isMenu && visible < 1500)
      const marker = sub.isMenu ? '★' : sub.isContact ? '☎' : sub.isGallery ? '📷' : ' '
      if (needHeadless) {
        try {
          const rendered = await renderHtml(sub.url)
          p = rendered
          $p = load(p.html)
          visible = visibleBodyTextLength($p)
          ;(rendered.pdfs || []).forEach((u) => networkPdfs.add(u))
          console.log(`  ${marker} ${sub.url}  rendered=${visible} chars${rendered.pdfs?.length ? `, ${rendered.pdfs.length} PDF(s)` : ''}`)
        } catch (e) {
          console.warn(`  ${marker} ${sub.url}  headless failed: ${e.message}`)
        }
      } else {
        console.log(`  ${marker} ${sub.url}  static=${visible} chars`)
      }
      pages.push({ url: p.url, $: $p, isMenu: !!sub.isMenu, isContact: !!sub.isContact, isGallery: !!sub.isGallery })
      corpora.push(`# ${p.url}\n${pageToText($p)}`)
      const pageImages = collectImages($p, p.url, logo)
      if (sub.isGallery) {
        for (const i of pageImages) if (!galleryImages.find((x) => x.src === i.src)) galleryImages.push(i)
      }
      for (const i of pageImages) if (!images.find((x) => x.src === i.src)) images.push(i)
    } catch (e) { console.warn(`  ! ${sub.url}: ${e.message}`) }
  }

  // PDF menus — discover via (a) <a href*=.pdf> on crawled pages and
  // (b) any PDF the headless browser saw the live page load (this is
  // how we catch Wix/Squarespace menus embedded in Adobe DC viewers).
  // Network-intercepted PDFs win the priority order — they're what
  // the LIVE site uses, not stale links.
  const linkedPdfs = discoverPdfs(pages, home.url)
  const pdfUrls = [...networkPdfs, ...linkedPdfs.filter((u) => !networkPdfs.has(u))]
  const pdfDocs = []
  if (pdfUrls.length) {
    console.log(`→ ${pdfUrls.length} PDF(s) found`)
    for (const pdf of pdfUrls.slice(0, 2)) {
      try {
        const { text, base64 } = await fetchPdf(pdf)
        if (text) corpora.push(`# ${pdf} (PDF)\n${text.slice(0, 20000)}`)
        pdfDocs.push({ url: pdf, base64, title: pdf.split('/').pop() })
        console.log(`  ✓ ${pdf} (${text.length} chars text, ${(base64.length * 3 / 4 / 1024).toFixed(0)}KB pdf)`)
      } catch (e) { console.warn(`  ! ${pdf}: ${e.message}`) }
    }
  }

  const sourceText = corpora.join('\n\n').slice(0, 120000)

  console.log(`→ designer (${ANTHROPIC_MODEL}, ~${Math.round(sourceText.length / 4)} tokens in${pdfDocs.length ? ` + ${pdfDocs.length} PDF doc(s)` : ''})…`)
  const t0 = Date.now()
  const { html: rawHtml, menu: rawMenu, notes, usage } = await askClaude({ sourceUrl: target, sourceText, logoUrl: logo, images, palette, themeColor }, pdfDocs)
  console.log(`  ${Math.round((Date.now() - t0) / 1000)}s · ${usage.input_tokens || 0} in / ${usage.output_tokens || 0} out`)
  if (notes) console.log(`  notes: ${notes}`)

  // 100% verifiable menu — drop anything Claude wrote that isn't in
  // the source text/PDF. This is the hard guarantee.
  const { menu, dropped } = gateMenu(rawMenu || [], sourceText)
  const menuHtml = renderMenuHtml(menu)
  // Defensive CSS reset — guards against Claude bugs (forgotten dot
  // on a class selector, missing logo-size cap, etc.) that would
  // make raw images render at their native CDN size.
  const SAFETY_CSS = `
  /* @rewamp safety reset — applied after Claude's CSS */
  header img, nav img, .nav-logo img, .brand img, .logo img, .site-logo img { max-height: 72px !important; width: auto !important; }
  img { max-width: 100%; height: auto; }
  body, html { overflow-x: hidden; }
`
  let html = rawHtml.includes('<!-- @MENU -->')
    ? rawHtml.replace('<!-- @MENU -->', menuHtml)
    : rawHtml.replace(/<\/body>/i, menuHtml + '\n</body>')
  // Append safety CSS just before </head> (after any Claude-provided <style>).
  html = html.replace(/<\/head>/i, `<style>${SAFETY_CSS}</style>\n</head>`)

  const slug = hostSlug(target)
  const outPath = `/tmp/preview-${slug}.html`
  writeFileSync(outPath, html, 'utf8')

  const totalIn = (rawMenu || []).reduce((n, c) => n + (c.items?.length || 0), 0)
  const totalKept = menu.reduce((n, c) => n + c.items.length, 0)
  console.log(`  menu: ${totalKept}/${totalIn} dishes verified (${dropped.length} dropped)`)
  if (dropped.length) {
    for (const d of dropped.slice(0, 5)) console.log(`    ✗ ${d.category} → ${d.name} (${d.reason})`)
    if (dropped.length > 5) console.log(`    … +${dropped.length - 5} more`)
  }

  // Lighter fact-check on the final HTML for residual claims.
  const verify = factCheck(html, sourceText)
  const fmt = (k) => {
    const o = verify[k]
    const total = o.ok.length + o.bad.length
    return `${o.ok.length}/${total}${o.bad.length ? ` ✗ ${o.bad.slice(0, 3).join(', ')}${o.bad.length > 3 ? '…' : ''}` : ''}`
  }
  console.log(`  fact-check:`)
  console.log(`    prices    ${fmt('prices')}`)
  console.log(`    phones    ${fmt('phones')}`)
  console.log(`    addresses ${fmt('addresses')}`)

  // Structured contact metadata (address, phone, email, hours) — the
  // diner's ContactView / ReservationView read these as separate config
  // fields, not from home_html. Extract from JSON-LD + meta + visible
  // tel:/mailto: links.
  const structured = extractStructured(pages, home.url)
  console.log(`→ structured contact:`)
  console.log(`  name    ${structured.name ? '✓ ' + structured.name : '✗'}${structured.source.name ? `   ← ${structured.source.name}` : ''}`)
  console.log(`  address ${structured.address ? '✓ ' + structured.address : '✗'}${structured.source.address ? `   ← ${structured.source.address}` : ''}`)
  console.log(`  phone   ${structured.phone ? '✓ ' + structured.phone : '✗'}${structured.source.phone ? `   ← ${structured.source.phone}` : ''}`)
  console.log(`  email   ${structured.email ? '✓ ' + structured.email : '✗'}${structured.source.email ? `   ← ${structured.source.email}` : ''}`)
  console.log(`  hours   ${structured.hours.length ? '✓ ' + structured.hours.length + ' row(s)' : '✗'}${structured.source.hours ? `   ← ${structured.source.hours}` : ''}`)
  for (const h of structured.hours) console.log(`            • ${h.days}: ${h.time}`)

  // Write a small sidecar JSON with the report so the index can read it.
  // Picker gallery: prefer images discovered on a flagged gallery page
  // (sub.isGallery), then top up from generic images (home / about /
  // contact) until we hit 10. Logo is excluded so it doesn't appear
  // as a candidate event image.
  const gallerySrcSeen = new Set()
  const pickerGallery = []
  const pushImage = (i) => {
    if (!i.src || i.src === logo) return
    if (gallerySrcSeen.has(i.src)) return
    gallerySrcSeen.add(i.src)
    pickerGallery.push({ src: i.src, caption: i.alt || '' })
  }
  for (const i of galleryImages) { if (pickerGallery.length >= 10) break; pushImage(i) }
  for (const i of images)        { if (pickerGallery.length >= 10) break; pushImage(i) }
  console.log(`  gallery picker: ${pickerGallery.length} image(s) (${galleryImages.length} from /gallery, rest from other pages)`)

  writeFileSync(outPath.replace(/\.html$/, '.report.json'), JSON.stringify({
    url: target, slug, logo, notes,
    palette, themeColor,
    structured,
    gallery: pickerGallery,
    tokens: { input: usage.input_tokens || 0, output: usage.output_tokens || 0 },
    menu_kept: totalKept, menu_dropped: dropped,
    verify
  }, null, 2), 'utf8')

  console.log(`\n✓ preview → ${outPath}`)
  if (process.env.NO_OPEN !== '1') spawnSync('open', [outPath])
}

main()
  .catch((e) => { console.error('error:', e.message); process.exitCode = 1 })
  .finally(() => closeBrowser())
