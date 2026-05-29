const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** 'YYYY-MM-DD' -> '13 juin 2026' */
export function formatDate(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`
}

/** Today as 'YYYY-MM-DD'. */
export function today() {
  return new Date().toISOString().split('T')[0]
}

/**
 * Event price in Swiss notation. A bare integer like "25" becomes "25.-";
 * anything that already carries other characters ("25.50", "dès 25",
 * "Gratuit", "25 CHF") is left as-is.
 */
export function formatPrice(p) {
  if (p == null) return ''
  const s = String(p).trim()
  return /^\d+$/.test(s) ? `${s}.-` : s
}

/** Human label for an event's age targeting. */
export function ageLabel(ev) {
  if (ev.age_min && ev.age_max) return `${ev.age_min}–${ev.age_max} ans`
  if (ev.age_min) return `${ev.age_min} ans et +`
  if (ev.age_max) return `jusqu'à ${ev.age_max} ans`
  return 'Tous âges'
}
