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
  <div class="app-shell">
    <AppHeader />

    <main class="app-main" ref="mainEl">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <BottomNav />
  </div>

  <OnboardingDialog v-if="dialogOpen" />
  <NotifyPrompt />
</template>
