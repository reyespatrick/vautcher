// Restaurant identity + page content for the current tenant.
//
// Used to be a hard-coded object; now reactive-loaded from Supabase
// (vautcher_restaurants.config for the tenant in VITE_RESTAURANT_ID),
// with localStorage caching so subsequent loads are instant.
//
// Views just keep `import { site, gallery } from '../data/site'` — the
// shape of `site` is identical to the old one, only its values now flow
// from the DB.
import { reactive } from 'vue'
import { fetchRestaurant, RESTAURANT_ID } from '../lib/api'
// Build-time tenant config — written by deploy-tenant.sh just before the
// build. When present (id non-empty), it's used for the first paint so
// the app shows the right tenant identity *immediately*, without the
// La-Gioconda flash. Defaults to {} (no bake), and is overwritten on
// every per-tenant deploy.
import baked from './baked.json'

const CACHE_KEY = 'restaurant.' + RESTAURANT_ID
const LA_GIOCONDA_ID = '11111111-1111-1111-1111-111111111111'

// Fallback values so the app has SOMETHING to paint before the network
// reply lands. La Gioconda gets its own seed defaults; every other tenant
// gets a generic empty fallback so we don't leak Gioconda strings while
// waiting for the DB (and on first visit before the cache exists).
const GENERIC_FALLBACK = {
  id: RESTAURANT_ID,
  name: 'Restaurant',
  slug: '',
  tagline: '',
  address: '',
  phone: '',
  phoneHref: '',
  email: '',
  mapsHref: '',
  logoUrl: '',
  brandPrimary: '#9e053d',
  brandDark: '#6f032b',
  hours: [],
  reservationSlots: [],
  hero: { eyebrow: '', title: '', lead: '' },
  about: { kicker: '', title: '', image_url: '', paragraphs: [] },
  specialties: [],
  menu: [],
  gallery: [],
  sections: []
}

const LA_GIOCONDA_FALLBACK = {
  id: RESTAURANT_ID,
  name: 'La Gioconda',
  slug: 'la-gioconda',
  tagline: 'Votre restaurant napolitain à Cointrin',
  address: 'Avenue Louis-Casaï 81, 1216 Cointrin',
  phone: '+41 22 798 96 05',
  phoneHref: 'tel:+41227989605',
  email: 'nicola.cassella@gmail.com',
  mapsHref: 'https://www.google.com/maps/search/?api=1&query=Avenue+Louis-Casa%C3%AF+81+1216+Cointrin',
  logoUrl: '/assets/logo.jpg',
  brandPrimary: '#9e053d',
  brandDark: '#6f032b',
  hours: [
    { days: 'Lundi – Dimanche', service: 'Midi', time: '11h30 – 14h00' },
    { days: 'Lundi – Dimanche', service: 'Soir', time: '18h30 – 23h30' }
  ],
  reservationSlots: [
    '11:30', '12:00', '12:30', '13:00', '13:30',
    '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'
  ],
  hero: {
    eyebrow: 'Cointrin · Genève',
    title: 'Une part de Naples au cœur de Genève',
    lead: 'Votre restaurant napolitain à Cointrin — cuisine italienne authentique, pâtes fraîches et pizzas au feu de bois.'
  },
  about: {
    kicker: 'Notre Maison',
    title: 'Bienvenue à La Gioconda',
    image_url: '/assets/photo1.jpg',
    paragraphs: [
      'Située à Cointrin, notre maison représente une véritable part de Naples au sein de Genève. Dans un cadre chaleureux et lumineux, nous vous accueillons midi et soir, 7 jours sur 7.',
      'Produits frais, recettes traditionnelles et accueil familial : chaque assiette est préparée avec passion.'
    ]
  },
  specialties: [
    { icon: '🧀', title: 'Risotto à la meule', text: 'Préparé et flambé en salle dans une meule de parmesan.' },
    { icon: '🍝', title: 'Pâtes fraîches', text: 'Préparées à la commande, dans la tradition artisanale.' },
    { icon: '🍷', title: 'Vins d’Italie', text: 'Une sélection pour accompagner et sublimer chaque plat.' }
  ],
  gallery: [
    { src: '/assets/photo1.jpg', caption: 'La salle vitrée' },
    { src: '/assets/photo2.jpg', caption: 'Le bar' },
    { src: '/assets/photo3.jpg', caption: 'La terrasse' },
    { src: '/assets/photo4.jpg', caption: 'Da Vinci, bar à vin' }
  ],
  sections: []
}

