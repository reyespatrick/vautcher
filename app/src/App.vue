<script setup>
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from './components/AppHeader.vue'
import BottomNav from './components/BottomNav.vue'
import OnboardingDialog from './components/OnboardingDialog.vue'
import NotifyPrompt from './components/NotifyPrompt.vue'
import { useProfile } from './composables/useProfile'

const { dialogOpen } = useProfile()

// The scroll lives in .app-main now (not the window), so reset it to the
// top on every navigation.
const route = useRoute()
const mainEl = ref(null)
watch(() => route.fullPath, () => {
  if (mainEl.value) mainEl.value.scrollTop = 0
})
</script>

<template>
  <!-- /install is a takeover landing for the QR scan — no header, no
       bottom nav, so it doesn't look like just another tab inside the
       app to a first-time visitor. -->
  <div class="app-shell" :class="{ 'app-shell--bare': route.name === 'install' }">
    <AppHeader v-if="route.name !== 'install'" />

    <main class="app-main" ref="mainEl">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <BottomNav v-if="route.name !== 'install'" />
  </div>

  <!-- Neither overlay belongs on the install landing — that page is the
       customer's first contact and must be just the install card. -->
  <OnboardingDialog v-if="dialogOpen && route.name !== 'install'" />
  <NotifyPrompt v-if="route.name !== 'install'" />
</template>
