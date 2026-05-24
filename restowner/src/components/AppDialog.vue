<script setup>
import { onBeforeUnmount, watch } from 'vue'
import { useDialog } from '../composables/useDialog'

const { state, _resolve } = useDialog()

function onCancel() { _resolve(false) }
function onConfirm() { _resolve(true) }

// Escape closes any open dialog as a cancel.
function onKey(e) {
  if (!state.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    _resolve(false)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    _resolve(true)
  }
}
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// Disable body scroll while a dialog is up.
watch(state, (v) => {
  if (v) document.body.style.overflow = 'hidden'
  else document.body.style.overflow = ''
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
  transition: background 0.15s;
}
.dlg-btn:hover { background: var(--accent-dark); }
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