const FALLBACK = RESTAURANT_ID === LA_GIOCONDA_ID
  ? LA_GIOCONDA_FALLBACK
  : GENERIC_FALLBACK

// Convert a { id, name, slug, config:{...} } RPC payload (snake_case in
// `config`) into the flat camelCase shape the views consume.
function flatten(payload) {
  const c = payload?.config || {}
  return {
    id: payload?.id ?? FALLBACK.id,
    name: payload?.name ?? FALLBACK.name,
    slug: payload?.slug ?? FALLBACK.slug,
    tagline: c.tagline ?? FALLBACK.tagline,
    address: c.address ?? FALLBACK.address,
    phone: c.phone ?? FALLBACK.phone,
    phoneHref: c.phone_href ?? FALLBACK.phoneHref,
    email: c.email ?? FALLBACK.email,
    mapsHref: c.maps_href ?? FALLBACK.mapsHref,
    logoUrl: c.logo_url ?? FALLBACK.logoUrl,
    brandPrimary: c.brand_primary ?? FALLBACK.brandPrimary,
    brandDark: c.brand_dark ?? FALLBACK.brandDark,
    headingFont: c.heading_font ?? null,
    googleFontsFamilies: c.google_fonts_families ?? [],
    hours: c.hours ?? FALLBACK.hours,
    reservationSlots: c.reservation_slots ?? FALLBACK.reservationSlots,
    hero: c.hero ?? FALLBACK.hero,
    about: c.about ?? FALLBACK.about,
    specialties: c.specialties ?? FALLBACK.specialties,
    menu: c.menu ?? FALLBACK.menu ?? [],
    // Moderator kill-switch for a badly-recognised scaffolded menu.
    hideMenu: c.hide_menu ?? false,
    gallery: c.gallery ?? FALLBACK.gallery,
    sections: c.sections ?? FALLBACK.sections,
    // Which home template to render. Owner-selected via restowner.
    // 'classic' = the original Rufina-serif, burgundy, vertical layout.
    // 'modern'  = full-bleed editorial design (work in progress).
    // Per-tenant; overridable at runtime via ?preview=<name> for demos.
    template: c.template ?? 'classic',
    // Bespoke home (AI-designed shell). When present, HomeView renders
    // home_html via v-html instead of the Vue Classic/Modern layouts.
    // home_css is Claude's <style> already scoped under .bespoke-home
    // so it can't leak into the shared header/footer/other views.
    homeHtml: c.home_html ?? null,
    homeCss: c.home_css ?? null,
    googleFontsUrl: c.google_fonts_url ?? null,
    // Extended theme tokens — feed the shared shell (AppHeader,
    // AppFooter, EventsView, VoucherView, ReservationView, LoginView)
    // so they match the bespoke home's identity.
    theme: c.theme ?? null
  }
}

function loadCached() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// Push brand tokens onto :root so the existing stylesheets (which use
// --burgundy etc.) pick up the tenant's colors without any view change.
// Also injects the tenant's Google Fonts (link + h1-h4 override) when
// the scaffolder captured a heading family.
function applyBrand(s) {
  if (typeof document === 'undefined') return
  const r = document.documentElement.style
  // Primary brand colour — keep --burgundy alias for legacy stylesheets,
  // expose --primary as the canonical name going forward.
  const primary = s.theme?.primary || s.brandPrimary
  const primaryDark = s.theme?.primary_dark || s.brandDark
  if (primary) { r.setProperty('--burgundy', primary); r.setProperty('--primary', primary) }
  if (primaryDark) { r.setProperty('--burgundy-dark', primaryDark); r.setProperty('--primary-dark', primaryDark) }
  // Bespoke fonts → CSS vars for all shared shell views to inherit.
  if (s.theme?.font_display) r.setProperty('--font-display', `'${s.theme.font_display}'`)
  if (s.theme?.font_body) r.setProperty('--font-body', `'${s.theme.font_body}'`)
  if (s.theme?.font_menu) r.setProperty('--font-menu', `'${s.theme.font_menu}'`)

  applyHeadingFont(s)
  applyBespokeAssets(s)
}

