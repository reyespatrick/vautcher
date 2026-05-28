import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import './composables/usePwaInstall' // registers beforeinstallprompt listener early
import './styles/main.css'

console.log('[boot] main.js: creating + mounting app')
createApp(App).use(router).use(i18n).mount('#app')
console.log('[boot] main.js: app.mount() returned')

// Block pinch / double-tap zoom for a native-app feel. iOS Safari ignores
// user-scalable=no in-browser, so guard the gesture + double-tap here.
document.addEventListener('gesturestart', (e) => e.preventDefault())
let lastTouchEnd = 0
document.addEventListener('touchend', (e) => {
  const now = Date.now()
  if (now - lastTouchEnd <= 300) e.preventDefault()
  lastTouchEnd = now
}, { passive: false })

// Register the (no-cache) service worker so the console is installable.
// Loaded after mount so it never blocks first paint.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('[pwa] service worker registration failed', e)
    })
  })
}
