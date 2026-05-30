// usePullToRefresh — touch-driven pull-to-refresh for restowner pages.
//
// The page is scrolled inside .viewport (see App.vue / main.css). When
// the user is already at scrollTop=0 and starts pulling down we treat
// it as a pull gesture: the page distance follows the finger with a
// 1.8x rubber-band, capped at 110px. On release past 70px we call the
// page's load function. The composable returns reactive `pullDistance`
// and `refreshing` refs the page can bind to a small indicator at the
// top so the user knows the gesture is being tracked.
//
// Skip this composable on pages that already auto-refresh (polling,
// SW cache invalidation) -- redundant pulls aren't harmful but they
// duplicate the network request the page is already making.
import { onMounted, onBeforeUnmount, ref } from 'vue'

const DEFAULT_SCROLL_SELECTOR = '.viewport'

// Debug toggle. Enable with one of:
//   - localStorage.setItem('ptr_debug', '1')
//   - URL ?ptr_debug=1 (also persisted to localStorage)
// When on, every gesture event is console.log'd AND the visible
// PullToRefreshDebug widget rendered in App.vue reads its state from
// a window-level publishing channel below.
let DEBUG = false
// Kill-switch -- when enabled the composable becomes a no-op: no
// listeners attached, no state ever flips. Diagnostic: if a mystery
// spinner is still visible with this on, it is NOT coming from the
// pull-to-refresh path. Toggle with ?ptr_off=1 / localStorage 'ptr_off'.
let DISABLED = false
try {
  const url = new URL(window.location.href)
  if (url.searchParams.get('ptr_debug') === '1') {
    localStorage.setItem('ptr_debug', '1')
  }
  if (url.searchParams.get('ptr_off') === '1') {
    localStorage.setItem('ptr_off', '1')
  }
  DEBUG = localStorage.getItem('ptr_debug') === '1'
  DISABLED = localStorage.getItem('ptr_off') === '1'
} catch { /* no localStorage in some embedded contexts */ }

function dbg(label, payload) {
  if (!DEBUG) return
  // Lightweight ring buffer so the on-screen widget can show the
  // last few events without pulling them from console.
  const w = window
  if (!w.__ptrLog) w.__ptrLog = []
  const line = { t: new Date().toISOString().slice(11, 23), label, ...payload }
  w.__ptrLog.push(line)
  if (w.__ptrLog.length > 12) w.__ptrLog.shift()
  // Tell anyone listening (PullToRefreshDebug) that the log changed.
  w.dispatchEvent(new CustomEvent('ptr-log'))
  console.log('[ptr]', label, payload)
}

export const PTR_DEBUG_ENABLED = DEBUG
const THRESHOLD = 70        // px pulled to trigger refresh
const MAX_PULL = 110        // hard cap, gives nice rubber-band feel
const RESISTANCE = 1.8      // divide finger distance by this for the visual pull
const MIN_MOVE = 18         // px of finger travel before we start showing the indicator,
                            // filters iOS overscroll/momentum twitches that otherwise
                            // light the spinner up the moment the page loads

