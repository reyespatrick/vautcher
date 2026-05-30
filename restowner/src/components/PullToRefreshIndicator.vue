<script setup>
// Tiny indicator a page renders just above its content while a
// pull-to-refresh gesture is in flight. Props mirror the shape that
// usePullToRefresh returns so the call site is just:
//   <PullToRefreshIndicator v-bind="ptr" />
//
// Two reasons it's absolutely positioned:
//   1. Layout never shifts when the indicator appears, so even a brief
//      stray render (iOS load-time overscroll twitch) cannot visibly
//      push the page-head down.
//   2. The host page does not have to reserve vertical space for an
//      element that is only meaningful while pulling.
defineProps({
  pullDistance: { type: Number, default: 0 },
  refreshing: { type: Boolean, default: false },
  pulling: { type: Boolean, default: false },
  ready: { type: Boolean, default: false },
  threshold: { type: Number, default: 70 }
})
</script>

<template>
  <!-- HARD invariant: indicator may render ONLY while a touch is
       actively down (pulling) or a refresh is in flight (refreshing).
       Both default to false on every composable mount, so the spinner
       physically cannot surface at rest -- no matter what value
       pullDistance is computed at on the first paint. -->
  <div
    v-if="ready && (pulling || refreshing)"
    class="ptr"
    :style="{
      transform: 'translateY(' + (pullDistance - 56) + 'px)',
      opacity: Math.min(1, pullDistance / threshold)
    }"
    aria-hidden="true"
  >
    <div
      class="ptr-spin"
      :class="{ ready: pullDistance >= threshold, spinning: refreshing }"
      :style="{ transform: refreshing
        ? null
        : 'rotate(' + (Math.min(1, pullDistance / threshold) * 360) + 'deg)' }"
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
/* position: absolute relative to the .page wrapper means the indicator
   floats above the page-head gap without consuming any layout height. */
.ptr {
  position: absolute;
  top: 0;
  left: 0; right: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 5;
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
