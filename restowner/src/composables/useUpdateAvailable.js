// useUpdateAvailable.js — polls the server's index.html, compares the
// JS bundle hash baked into our <script> tag against the one in the
// fresh HTML, and exposes a flag the app can bind to a "Nouvelle
// version disponible -- Recharger" banner.
//
// Why this is needed: iOS standalone PWAs cache the start_url snapshot
// and only refresh it when the app is fully killed from the App
// Switcher. Cloudflare Pages already sends `cache-control: no-store`
// on the HTML, but the OS layer ignores that. Polling /index.html in
// the background side-steps the OS cache and lets us detect a new
// bundle even when the launch HTML is stale.
//
// Cost is tiny: index.html is ~1 KB, gzipped <600 bytes, fetched at
// most every 5 minutes + on visibility-change + on mount.
import { ref, onMounted, onBeforeUnmount } from 'vue'

const POLL_INTERVAL_MS = 5 * 60 * 1000  // five minutes
const ASSET_RE = /\/assets\/index-([A-Za-z0-9_-]+)\.js/

function readLocalBundleId() {
  // The running app was loaded by its own <script> tag -- read that
  // back to know which bundle we are.
  const script = document.querySelector('script[type="module"][src*="/assets/index-"]')
  if (!script) return null
  const m = String(script.src || '').match(ASSET_RE)
  return m ? m[1] : null
}

async function readServerBundleId() {
  try {
    const res = await fetch('/index.html?' + Date.now(), { cache: 'no-store' })
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(ASSET_RE)
    return m ? m[1] : null
  } catch {
    return null
  }
}

export function useUpdateAvailable() {
  const available = ref(false)
  const localId = readLocalBundleId()
  let timer = null
  let checking = false

  async function check() {
    if (checking || available.value) return
    checking = true
    try {
      const remoteId = await readServerBundleId()
      if (localId && remoteId && remoteId !== localId) {
        available.value = true
      }
    } finally {
      checking = false
    }
  }

  function onVisibilityChange() {
    if (!document.hidden) check()
  }

  function reload() {
    // Hard reload bypasses memory + bfcache. PWAs that ignore HTML
    // cache-control headers still pick up the new index.html on a
    // location.reload because the navigation goes through the network
    // stack, not the snapshot.
    try { window.location.reload() } catch { /* no-op */ }
  }

  onMounted(() => {
    // First check immediately so an already-deployed update surfaces
    // as soon as the app boots on a stale snapshot.
    check()
    timer = setInterval(check, POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  onBeforeUnmount(() => {
    if (timer) { clearInterval(timer); timer = null }
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { available, reload }
}
