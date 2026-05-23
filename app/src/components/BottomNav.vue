<script setup>
import { RouterLink } from 'vue-router'

const tabs = [
  { to: '/', label: 'Accueil', icon: '🏠' },
  { to: '/evenements', label: 'Agenda', icon: '🎉' },
  { to: '/vautcher', label: 'Fidélité', icon: '🎟️' },
  { to: '/reservation', label: 'Réserver', icon: '📅' },
  { to: '/contact', label: 'Contact', icon: '📍' }
]
</script>

<template>
  <nav class="bottom-nav">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="tab"
    >
      <span class="tab-icon">{{ tab.icon }}</span>
      <span class="tab-label">{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.bottom-nav {
  flex: 0 0 auto;
  /* Include the safe-area inset in the bar height so the iPhone's
     home-indicator doesn't eat into the icon row. */
  min-height: calc(var(--bottomnav-h) + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid var(--line);
  display: flex;
  z-index: 100;
  padding-bottom: env(safe-area-inset-bottom);
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--grey);
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  transition: color 0.15s;
}
.tab-icon {
  font-size: 1.2rem;
  line-height: 1;
  filter: grayscale(1);
  opacity: 0.55;
  transition: filter 0.15s, opacity 0.15s, transform 0.15s;
}
.tab.router-link-active { color: var(--burgundy); }
.tab.router-link-active .tab-icon {
  filter: none;
  opacity: 1;
  transform: translateY(-1px) scale(1.12);
}

/* Hidden on wider screens — the top nav takes over */
@media (min-width: 721px) {
  .bottom-nav { display: none; }
}
</style>
