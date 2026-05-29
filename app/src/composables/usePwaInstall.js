// PWA install helper. Module-level listeners are registered on first import
// so the beforeinstallprompt event — which fires once, early — isn't missed.
import { ref } from 'vue'

const deferred = ref(null)   // captured beforeinstallprompt event (Android/Chrome)
const installed = ref(false)

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred.value = e
})
window.addEventListener('appinstalled', () => {
  installed.value = true
  deferred.value = null
})

function detectPlatform() {
  const ua = navigator.userAgent || ''
  const iOS = /iphone|ipad|ipod/i.test(ua) ||
    (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)
  const android = /android/i.test(ua)
  return { iOS, android, desktop: !iOS && !android }
}

function isStandalone() {
  return (typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
     window.navigator.standalone === true))
}

export function usePwaInstall() {
  async function install() {
    if (!deferred.value) return { outcome: 'unavailable' }
    deferred.value.prompt()
    const choice = await deferred.value.userChoice
    if (choice.outcome === 'accepted') deferred.value = null
    return choice
  }

  return {
    deferred,
    installed,
    install,
    platform: detectPlatform(),
    standalone: isStandalone()
  }
}
