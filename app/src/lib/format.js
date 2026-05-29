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