// Inject Claude's full Google-Fonts <link> (preferred) and the bespoke
// home <style> blob. Idempotent — replaced on each tenant refresh.
function applyBespokeAssets(s) {
  if (typeof document === 'undefined') return

  // Google Fonts <link> from the bespoke scaffold. Falls back to the
  // older per-family applyHeadingFont logic when home_html isn't set.
  if (s.googleFontsUrl) {
    const id = 'vautcher-bespoke-fonts'
    document.getElementById(id)?.remove()
    const link = document.createElement('link')
    link.id = id; link.rel = 'stylesheet'; link.href = s.googleFontsUrl
    document.head.appendChild(link)
  }

  // Scoped home CSS — already prefixed under .bespoke-home by the
  // extractor, so safe to insert at the end of <head>.
  if (s.homeCss) {
    const id = 'vautcher-bespoke-home-css'
    document.getElementById(id)?.remove()
    const style = document.createElement('style')
    style.id = id; style.textContent = s.homeCss
    document.head.appendChild(style)
  }

  // Menu kill-switch: hide the scaffolded menu section (+ any in-page
  // "see the menu" links) when the moderator flagged its recognition as
  // bad. Reapplied on every refresh, so toggling in restowner reflects
  // on the next load without a redeploy.
  const hideId = 'vautcher-hide-menu'
  document.getElementById(hideId)?.remove()
  if (s.hideMenu) {
    const style = document.createElement('style')
    style.id = hideId
    style.textContent = '.bespoke-home .rw-menu, .bespoke-home #menu, .bespoke-home a[href$="#menu"] { display: none !important; }'
    document.head.appendChild(style)
  }
}

let appliedFontFamily = null
function applyHeadingFont(s) {
  const family = s.headingFont
  if (!family || family === appliedFontFamily) return
  appliedFontFamily = family

  // 1. Add a stylesheet <link> pointing at fonts.googleapis.com for
  //    every captured family. Idempotent — replaced on each call.
  const linkId = 'vautcher-google-fonts'
  document.getElementById(linkId)?.remove()
  const families = (s.googleFontsFamilies && s.googleFontsFamilies.length)
    ? s.googleFontsFamilies
    : [family]
  const familyQs = families
    .map((f) => 'family=' + encodeURIComponent(f).replace(/%20/g, '+'))
    .join('&')
  const link = document.createElement('link')
  link.id = linkId
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?${familyQs}&display=swap`
  document.head.appendChild(link)

  // 2. Override h1-h4 font-family. Keep Rufina as a fallback so
  //    page styling stays sane while the webfont is loading.
  const styleId = 'vautcher-heading-font'
  document.getElementById(styleId)?.remove()
  const style = document.createElement('style')
  style.id = styleId
  // Quote family names that contain spaces.
  const cssFamily = /\s/.test(family) ? `"${family}"` : family
  style.textContent = `
    h1, h2, h3, h4, .sb-h2, .sb-h3, .brand-txt {
      font-family: ${cssFamily}, 'Rufina', Georgia, serif;
    }
  `
  document.head.appendChild(style)
}

// Priority for the first paint:
//   1. localStorage cache (the most recent DB fetch this device has done)
//   2. The build-baked config (point-in-time of the last deploy)
//   3. FALLBACK (La-Gioconda defaults for La Gioconda, generic empties
//      for any other tenant)
const bakedInitial = baked && baked.id ? flatten(baked) : null
const initial = loadCached() || bakedInitial || FALLBACK
export const site = reactive(initial)
export const gallery = reactive(initial.gallery || [])
applyBrand(initial)

// Refresh from the DB in the background — no await so the app paints
// immediately from cache/fallback. The reactive mutations propagate to
// any view that's already rendered.
fetchRestaurant().then((payload) => {
  if (!payload) return
  const fresh = flatten(payload)
  Object.assign(site, fresh)
  gallery.splice(0, gallery.length, ...(fresh.gallery || []))
  applyBrand(fresh)
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(fresh)) } catch { /* ignore */ }
}).catch(() => { /* keep cached/default */ })
