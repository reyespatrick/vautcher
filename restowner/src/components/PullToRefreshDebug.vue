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
const inspectMode = ref(false)
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

// Inspect mode: next tap anywhere dumps a stack of elements at that
// point. Useful when a mystery icon is visible -- tap it and the log
// tells us which Vue component / SVG is rendering it.
function onInspectTap(e) {
  if (!inspectMode.value) return
  if (e.target && e.target.closest && e.target.closest('.ptrd')) return  // ignore taps on the debug widget itself
  const x = e.touches ? e.touches[0].clientX : e.clientX
  const y = e.touches ? e.touches[0].clientY : e.clientY
  const stack = document.elementsFromPoint(x, y)
  const summary = stack.slice(0, 5).map((el) => {
    const tag = el.tagName.toLowerCase()
    const cls = el.className && el.className.baseVal !== undefined
      ? el.className.baseVal           // SVG
      : (typeof el.className === 'string' ? el.className : '')
    const id = el.id ? '#' + el.id : ''
    return tag + id + (cls ? '.' + String(cls).trim().split(/\s+/).join('.') : '')
  })
  ;(window).__ptrLog = (window).__ptrLog || []
  ;(window).__ptrLog.push({
    t: new Date().toISOString().slice(11, 23),
    label: 'inspect',
    x: Math.round(x),
    y: Math.round(y),
    stack: summary
  })
  if ((window).__ptrLog.length > 12) (window).__ptrLog.shift()
  window.dispatchEvent(new CustomEvent('ptr-log'))
  inspectMode.value = false
}
function toggleInspect() {
  inspectMode.value = !inspectMode.value
}

onMounted(() => {
  if (!enabled) return
  pull()
  window.addEventListener('ptr-log', pull)
  document.addEventListener('touchstart', onInspectTap, { capture: true, passive: true })
})
onBeforeUnmount(() => {
  if (!enabled) return
  window.removeEventListener('ptr-log', pull)
  document.removeEventListener('touchstart', onInspectTap, { capture: true })
})
</script>

<template>
  <div v-if="enabled" class="ptrd"
    @touchstart="onPressStart" @touchend="onPressEnd" @touchcancel="onPressEnd">
    <div class="ptrd-hdr">
      <span>PTR debug</span>
      <button type="button" class="ptrd-act" :class="{ on: inspectMode }" @click.stop="toggleInspect">
        {{ inspectMode ? 'tap an element' : 'inspect' }}
      </button>
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
.ptrd-act {
  margin-left: auto; margin-right: 8px;
  border: 1px solid rgba(255,255,255,0.25); background: transparent;
  color: inherit; font: inherit; font-size: 10.5px; font-weight: 700;
  padding: 2px 8px; border-radius: 99px; cursor: pointer;
}
.ptrd-act.on { background: #ffba2c; color: #1b1014; border-color: #ffba2c; }
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
