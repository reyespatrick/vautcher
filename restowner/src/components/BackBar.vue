<script setup>
// Prominent back control: a circular burgundy arrow + the page title on
// one line. Replaces the old faint .back-link across the editor/detail
// screens so "go back" is obvious.
import { RouterLink } from 'vue-router'

defineProps({
  to: { type: [String, Object], required: true },
  label: { type: String, default: '' }
})
</script>

<template>
  <div class="backbar">
    <RouterLink :to="to" class="backbar-arrow" aria-label="Retour">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
      </svg>
    </RouterLink>
    <h1 v-if="label" class="backbar-title">{{ label }}</h1>
  </div>
</template>

<style scoped>
.backbar {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 16px;
}
.backbar-arrow {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(158, 5, 61, 0.28);
  transition: background 0.15s, transform 0.1s;
}
.backbar-arrow:active {
  background: var(--accent-dark);
  transform: scale(0.94);
}
.backbar-arrow svg { width: 19px; height: 19px; }
.backbar-title {
  font-family: 'Rufina', serif;
  font-weight: 700;
  font-size: 1rem;
  color: var(--ink);
  line-height: 1.2;
  margin: 0;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
