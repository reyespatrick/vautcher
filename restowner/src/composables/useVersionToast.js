// Detects "we just loaded a new bundle" by comparing the version
// baked into the running bundle (__APP_VERSION__, set in vite.config.js
// from package.json) against the last version that ran on this device
// (persisted in localStorage). When they differ, we surface a one-shot
// top banner so the user knows the kill-and-relaunch they just did
// actually pulled in a new build — without having to open Profile to
// eyeball the version number.
import { ref } from 'vue'

const KEY = 'restowner_last_seen_version'

const currentVersion = ref(__APP_VERSION__)
const updatedFrom = ref('')
const visible = ref(false)
let timer = null

export function useVersionToast() {
  function init() {
    const last = localStorage.getItem(KEY)
    // First ever launch on this device — record and stay quiet.
    if (!last) {
      localStorage.setItem(KEY, currentVersion.value)
      return
    }
    if (last !== currentVersion.value) {
      updatedFrom.value = last
      visible.value = true
      localStorage.setItem(KEY, currentVersion.value)
      clearTimeout(timer)
      timer = setTimeout(() => { visible.value = false }, 5000)
    }
  }
  function dismiss() {
    clearTimeout(timer)
    visible.value = false
  }
  return { currentVersion, updatedFrom, visible, init, dismiss }
}
