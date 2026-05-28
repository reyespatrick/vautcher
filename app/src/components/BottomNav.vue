<script setup>
import { RouterLink } from 'vue-router'

// Inline SVGs (heroicons-style outline). currentColor stroke means
// they take their color from the tab's text color, so the active tab
// turns brand-color in one shot — no per-icon filter tricks needed.
const tabs = [
  { to: '/',           label: 'Accueil',  icon: 'home' },
  { to: '/evenements', label: 'Promo',    icon: 'calendar' },
  { to: '/vautcher',   label: 'Fidélité', icon: 'star' },
  { to: '/reservation',label: 'Réserver', icon: 'clock' },
  { to: '/contact',    label: 'Contact',  icon: 'pin' }
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
      <span class="tab-icon" aria-hidden="true">
        <svg v-if="tab.icon === 'home'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5 10v9a1 1 0 0 0 1 1h3.5v-5.5h5V20H18a1 1 0 0 0 1-1v-9" />
        </svg>
        <svg v-else-if="tab.icon === 'calendar'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
          <path d="M3.5 10h17" />
          <path d="M8 3.5v4M16 3.5v4" />
        </svg>
        <svg v-else-if="tab.icon === 'star'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.6 6.6 20.4l1-6.1L3.2 10l6.1-.9L12 3.5Z" />
        </svg>
        <svg v-else-if="tab.icon === 'clock'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 21s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12Z" />
          <circle cx="12" cy="9.5" r="2.5" />
        </svg>
      </span>
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
  gap: 4px;
  color: var(--grey);
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  transition: color 0.15s;
}
.tab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  opacity: 0.7;
  transition: opacity 0.15s, transform 0.15s;
}
.tab-icon svg { width: 100%; height: 100%; display: block; }
.tab.router-link-active { color: var(--burgundy); }
.tab.router-link-active .tab-icon {
  opacity: 1;
  transform: translateY(-1px) scale(1.08);
}

/* Hidden on wider screens — the top nav takes over */
@media (min-width: 721px) {
  .bottom-nav { display: none; }
}
</style>
