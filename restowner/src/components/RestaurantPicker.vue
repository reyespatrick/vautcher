<script setup>
// Compact restaurant scope picker for the app header.
// Custom dropdown so iOS Safari doesn't render its giant native
// <select> overlay (which obscures half the page).
import { ref, computed, onBeforeUnmount } from 'vue'
import { useScope } from '../composables/useScope'

const { restaurants, activeRestaurant, setScope } = useScope()
const open = ref(false)

const currentName = computed(() => activeRestaurant.value?.name || '—')

function toggle() { open.value = !open.value }
function close() { open.value = false }
function pick(id) {
  setScope(id)
  close()
}

// Close the menu on any outside click / Escape press.
function onDocClick(e) {
  if (!e.target.closest?.('.rp')) close()
}
function onKey(e) {
  if (e.key === 'Escape') close()
}
document.addEventListener('click', onDocClick)
document.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="rp" :class="{ 'rp--open': open }">
    <button
      type="button"
      class="rp-btn"
      :aria-expanded="open"
      :title="currentName"
      @click="toggle"
    >
      <span class="rp-name">{{ currentName }}</span>
      <svg class="rp-caret" viewBox="0 0 12 8" aria-hidden="true">
        <path d="M1 1l5 5 5-5" fill="none" stroke="currentColor"
              stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <ul v-if="open" class="rp-menu" role="listbox">
      <li
        v-for="r in restaurants"
        :key="r.id"
        role="option"
        :aria-selected="activeRestaurant && r.id === activeRestaurant.id"
        :class="{ on: activeRestaurant && r.id === activeRestaurant.id }"
        @click="pick(r.id)"
      >
        <svg v-if="activeRestaurant && r.id === activeRestaurant.id"
             class="rp-tick" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M2 7.5l3.5 3.5L12 3" fill="none" stroke="currentColor"
                stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span v-else class="rp-tick-sp"></span>
        <span class="rp-item-name">{{ r.name }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.rp {
  position: relative;
}
.rp-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.rp-btn:hover { border-color: var(--accent); }
.rp--open .rp-btn { border-color: var(--accent); background: #fdf3f6; }
.rp-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}
.rp-caret {
  width: 10px;
  height: 7px;
  flex: 0 0 auto;
  transition: transform 0.18s;
  color: var(--mut);
}
.rp--open .rp-caret { transform: rotate(180deg); }

.rp-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 220px;
  max-width: 280px;
  max-height: 60vh;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 6px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.18);
  z-index: 200;
  animation: rp-pop 0.14s ease-out;
}
@keyframes rp-pop {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}
.rp-menu li {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  font-size: 0.9rem;
  border-radius: 8px;
  cursor: pointer;
  color: var(--ink);
}
.rp-menu li:hover { background: #faf4ea; }
.rp-menu li.on { color: var(--accent); font-weight: 700; }
.rp-tick { width: 14px; height: 14px; color: var(--accent); flex: 0 0 auto; }
.rp-tick-sp { width: 14px; height: 14px; flex: 0 0 auto; }
.rp-item-name {
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
