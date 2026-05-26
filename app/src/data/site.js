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
  logoUrl: '/assets/logo.jpg',
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
    gallery: c.gallery ?? FALLBACK.gallery,
    sections: c.sections ?? FALLBACK.sections,
    // Which home template to render. Owner-selected via restowner.
    // 'classic' = the original Rufina-serif, burgundy, vertical layout.
    // 'modern'  = full-bleed editorial design (work in progress).
    // Per-tenant; overridable at runtime via ?preview=<name> for demos.
    template: c.template ?? 'classic'
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
  r.setProperty('--burgundy', s.brandPrimary)
  r.setProperty('--burgundy-dark', s.brandDark)

  applyHeadingFont(s)
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
