<script setup>
// PullToRefresh — fresh implementation. Lessons applied from the
// removed version:
//
//   1. Self-contained: this component owns its own state. It does NOT
//      hand refs back to the parent for v-bind, so the auto-unwrap
//      trap that made the previous v-if always-true cannot recur.
//   2. Single string state ('idle' | 'pulling' | 'committed') used
//      directly in the template. Vue's template reactivity unwraps
//      top-level refs cleanly here, so the v-if behaves as written.
//   3. Driven by the parent's existing `busy` prop. When the parent
//      flips busy back to false the spinner exits -- no internal
//      `refreshing` flag to get permanently stuck.
//   4. 12-second failsafe still resets state, in case the parent
//      never flips busy (hung fetch).
//
// Usage:
//   <PullToRefresh :busy="loading" @refresh="load" />
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  // The parent's own loading flag. The spinner returns to idle when
  // this goes true -> false, indicating the refresh completed.
  busy: { type: Boolean, default: false }
})
const emit = defineEmits(['refresh'])

const SCROLL_SELECTOR = '.viewport'
const THRESHOLD = 70      // px pulled to trigger refresh
const MAX_PULL = 110      // hard visual cap
const RESIST = 1.8        // rubber-band factor
const MIN_MOVE = 18       // px of finger travel before the indicator surfaces
const FAILSAFE_MS = 12000 // longest the spinner can stay up

const state = ref('idle')      // 'idle' | 'pulling' | 'committed'
const pullDistance = ref(0)

let target = null
let startY = 0
let failsafeTimer = null

function reset() {
  state.value = 'idle'
  pullDistance.value = 0
  if (failsafeTimer) { clearTimeout(failsafeTimer); failsafeTimer = null }
}

function onTouchStart(e) {
  if (state.value !== 'idle' || !target) return
  if (target.scrollTop > 0) return
  if (!e.touches || !e.touches.length) return
  startY = e.touches[0].clientY
  state.value = 'pulling'
}

function onTouchMove(e) {
  if (state.value !== 'pulling') return
  const dy = e.touches[0].clientY - startY
  if (dy <= 0) {
    // Finger came back up before the move threshold -- cancel quietly.
    reset()
    return
  }
  if (dy < MIN_MOVE) return  // below dead zone: do not surface yet
  pullDistance.value = Math.min(MAX_PULL, (dy - MIN_MOVE) / RESIST)
  // Stop iOS rubber-banding the page on top of our animation.
  if (pullDistance.value > 4 && e.cancelable) e.preventDefault()
}

function onTouchEnd() {
  if (state.value !== 'pulling') return
  if (pullDistance.value >= THRESHOLD) {
    state.value = 'committed'
    pullDistance.value = THRESHOLD
    failsafeTimer = setTimeout(reset, FAILSAFE_MS)
    emit('refresh')
  } else {
    reset()
  }
}

// When the parent finishes loading we drop back to idle. We only do
// this transition out of 'committed' so a stray busy=false from a
// background poll cannot cancel an in-flight pull-to-refresh.
watch(() => props.busy, (next, prev) => {
  if (state.value === 'committed' && prev && !next) reset()
})

onMounted(() => {
  target = document.querySelector(SCROLL_SELECTOR)
  if (!target) return
  target.addEventListener('touchstart', onTouchStart, { passive: true })
  target.addEventListener('touchmove', onTouchMove, { passive: false })
  target.addEventListener('touchend', onTouchEnd, { passive: true })
  target.addEventListener('touchcancel', reset, { passive: true })
})

onBeforeUnmount(() => {
  if (!target) return
  target.removeEventListener('touchstart', onTouchStart)
  target.removeEventListener('touchmove', onTouchMove)
  target.removeEventListener('touchend', onTouchEnd)
  target.removeEventListener('touchcancel', reset)
  if (failsafeTimer) clearTimeout(failsafeTimer)
})
</script>

<template>
  <!-- v-if on a single string ref. Nothing renders when state==='idle'. -->
  <div
    v-if="state !== 'idle'"
    class="ptr"
    :style="{
      transform: 'translateY(' + (pullDistance - 56) + 'px)',
      opacity: Math.min(1, pullDistance / THRESHOLD)
    }"
    aria-hidden="true"
  >
    <div
      class="ptr-spin"
      :class="{ ready: pullDistance >= THRESHOLD, spinning: state === 'committed' }"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1" />
        <path d="M3.5 19v-5h5" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.ptr {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 80px);
  left: 0;
  right: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 90;
  will-change: transform, opacity;
}
.ptr-spin {
  width: 30px; height: 30px;
  color: var(--accent);
  transition: color 0.15s;
}
.ptr-spin svg { width: 100%; height: 100%; }
.ptr-spin.ready { color: var(--accent-dark); }
.ptr-spin.spinning { animation: ptr-rot 0.85s linear infinite; }
@keyframes ptr-rot {
  to { transform: rotate(360deg); }
}
</style>
