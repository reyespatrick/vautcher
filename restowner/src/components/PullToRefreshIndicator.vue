<script setup>
// Tiny indicator a page renders just above its content while a
// pull-to-refresh gesture is in flight. Props mirror the shape that
// usePullToRefresh returns so the call site is just:
//   <PullToRefreshIndicator v-bind="ptr" />
defineProps({
  pullDistance: { type: Number, default: 0 },
  refreshing: { type: Boolean, default: false },
  threshold: { type: Number, default: 70 }
})
</script>

<template>
  <div
    class="ptr"
    :style="{
      height: pullDistance + 'px',
      opacity: Math.min(1, pullDistance / threshold)
    }"
    aria-hidden="true"
  >
    <div
      class="ptr-spin"
      :class="{ ready: pullDistance >= threshold, spinning: refreshing }"
      :style="{ transform: refreshing
        ? null
        : `rotate(${Math.min(1, pullDistance / threshold) * 360}deg)` }"
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
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  pointer-events: none;
  transition: height 0.18s ease-out, opacity 0.18s ease-out;
}
.ptr-spin {
  width: 30px; height: 30px;
  color: var(--accent);
  transition: color 0.15s, transform 0.05s linear;
}
.ptr-spin svg { width: 100%; height: 100%; }
.ptr-spin.ready { color: var(--accent-dark); }
.ptr-spin.spinning { animation: ptr-rot 0.85s linear infinite; }
@keyframes ptr-rot {
  to { transform: rotate(360deg); }
}
</style>