export function usePullToRefresh(onRefresh, scrollSelector = DEFAULT_SCROLL_SELECTOR) {
  const pullDistance = ref(0)
  const refreshing = ref(false)
  // Hard invariant: indicator may render ONLY while the finger is down
  // (pulling) or a refresh is in flight (refreshing). Both default to
  // false on construction, so first paint can never surface the
  // spinner -- the v-if in the indicator binds on these refs.
  const pulling = ref(false)
  // Gates the indicator off during the synchronous first paint -- iOS
  // sometimes fires a touchmove during route transition before our
  // composable has even seen its onMounted, and the indicator would
  // briefly render in the page-head gap.
  const ready = ref(false)
  let startY = 0
  let target = null
  // Movement watchdog -- iOS Safari (not standalone PWA) can hijack
  // the touch sequence for its own URL-bar pull-to-refresh, so our
  // touchend never fires and pulling.value stays true with the
  // indicator stuck visible. If no touchmove arrives for 1.2s while
  // pulling is true, force a reset.
  let lastMoveAt = 0
  let watchdog = null

  function onTouchStart(e) {
    if (refreshing.value || !target) {
      dbg('touchstart-skip', { reason: refreshing.value ? 'refreshing' : 'no-target' })
      return
    }
    if (target.scrollTop > 0) {
      dbg('touchstart-skip', { reason: 'scrolled', scrollTop: target.scrollTop })
      return
    }
    if (!e.touches || !e.touches.length) return
    startY = e.touches[0].clientY
    lastMoveAt = Date.now()
    pulling.value = true
    dbg('touchstart', { y: startY })
  }

  function onTouchMove(e) {
    if (!pulling.value) return
    lastMoveAt = Date.now()
    const dy = e.touches[0].clientY - startY
    if (dy <= 0) {
      // User pulled back up -- cancel without firing.
      pullDistance.value = 0
      pulling.value = false
      return
    }
    if (dy < MIN_MOVE) {
      // Too small to count as a deliberate pull. Keep tracking the
      // gesture but do not surface the indicator yet -- otherwise
      // iOS load-time overscroll twitches paint the spinner for no
      // reason every time the page mounts.
      return
    }
    pullDistance.value = Math.min(MAX_PULL, (dy - MIN_MOVE) / RESISTANCE)
    // Stop the browser from also scrolling once we are visibly pulling,
    // otherwise the page rubber-bands and our overlay double-tracks.
    if (pullDistance.value > 6 && e.cancelable) e.preventDefault()
    dbg('touchmove', { dy, pullDistance: Math.round(pullDistance.value) })
  }

  async function onTouchEnd(e) {
    if (!pulling.value) {
      dbg('touchend-skip', { type: e && e.type })
      return
    }
    pulling.value = false
    dbg('touchend', { type: e && e.type, pullDistance: Math.round(pullDistance.value), willFire: pullDistance.value >= THRESHOLD })
    if (pullDistance.value >= THRESHOLD && !refreshing.value) {
      refreshing.value = true
      // Hold the indicator at the trigger position while we refresh
      // so the user gets feedback that something is happening.
      pullDistance.value = THRESHOLD
      try {
        await onRefresh()
      } catch { /* swallow -- the page already surfaces its own errors */ }
      refreshing.value = false
      pullDistance.value = 0
    } else {
      pullDistance.value = 0
    }
  }

  // Backstop -- if the tab is hidden while a touch is mid-flight (iOS
  // can suspend the gesture), reset so the indicator never stays
  // visible behind the scenes.
  function onVisibilityChange() {
    if (document.hidden) {
      pulling.value = false
      refreshing.value = false
      pullDistance.value = 0
    }
  }

  onMounted(() => {
    if (DISABLED) {
      // Stay in ready=false too so the indicator template's v-if
      // shortcircuits even if someone else mutates the refs.
      dbg('disabled', { reason: 'ptr_off flag set' })
      return
    }
    target = typeof scrollSelector === 'string'
      ? document.querySelector(scrollSelector)
      : scrollSelector
    if (!target) return
    target.addEventListener('touchstart', onTouchStart, { passive: true })
    target.addEventListener('touchmove', onTouchMove, { passive: false })
    target.addEventListener('touchend', onTouchEnd, { passive: true })
    target.addEventListener('touchcancel', onTouchEnd, { passive: true })
    // pointerup is the closest cousin to touchend that iOS Safari is
    // less likely to swallow when it hijacks the gesture for its own
    // pull-to-refresh; treat it the same way as touchend.
    target.addEventListener('pointerup', onTouchEnd, { passive: true })
    target.addEventListener('pointercancel', onTouchEnd, { passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)
    // Movement watchdog -- catches the truly stuck case.
    watchdog = setInterval(() => {
      if (!pulling.value || refreshing.value) return
      if (Date.now() - lastMoveAt > 1200) {
        dbg('watchdog-reset', { idleMs: Date.now() - lastMoveAt, pullDistance: Math.round(pullDistance.value) })
        pulling.value = false
        pullDistance.value = 0
      }
    }, 400)
    // Wait one tick before allowing the indicator to surface, so any
    // touch event Vue dispatches during mount cannot win the race.
    requestAnimationFrame(() => { ready.value = true })
  })

  onBeforeUnmount(() => {
    if (!target) return
    target.removeEventListener('touchstart', onTouchStart)
    target.removeEventListener('touchmove', onTouchMove)
    target.removeEventListener('touchend', onTouchEnd)
    target.removeEventListener('touchcancel', onTouchEnd)
    target.removeEventListener('pointerup', onTouchEnd)
    target.removeEventListener('pointercancel', onTouchEnd)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (watchdog) { clearInterval(watchdog); watchdog = null }
  })

  return { pullDistance, refreshing, ready, pulling, threshold: THRESHOLD }
}
