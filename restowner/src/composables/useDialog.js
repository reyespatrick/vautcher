// Shared confirm/alert dialog — replaces native window.confirm() and
// window.alert() so all modal prompts use the app's own styling.
//
// Usage:
//   const { confirm, alert } = useDialog()
//   const ok = await confirm({ title, body, confirmLabel, danger: true })
//   if (!ok) return
//
import { ref } from 'vue'

// One slot only — the dialog is modal, so it never needs to queue.
const state = ref(null)

function open(opts) {
  return new Promise((resolve) => {
    state.value = { ...opts, resolve }
  })
}

export function useDialog() {
  function confirm({
    title = '',
    body = '',
    confirmLabel = 'Confirmer',
    cancelLabel = 'Annuler',
    danger = false
  } = {}) {
    return open({ kind: 'confirm', title, body, confirmLabel, cancelLabel, danger })
  }

  function alert({ title = '', body = '', confirmLabel = 'OK' } = {}) {
    return open({ kind: 'alert', title, body, confirmLabel })
  }

  function _resolve(answer) {
    if (!state.value) return
    const { resolve } = state.value
    state.value = null
    resolve(answer)
  }

  return { state, confirm, alert, _resolve }
}
