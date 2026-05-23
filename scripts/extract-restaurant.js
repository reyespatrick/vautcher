#!/usr/bin/env node
// Extracts a restaurant's identity + content from its public website
// into a vautcher_restaurants.config payload.
//
// Pulls from (in order of preference):
//   1. JSON-LD (schema.org Restaurant / LocalBusiness / FoodEstablishment)
//   2. OpenGraph meta tags
//   3. Light text/regex heuristics for phone & address
//
// Usage:
//   cd scripts && npm install
//   node extract-restaurant.js https://example.com
//   node extract-restaurant.js https://example.com --out extracted.json
//
// Paste the resulting JSON into restowner's Restaurant config editor
// ("Importer JSON" section) to apply.
import { load } from 'cheerio'
import { writeFile } from 'fs/promises'

const args = process.argv.slice(2)
let url = null
let outFile = null
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--out') outFile = args[++i]
  else if (a.startsWith('--out=')) outFile = a.slice(6)
  else if (!url) url = a
}
if (!url) {
  console.error('usage: node extract-restaurant.js <url> [--out file]')
  process.exit(1)
}

async function fetchHtml(u) {
  const res = await fetch(u, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; vautcher-extractor/1.0)' }
  })
  if (!res.ok) throw new Error(`fetch ${u} → ${res.status}`)
  return await res.text()
}

const html = await fetchHtml(url)
const $ = load(html)

// ---------- JSON-LD ----------
function collectJsonLd() {
  const blobs = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text())
      const list = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of list) {
        if (item['@graph']) blobs.push(...item['@graph'])
        else blobs.push(item)
      }
    } catch { /* ignore malformed JSON-LD */ }
  })
  return blobs
}

function findByType(blobs, types) {
  for (const b of blobs) {
    const t = b['@type']
    const has = Array.isArray(t) ? t.some((x) => types.includes(x)) : types.includes(t)
    if (has) return b
  }
  return null
}

const ld = collectJsonLd()
const r = findByType(ld, ['Restaurant', 'FoodEstablishment', 'LocalBusiness']) || {}

// ---------- meta ----------
const meta = (name, attr = 'name') =>
  $(`meta[${attr}="${name}"]`).attr('content') || null

const og = {
  title: meta('og:title', 'property'),
  description: meta('og:description', 'property'),
  image: meta('og:image', 'property'),
  site_name: meta('og:site_name', 'property')
}
const themeColor = meta('theme-color')

// ---------- logo ----------
function pickLogo() {
  if (r.logo) return typeof r.logo === 'string' ? r.logo : (r.logo.url || null)
  const icons = $('link[rel*="icon"]').toArray()
    .map((el) => ({ href: $(el).attr('href'), sizes: $(el).attr('sizes') || '' }))
    .filter((i) => i.href)
  icons.sort((a, b) => {
    const az = parseInt((a.sizes.match(/\d+/) || ['0'])[0], 10)
    const bz = parseInt((b.sizes.match(/\d+/) || ['0'])[0], 10)
    return bz - az
  })
  if (icons[0]) {
    try { return new URL(icons[0].href, url).href } catch { return icons[0].href }
  }
  return og.image || null
}

// ---------- heuristics for missing fields ----------
function fallbackPhone() {
  const re = /(?:\+|00)\s?\d{1,3}[\s.\-]?(?:\(?\d{2,3}\)?[\s.\-]?){2,4}\d{2,4}/g
  const m = html.match(re)
  if (!m) return null
  // Reject matches with no separator — usually false positives like
  // long digit sequences in social-media handles or IDs.
  const valid = m.find((s) => /[\s.\-]/.test(s))
  return valid ? valid.replace(/\s+/g, ' ').trim() : null
}
function fallbackAddress() {
  const re = /[A-ZÀ-Ž][\wÀ-ž'\-\s]{3,60},?\s+\d{4,5}\s+[A-ZÀ-Ž][\wÀ-ž'\-]{2,30}/
  const m = html.match(re)
  return m ? m[0].replace(/\s+/g, ' ').trim() : null
}

// ---------- hours ----------
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

// ---------- page-level text fallbacks ----------
const pageTitle = ($('title').first().text() || '').trim()
const firstH1 = ($('h1').first().text() || '').trim()
const firstH2 = ($('h2').first().text() || '').trim()
const metaDesc = meta('description') || ''

// ---------- build the payload ----------
const phone = r.telephone || fallbackPhone()
const address = addressString()
const name = r.name || og.title || og.site_name || pageTitle || firstH1 || ''
const description = og.description || r.description || metaDesc || firstH2 || firstH1 || ''

const config = {
  tagline: og.description || metaDesc || firstH2 || null,
  address,
  phone,
  phone_href: phone ? 'tel:' + phone.replace(/[^\d+]/g, '') : null,
  email: r.email || null,
  maps_href: r.hasMap ||
    (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null),
  logo_url: pickLogo(),
  brand_primary: themeColor || '#9e053d',
  brand_dark: '#6f032b',
  theme_color: themeColor || '#9e053d',
  pwa_name: name,
  pwa_short_name: name,
  pwa_description: description || null,
  tagline_alt: firstH2 || null,
  hours: pickHours(),
  hero: {
    eyebrow: (r.address && r.address.addressLocality) || null,
    title: firstH1 || og.title || name || '',
    lead: description
  },
  about: {
    kicker: 'Notre maison',
    title: name,
    image_url: og.image || null,
    paragraphs: description ? [description] : []
  },
  specialties: [],
  gallery: og.image ? [{ src: og.image, caption: '' }] : []
}

const payload = { name, slug: null, config }

const json = JSON.stringify(payload, null, 2)
if (outFile) {
  await writeFile(outFile, json)
  console.error(`→ wrote ${outFile}`)
} else {
  console.log(json)
}
