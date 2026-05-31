<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from './components/AppHeader.vue'
import BottomNav from './components/BottomNav.vue'
import OnboardingDialog from './components/OnboardingDialog.vue'
import NotifyPrompt from './components/NotifyPrompt.vue'
import SuspendedView from './views/SuspendedView.vue'
import { useProfile } from './composables/useProfile'
import { useBilling } from './composables/useBilling'

const { dialogOpen } = useProfile()
const { isBlocked: tenantBlocked, refresh: refreshBilling } = useBilling()
onMounted(() => { refreshBilling() })

// The scroll lives in .app-main now (not the window), so reset it to the
// top on every navigation.
const route = useRoute()
const mainEl = ref(null)
watch(() => route.fullPath, () => {
  if (mainEl.value) mainEl.value.scrollTop = 0
})
</script>

<template>
  <!-- Subscription takeover. The owner's billing state has fallen out of
       good standing, so we replace the entire diner UI with a takeover
       page instead of letting customers interact with a tenant whose
       owner has gone dark. -->
  <SuspendedView v-if="tenantBlocked" />

  <!-- /install is a takeover landing for the QR scan — no header, no
       bottom nav, so it doesn't look like just another tab inside the
       app to a first-time visitor. -->
  <div v-else class="app-shell" :class="{ 'app-shell--bare': route.name === 'install' }">
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
       customer's first contact and must be just the install card.
       Also suppressed when the tenant is suspended (no point asking the
       customer to install an app that's been replaced by a takeover). -->
  <OnboardingDialog v-if="dialogOpen && route.name !== 'install' && !tenantBlocked" />
  <NotifyPrompt v-if="route.name !== 'install' && !tenantBlocked" />
</template>
