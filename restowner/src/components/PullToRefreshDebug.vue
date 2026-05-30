<script setup>
// Visible debug overlay for the pull-to-refresh composable. Only ever
// renders when the user opted in via URL ?ptr_debug=1 or
// localStorage.ptr_debug='1'. Reads from window.__ptrLog which the
// composable writes to on every gesture event.
//
// Long-press the badge for ~600ms to clear the log.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { PTR_DEBUG_ENABLED } from '../composables/usePullToRefresh'

const enabled = PTR_DEBUG_ENABLED
const log = ref([])
let pressTimer = null

function pull() {
  log.value = ((window).__ptrLog || []).slice().reverse()
}
function clear() {
  ;(window).__ptrLog = []
  pull()
}
function disable() {
  try {
    localStorage.removeItem('ptr_debug')
    const url = new URL(window.location.href)
    url.searchParams.delete('ptr_debug')
    window.location.replace(url.toString())
  } catch { /* no-op */ }
}
function onPressStart() { pressTimer = setTimeout(clear, 600) }
function onPressEnd() { if (pressTimer) clearTimeout(pressTimer); pressTimer = null }

onMounted(() => {
  if (!enabled) return
  pull()
  window.addEventListener('ptr-log', pull)
})
onBeforeUnmount(() => {
  if (!enabled) return
  window.removeEventListener('ptr-log', pull)
})
</script>

<template>
  <div v-if="enabled" class="ptrd"
    @touchstart="onPressStart" @touchend="onPressEnd" @touchcancel="onPressEnd">
    <div class="ptrd-hdr">
      <span>PTR debug</span>
      <button type="button" class="ptrd-off" @click.stop="disable">×</button>
    </div>
    <pre v-if="log.length"><span v-for="(l, i) in log" :key="i">{{ l.t }} {{ l.label }} {{ JSON.stringify({ ...l, t: undefined, label: undefined }) }}
</span></pre>
    <pre v-else class="ptrd-empty">no events yet — pull anywhere to trace</pre>
    <div class="ptrd-foot">long-press to clear</div>
  </div>
</template>

<style scoped>
.ptrd {
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom) + 78px);
  left: 8px;
  right: 8px;
  max-height: 38vh;
  z-index: 200;
  background: rgba(20, 12, 14, 0.92);
  color: #d8e2ed;
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ptrd-hdr {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.06);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.ptrd-off {
  border: 0; background: transparent; color: inherit;
  font-size: 16px; padding: 0 4px; cursor: pointer;
}
.ptrd pre {
  margin: 0; padding: 8px 10px; overflow: auto; flex: 1;
  white-space: pre-wrap; word-break: break-word;
}
.ptrd-empty { color: #7a8696; font-style: italic; }
.ptrd-foot {
  padding: 4px 10px 6px;
  font-size: 9.5px;
  color: #7a8696;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  text-align: center;
}
</style>
