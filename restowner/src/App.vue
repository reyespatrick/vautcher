<script setup>
import { computed } from 'vue'
import { RouterView, RouterLink, useRouter, useRoute } from 'vue-router'
import { useAuth } from './composables/useAuth'

const { owner, restaurant, signOut } = useAuth()
const router = useRouter()
const route = useRoute()

// Shell (header + tab bar) shows everywhere except the login screen.
const showShell = computed(() => route.name && route.name !== 'login')

// Event editor is a sub-page of the Événements tab.
const activeTab = computed(() => {
  if (route.name === 'scan') return 'scan'
  if (route.name === 'history') return 'history'
  return 'dashboard'
})

async function doSignOut() {
  await signOut()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="app-root">
    <template v-if="showShell">
      <header class="app-header">
        <RouterLink :to="{ name: 'dashboard' }" class="brand">
          <img src="/assets/logo.jpg" alt="" />
          <span>
            <b>restowner</b>
            <small>Console restaurateur</small>
          </span>
        </RouterLink>
        <div class="hdr-right">
          <span v-if="restaurant" class="who">{{ restaurant.name }}</span>
          <button v-if="owner" class="icon-btn" aria-label="Déconnexion" @click="doSignOut">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 17v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
              <path d="M10 12h11M18 9l3 3-3 3" />
            </svg>
          </button>
        </div>
      </header>

      <main class="viewport">
        <RouterView />
      </main>

      <nav class="tabbar">
        <RouterLink :to="{ name: 'dashboard' }" :class="{ on: activeTab === 'dashboard' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
            <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
          </svg>
          Événements
        </RouterLink>
        <RouterLink :to="{ name: 'scan' }" :class="{ on: activeTab === 'scan' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
            <path d="M4 12h16" />
          </svg>
          Scanner
        </RouterLink>
        <RouterLink :to="{ name: 'history' }" :class="{ on: activeTab === 'history' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1" />
            <path d="M3.5 19v-5h5" />
            <path d="M12 8v4.5l3 2" />
          </svg>
          Historique
        </RouterLink>
      </nav>
    </template>

    <RouterView v-else />
  </div>
</template>
