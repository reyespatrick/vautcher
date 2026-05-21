<script setup>
import AppHeader from './components/AppHeader.vue'
import BottomNav from './components/BottomNav.vue'
import OnboardingDialog from './components/OnboardingDialog.vue'
import { useProfile } from './composables/useProfile'

const { dialogOpen } = useProfile()
</script>

<template>
  <AppHeader />

  <main class="app-main">
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
  </main>

  <BottomNav />

  <OnboardingDialog v-if="dialogOpen" />
</template>
