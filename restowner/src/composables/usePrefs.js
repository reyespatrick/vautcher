// UI preferences — text size + language.
// Persisted to localStorage (instant, offline) and to the server
// (vautcher_owners.pref_*) so they follow the owner across devices.
import { ref, watch } from 'vue'
import { i18n } from '../i18n'
import { supabase } from '../lib/supabase'

const LS_KEY = 'restowner.prefs'
const LOCALES = ['fr', 'de', 'it']
const MIN = 0.8
const MAX = 1.6
const STEP = 0.2

function clamp(v) {
  v = Number(v) || 1
  return Math.min(MAX, Math.max(MIN, Math.round(v * 100) / 100))
}

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} }
  catch { return {} }
}
const initial = loadLocal()

// Shared singleton state.
export const fontScale = ref(clamp(initial.fontScale || 1))
export const locale = ref(LOCALES.includes(initial.locale) ? initial.locale : 'fr')
i18n.global.locale.value = locale.value

let ownerEmail = null

function persistLocal() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      fontScale: fontScale.value, locale: locale.value
    }))
  } catch { /* storage unavailable */ }
}

async function persistServer() {
  if (!ownerEmail || !supabase) return
  // Best effort — relies on the owner self-update RLS policy.
  await supabase.from('vautcher_owners')
    .update({ pref_lang: locale.value, pref_font_scale: fontScale.value })
    .eq('email', ownerEmail)
    .then(() => {}, () => {})
}

watch([fontScale, locale], () => {
  i18n.global.locale.value = locale.value
  persistLocal()
  persistServer()
})

export function useUiPrefs() {
  function larger() { fontScale.value = clamp(fontScale.value + STEP) }
  function smaller() { fontScale.value = clamp(fontScale.value - STEP) }
  function resetSize() { fontScale.value = 1 }
  function setLocale(l) { if (LOCALES.includes(l)) locale.value = l }

  // Called once the owner row is known — server prefs become the source
  // of truth (they follow the owner across devices).
  function hydrateFromOwner(owner) {
    if (!owner) return
    ownerEmail = owner.email || null
    if (LOCALES.includes(owner.pref_lang)) locale.value = owner.pref_lang
    if (owner.pref_font_scale) fontScale.value = clamp(owner.pref_font_scale)
  }

  return { fontScale, locale, larger, smaller, resetSize, setLocale, hydrateFromOwner }
}
