<script setup>
import { computed, ref, watch } from 'vue'
import { RouterView, RouterLink, useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from './composables/useAuth'
import { fontScale, useUiPrefs } from './composables/usePrefs'
import { useViewAs } from './composables/useViewAs'
import { useScope } from './composables/useScope'
import ProfileMenu from './components/ProfileMenu.vue'
import RestaurantPicker from './components/RestaurantPicker.vue'
import AppDialog from './components/AppDialog.vue'

const { owner, restaurant, isModerator, signOut } = useAuth()
const { asOwner } = useViewAs()
const { activeRestaurant, canSwitch } = useScope()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const { hydrateFromOwner } = useUiPrefs()

// Shell (header + tab bar) shows everywhere except the login screen and
// always-open public pages like the install landing.
const showShell = computed(() => route.name && route.name !== 'login' && !route.meta?.open)

// Event editor is a sub-page of the Événements tab.
const activeTab = computed(() => {
  const n = route.name
  if (n === 'scan') return 'scan'
  if (n === 'history') return 'history'
  if (n === 'share') return 'share'
  if (n === 'clients') return 'clients'
  if (n === 'approve') return 'approve'
  if (n === 'admin') return 'admin'
  if (n === 'vouchers' || n === 'voucher-new' || n === 'voucher-edit') return 'vouchers'
  return 'dashboard'
})

// Bottom nav keeps the three daily tabs; everything else lives behind
// the "Plus" tab so the bar never gets crowded (esp. for moderators).
const moreActive = computed(() =>
  ['history', 'share', 'clients', 'approve', 'admin'].includes(activeTab.value)
)
const moreOpen = ref(false)
// Close the sheet on any navigation (item tap, back button, …).
watch(() => route.fullPath, () => { moreOpen.value = false })

// Pull the owner's saved language / text size once they're known.
watch(owner, (o) => { if (o) hydrateFromOwner(o) }, { immediate: true })

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
            <small>{{ t('app.tagline') }}</small>
          </span>
        </RouterLink>
        <div class="hdr-right">
          <!-- Restaurant scope picker — moderators only, and not on the
               admin page (which is the cross-restaurant overview). -->
          <RestaurantPicker v-if="canSwitch && route.name !== 'admin'" />
          <span v-else-if="activeRestaurant" class="who">{{ activeRestaurant.name }}</span>
          <ProfileMenu
            v-if="owner || isModerator"
            :restaurant="activeRestaurant || restaurant"
            :is-moderator="isModerator"
            @signout="doSignOut"
          />
        </div>
      </header>

      <main class="viewport">
        <!-- Inner wrapper carries the text-size zoom so the header/tab bar
             stay fixed and the content simply scrolls. -->
        <div class="vp-zoom" :style="{ zoom: fontScale }">
          <RouterView />
        </div>
      </main>

      <nav class="tabbar">
        <RouterLink :to="{ name: 'dashboard' }" :class="{ on: activeTab === 'dashboard' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
            <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
          </svg>
          {{ t('nav.events') }}
        </RouterLink>
        <RouterLink :to="{ name: 'scan' }" :class="{ on: activeTab === 'scan' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
            <path d="M4 12h16" />
          </svg>
          {{ t('nav.scan') }}
        </RouterLink>
        <RouterLink :to="{ name: 'vouchers' }" :class="{ on: activeTab === 'vouchers' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z" />
            <path d="M10 7v10" stroke-dasharray="2 2.5" />
          </svg>
          {{ t('nav.vouchers') }}
        </RouterLink>
        <button
          type="button"
          class="more-tab"
          :class="{ on: moreActive || moreOpen }"
          @click="moreOpen = true"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
          {{ t('nav.more') }}
        </button>
      </nav>
    </template>

    <RouterView v-else />

    <!-- "Plus" overflow sheet -->
    <Teleport to="body">
      <div v-if="moreOpen" class="more-backdrop" @click.self="moreOpen = false">
        <div class="more-sheet" role="dialog" aria-modal="true">
          <div class="more-grab"></div>
          <RouterLink :to="{ name: 'history' }" class="more-item"
            :class="{ on: activeTab === 'history' }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1" />
              <path d="M3.5 19v-5h5" />
              <path d="M12 8v4.5l3 2" />
            </svg>
            {{ t('nav.history') }}
          </RouterLink>
          <RouterLink :to="{ name: 'share' }" class="more-item"
            :class="{ on: activeTab === 'share' }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <path d="M14 14h3.5v3.5M21 21v-3.5M14 21h3.5" />
            </svg>
            {{ t('nav.share') }}
          </RouterLink>
          <RouterLink :to="{ name: 'clients' }" class="more-item"
            :class="{ on: activeTab === 'clients' }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="9" cy="9" r="3.4" />
              <path d="M3.5 19.5c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" />
              <circle cx="16.8" cy="8.2" r="2.7" />
              <path d="M14 14.4c2.6.5 5 2.5 5 5.1" />
            </svg>
            {{ t('nav.clients') }}
          </RouterLink>
          <RouterLink
            v-if="isModerator && !asOwner"
            :to="{ name: 'approve' }"
            class="more-item"
            :class="{ on: activeTab === 'approve' }"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 12.5l2.2 2.2L15.5 10" />
              <path d="M12 3.2l7 3v5.3c0 4.5-3 7.8-7 9.3-4-1.5-7-4.8-7-9.3V6.2z" />
            </svg>
            {{ t('nav.approve') }}
          </RouterLink>
          <RouterLink
            v-if="isModerator && !asOwner"
            :to="{ name: 'admin' }"
            class="more-item"
            :class="{ on: activeTab === 'admin' }"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
            </svg>
            {{ t('nav.admin') }}
          </RouterLink>
        </div>
      </div>
    </Teleport>

    <AppDialog />
  </div>
</template>

<style scoped>
/* "Plus" tab — matches the .tabbar a styling from main.css. */
.more-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 5px 2px;
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--mut);
  border: 0;
  background: none;
  font-family: inherit;
  cursor: pointer;
}
.more-tab svg { width: 23px; height: 23px; }
.more-tab.on { color: var(--accent); }

/* Overflow sheet */
.more-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(20, 12, 14, 0.42);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.more-sheet {
  width: 100%;
  max-width: 480px;
  background: var(--surface);
  border-top: 1px solid var(--line);
  border-radius: 18px 18px 0 0;
  padding: 8px 0 calc(env(safe-area-inset-bottom) + 10px);
  box-shadow: 0 -12px 32px rgba(0, 0, 0, 0.22);
  animation: more-up 0.2s ease;
}
@keyframes more-up {
  from { transform: translateY(100%); }
  to { transform: none; }
}
.more-grab {
  width: 38px;
  height: 4px;
  border-radius: 99px;
  background: var(--line);
  margin: 4px auto 8px;
}
.more-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 24px;
  color: var(--ink);
  font-weight: 600;
  font-size: 0.94rem;
}
.more-item svg { width: 22px; height: 22px; color: var(--mut); flex: 0 0 auto; }
.more-item:active { background: #faf4ea; }
.more-item.on { color: var(--accent); }
.more-item.on svg { color: var(--accent); }
</style>
