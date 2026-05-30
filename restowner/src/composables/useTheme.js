// Theme state. The chosen palette is already applied by an inline
// script in index.html on first paint; this composable just keeps the
// reactive value in sync and lets components flip it. Three modes:
//   'light' | 'dark' | 'auto'
// 'auto' tracks the OS preference live. The default on a fresh device
// is 'auto'.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const KEY = 'restowner.theme'

// Module-level state so every consumer sees the same value.
const stored = (() => {
  try { return localStorage.getItem(KEY) } catch { return null }
})()
const mode = ref(stored === 'light' || stored === 'dark' ? stored : 'auto')

function osDark() {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function apply(m) {
  const effective = m === 'auto' ? (osDark() ? 'dark' : 'light') : m
  document.documentElement.setAttribute('data-theme', effective)
  // Keep the iOS status bar / Android theme-color in sync.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', effective === 'dark' ? '#1a1015' : '#9e053d')
}

let mql = null
let listenerBound = false

export function useTheme() {
  function setMode(next) {
    mode.value = next
    apply(next)
    try {
      if (next === 'auto') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch { /* no-op */ }
  }
  // Cycle through light -> dark -> auto -> ...
  function cycle() {
    const seq = ['light', 'dark', 'auto']
    const i = seq.indexOf(mode.value)
    setMode(seq[(i + 1) % seq.length])
  }
  const effective = computed(() => mode.value === 'auto' ? (osDark() ? 'dark' : 'light') : mode.value)

  onMounted(() => {
    // First call paints whatever the boot script picked, harmless.
    apply(mode.value)
    if (!listenerBound && typeof window !== 'undefined' && window.matchMedia) {
      mql = window.matchMedia('(prefers-color-scheme: dark)')
      const onChange = () => { if (mode.value === 'auto') apply('auto') }
      mql.addEventListener ? mql.addEventListener('change', onChange) : mql.addListener(onChange)
      listenerBound = true
    }
  })

  return { mode, effective, setMode, cycle }
}
