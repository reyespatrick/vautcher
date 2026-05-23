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
  hero: { eyebrow: '', title: '', lead: '' },
  about: { kicker: '', title: '', image_url: '', paragraphs: [] },
  specialties: [],
  gallery: []
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
  ]
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
    hours: c.hours ?? FALLBACK.hours,
    hero: c.hero ?? FALLBACK.hero,
    about: c.about ?? FALLBACK.about,
    specialties: c.specialties ?? FALLBACK.specialties,
    gallery: c.gallery ?? FALLBACK.gallery
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
function applyBrand(s) {
  if (typeof document === 'undefined') return
  const r = document.documentElement.style
  r.setProperty('--burgundy', s.brandPrimary)
  r.setProperty('--burgundy-dark', s.brandDark)
}

const initial = loadCached() || FALLBACK
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
