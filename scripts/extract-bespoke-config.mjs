#!/usr/bin/env node
// Take an already-generated preview HTML (e.g. /tmp/preview-<host>.html)
// and split it into the pieces the Vue diner needs to render a tenant:
//
//   home_html:        the bespoke <body> markup with Claude's nav/header
//                     stripped, ready to drop into HomeView via v-html.
//   home_css:         Claude's <style> contents, with every selector
//                     scoped under .bespoke-home so they can't leak
//                     into the diner's shared shell.
//   google_fonts_url: the Google Fonts <link href> Claude requested
//                     (Vue diner injects this on mount).
//   theme:            { primary, primary_dark, ink, paper, font_display,
//                       font_body, font_menu } — pulled from the CSS so
//                       AppHeader/AppFooter/EventsView etc. can theme.
//
// Usage:
//   node extract-bespoke-config.mjs /tmp/preview-pavillonversoix.ch.html > /tmp/pavillon-bespoke.json
//
// No API calls. Pure local transform from an existing preview.

import { load } from 'cheerio'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import postcss from 'postcss'
import prefixer from 'postcss-prefix-selector'

const SCOPE = '.bespoke-home'

const path = process.argv[2]
if (!path) { console.error('usage: node extract-bespoke-config.mjs <preview.html>'); process.exit(1) }
const outPath = process.argv[3] || null

const html = readFileSync(path, 'utf8')
const $ = load(html)

// 0) Sidecar report.json (sibling .report.json file from website-rewamp.mjs)
// carries the source logo URL, source palette, and source URL — facts
// the diner shell needs that the bespoke HTML alone doesn't expose
// cleanly. Optional: empty fields fall back to nulls.
const reportPath = path.replace(/\.html$/, '.report.json')
let report = {}
if (existsSync(reportPath)) {
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')) } catch {/* ignore */}
}

// 1) Google Fonts URLs ------------------------------------------------------
const googleFonts = []
$('link[rel="stylesheet"]').each((_, el) => {
  const href = $(el).attr('href') || ''
  if (/fonts\.googleapis\.com/.test(href)) googleFonts.push(href)
})

// 2) <style> blob -----------------------------------------------------------
let css = ''
$('style').each((_, el) => { css += $(el).text() + '\n' })

// 3) Drop nav/header chrome Claude built — the diner provides its own.
//    Most previews put it as <nav>, sometimes wrapped in <header class="hero">
//    style stuff. We only strip top-level <nav> and obvious top bars.
$('nav, header.top, .top-nav, .site-nav, .sticky-nav, .navbar').remove()

// 4) Body content ----------------------------------------------------------
// Take everything inside <body> EXCEPT the <style> tags (we extract those
// to home_css separately) and the noscript shims.
$('script, noscript').remove()
$('style').remove()
const bodyInner = $('body').html() || ''

// 5) Theme tokens (best-effort regex sniff of CSS custom-properties) -------
// Read Claude's CSS custom properties — they're the ground truth for
// what HE considers "the brand colour".
function findVar(...names) {
  for (const name of names) {
    const re = new RegExp('--' + name + '\\s*:\\s*([^;}]+)\\s*[;}]', 'i')
    const m = css.match(re); if (m) return m[1].trim()
  }
  return null
}
function isNeutral(hex) {
  const m = (hex || '').match(/^#([0-9a-f]{6})$/i); if (!m) return true
  const h = m[1]
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max < 30 || min > 235 || max - min < 18) return true
  return false
}
// Brand variable. Try common names Claude uses.
const primary = findVar('primary', 'brand', 'accent', 'brick', 'burgundy', 'blue', 'green', 'red', 'gold', 'dark', 'main')
  || (() => {
    // Frequency fallback among non-neutral hex values.
    const counts = (css.match(/#[0-9a-f]{6}\b/gi) || []).reduce((m, h) => { const k = h.toLowerCase(); m[k] = (m[k] || 0) + 1; return m }, {})
    return Object.entries(counts).filter(([h]) => !isNeutral(h)).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  })()
const primaryDark = findVar('primary-dark', 'brand-dark', 'brick-deep', 'burgundy-dark', 'blue-deep', 'blue-dark', 'green-deep', 'red-deep', 'dark-deep')

// Font families — read the first font-family declaration of the largest
// "display" element (h1, .hero h1, .display) and of body.
function findFont(selectors) {
  for (const sel of selectors) {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^}]*font-family\\s*:\\s*([^;}]+)', 'i')
    const m = css.match(re); if (m) return m[1].trim().replace(/^['"]/, '').replace(/['",].*$/, '')
  }
  return null
}
const fontDisplay = findFont(['h1', '.hero h1', '.display', '.rw-display', 'h1,', 'h1{', 'h1 ', '.hero-title', '.brand'])
const fontBody = findFont(['body', '.body'])
// menu font heuristic: look for .rw-dish-name or .menu-item-name
const fontMenu = findFont(['.rw-dish-name', '.menu-item-name', '.dish-name', '.menu-item'])

// 6) Scope the CSS under .bespoke-home -------------------------------------
//    body / html selectors collapse to .bespoke-home itself.
const scoped = await postcss([
  prefixer({
    prefix: SCOPE,
    transform(prefix, selector, prefixedSelector) {
      // Pseudo-elements on root → attach to the wrapper.
      if (/^body\b/.test(selector)) return selector.replace(/^body/, prefix)
      if (/^html\b/.test(selector)) return selector.replace(/^html/, prefix)
      // :root → variables become root-scoped on the wrapper too.
      if (/^:root\b/.test(selector)) return selector.replace(/^:root/, prefix)
      // *::before / *::after → leave the *, scope it.
      if (selector === '*') return prefix + ' *'
      return prefixedSelector
    }
  })
]).process(css, { from: undefined })

const out = {
  source_file: path,
  home_html: bodyInner.trim(),
  home_css: scoped.css.trim(),
  google_fonts_url: googleFonts[0] || null,
  // Logo + source URL come from the sidecar report.json so they
  // survive the chrome-stripping step above.
  logo_url: report.logo || null,
  source_url: report.url || null,
  theme: { primary, primary_dark: primaryDark, font_display: fontDisplay, font_body: fontBody, font_menu: fontMenu }
}

if (outPath) {
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8')
  console.log(`wrote ${outPath}`)
} else {
  process.stdout.write(JSON.stringify(out, null, 2))
}
