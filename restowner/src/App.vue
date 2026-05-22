<script setup>
import { computed, watch } from 'vue'
import { RouterView, RouterLink, useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from './composables/useAuth'
import { fontScale, useUiPrefs } from './composables/usePrefs'
import { useViewAs } from './composables/useViewAs'
import ProfileMenu from './components/ProfileMenu.vue'

const { owner, restaurant, isModerator, signOut } = useAuth()
const { asOwner } = useViewAs()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const { hydrateFromOwner } = useUiPrefs()

// Shell (header + tab bar) shows everywhere except the login screen.
const showShell = computed(() => route.name && route.name !== 'login')

// Event editor is a sub-page of the Événements tab.
const activeTab = computed(() => {
  const n = route.name
  if (n === 'scan') return 'scan'
  if (n === 'history') return 'history'
  if (n === 'share') return 'share'
  if (n === 'approve') return 'approve'
  if (n === 'admin') return 'admin'
  if (n === 'vouchers' || n === 'voucher-new' || n === 'voucher-edit') return 'vouchers'
  return 'dashboard'
})

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
          <span v-if="restaurant" class="who">{{ restaurant.name }}</span>
          <ProfileMenu
            v-if="owner"
            :restaurant="restaurant"
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
        <RouterLink :to="{ name: 'history' }" :class="{ on: activeTab === 'history' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1" />
            <path d="M3.5 19v-5h5" />
            <path d="M12 8v4.5l3 2" />
          </svg>
          {{ t('nav.history') }}
        </RouterLink>
        <RouterLink :to="{ name: 'share' }" :class="{ on: activeTab === 'share' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <path d="M14 14h3.5v3.5M21 21v-3.5M14 21h3.5" />
          </svg>
          {{ t('nav.share') }}
        </RouterLink>
        <RouterLink
          v-if="isModerator && !asOwner"
          :to="{ name: 'approve' }"
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
          :class="{ on: activeTab === 'admin' }"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
          </svg>
          {{ t('nav.admin') }}
        </RouterLink>
      </nav>
    </template>

    <RouterView v-else />
  </div>
</template>
