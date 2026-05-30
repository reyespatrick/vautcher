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
const THRESHOLD = 70    // px pulled to trigger refresh
const MAX_PULL = 110    // hard cap, gives nice rubber-band feel
const RESISTANCE = 1.8  // divide finger distance by this for the visual pull

export function usePullToRefresh(onRefresh, scrollSelector = DEFAULT_SCROLL_SELECTOR) {
  const pullDistance = ref(0)
  const refreshing = ref(false)
  let startY = 0
  let pulling = false
  let target = null

  function onTouchStart(e) {
    if (refreshing.value || !target) return
    if (target.scrollTop > 0) return
    if (!e.touches || !e.touches.length) return
    startY = e.touches[0].clientY
    pulling = true
  }

  function onTouchMove(e) {
    if (!pulling) return
    const dy = e.touches[0].clientY - startY
    if (dy <= 0) {
      // User pulled back up -- cancel without firing.
      pullDistance.value = 0
      pulling = false
      return
    }
    pullDistance.value = Math.min(MAX_PULL, dy / RESISTANCE)
    // Stop the browser from also scrolling once we are visibly pulling,
    // otherwise the page rubber-bands and our overlay double-tracks.
    if (pullDistance.value > 6 && e.cancelable) e.preventDefault()
  }

  async function onTouchEnd() {
    if (!pulling) return
    pulling = false
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

  onMounted(() => {
    target = typeof scrollSelector === 'string'
      ? document.querySelector(scrollSelector)
      : scrollSelector
    if (!target) return
    target.addEventListener('touchstart', onTouchStart, { passive: true })
    target.addEventListener('touchmove', onTouchMove, { passive: false })
    target.addEventListener('touchend', onTouchEnd, { passive: true })
    target.addEventListener('touchcancel', onTouchEnd, { passive: true })
  })

  onBeforeUnmount(() => {
    if (!target) return
    target.removeEventListener('touchstart', onTouchStart)
    target.removeEventListener('touchmove', onTouchMove)
    target.removeEventListener('touchend', onTouchEnd)
    target.removeEventListener('touchcancel', onTouchEnd)
  })

  return { pullDistance, refreshing, threshold: THRESHOLD }
}
