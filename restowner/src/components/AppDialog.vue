<script setup>
import { onBeforeUnmount, ref, watch, nextTick, computed } from 'vue'
import { useDialog } from '../composables/useDialog'

const { state, _resolve } = useDialog()

// Typed value while a destructive-confirm dialog is open. Reset every
// time a new dialog opens so the previous attempt's text doesn't bleed
// through.
const typed = ref('')

// Confirm button is enabled either when no text is required, or when
// the user has typed the required string exactly (case-sensitive, both
// sides trimmed so trailing newlines from autocomplete don't bite).
const canConfirm = computed(() => {
  if (!state.value) return false
  const req = state.value.requireText
  if (!req) return true
  return typed.value.trim() === String(req).trim()
})

function onCancel() { _resolve(false) }
function onConfirm() {
  if (!canConfirm.value) return
  _resolve(true)
}

// Escape closes any open dialog as a cancel.
// Enter only commits if the text guard (if any) is satisfied.
function onKey(e) {
  if (!state.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    _resolve(false)
  } else if (e.key === 'Enter' && canConfirm.value && !state.value.requireText) {
    e.preventDefault()
    _resolve(true)
  }
}
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// Reset the input and focus it whenever a new dialog opens.
const inputRef = ref(null)
watch(state, async (v) => {
  if (v) {
    document.body.style.overflow = 'hidden'
    typed.value = ''
    if (v.requireText) {
      await nextTick()
      inputRef.value?.focus()
    }
  } else {
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <transition name="dlg">
      <div
        v-if="state"
        class="dlg-backdrop"
        @click.self="onCancel"
        role="dialog"
        aria-modal="true"
      >
        <div class="dlg" :class="{ 'dlg--danger': state.danger }">
          <h3 v-if="state.title" class="dlg-title">{{ state.title }}</h3>
          <p v-if="state.body" class="dlg-body">{{ state.body }}</p>

          <!-- Optional typed-confirmation input. When state.requireText is
               set, the confirm button stays disabled until the input
               matches exactly. -->
          <div v-if="state.requireText" class="dlg-guard">
            <label v-if="state.inputLabel" class="dlg-guard-label">
              {{ state.inputLabel }}
            </label>
            <input
              ref="inputRef"
              v-model="typed"
              type="text"
              class="dlg-guard-input"
              :placeholder="state.inputPlaceholder || state.requireText"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="none"
              spellcheck="false"
              @keydown.enter.prevent="onConfirm"
            />
          </div>

          <div class="dlg-actions">
            <button
              v-if="state.kind === 'confirm'"
              type="button"
              class="dlg-btn dlg-btn--ghost"
              @click="onCancel"
            >{{ state.cancelLabel }}</button>
            <button
              type="button"
              class="dlg-btn"
              :class="{ 'dlg-btn--danger': state.danger }"
              :disabled="!canConfirm"
              @click="onConfirm"
            >{{ state.confirmLabel }}</button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.dlg-backdrop {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: rgba(20, 12, 14, 0.55);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.dlg {
  width: 100%;
  max-width: 380px;
  background: var(--surface);
  border-radius: 16px;
  padding: 22px 22px 18px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.34);
  border-top: 4px solid var(--accent);
}
.dlg--danger { border-top-color: var(--danger); }

.dlg-title {
  font-family: 'Rufina', serif;
  font-size: 1.15rem;
  color: var(--ink);
  margin: 0 0 8px;
  line-height: 1.25;
}
.dlg-body {
  font-size: 0.92rem;
  color: var(--mut);
  line-height: 1.5;
  margin: 0 0 18px;
  white-space: pre-line;
}

/* Typed-confirmation guard block. */
.dlg-guard {
  margin: 0 0 16px;
}
.dlg-guard-label {
  display: block;
  font-size: 0.78rem;
  color: var(--ink);
  margin-bottom: 6px;
  line-height: 1.4;
}
.dlg-guard-input {
  width: 100%;
  font-family: inherit;
  font-size: 0.95rem;
  padding: 10px 12px;
  border: 1.5px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  box-sizing: border-box;
}
.dlg-guard-input:focus {
  outline: none;
  border-color: var(--danger);
}

.dlg-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
.dlg-btn {
  font-family: inherit;
  font-weight: 700;
  font-size: 0.86rem;
  letter-spacing: 0.04em;
  padding: 11px 18px;
  border-radius: 10px;
  border: 0;
  cursor: pointer;
  background: var(--accent);
  color: #fff;
  transition: background 0.15s, opacity 0.15s;
}
.dlg-btn:hover { background: var(--accent-dark); }
.dlg-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.dlg-btn--danger { background: var(--danger); }
.dlg-btn--danger:hover { background: #991b1b; }
.dlg-btn--ghost {
  background: transparent;
  color: var(--mut);
  border: 1px solid var(--line);
}
.dlg-btn--ghost:hover {
  background: #faf4ea;
  color: var(--ink);
}

/* Backdrop + dialog fade/slide */
.dlg-enter-active, .dlg-leave-active { transition: opacity 0.18s; }
.dlg-enter-from, .dlg-leave-to { opacity: 0; }
.dlg-enter-active .dlg, .dlg-leave-active .dlg {
  transition: transform 0.22s cubic-bezier(0.18, 1.2, 0.4, 1);
}
.dlg-enter-from .dlg { transform: translateY(14px) scale(0.97); }
.dlg-leave-to .dlg { transform: translateY(8px); }
</style>
