<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiPrefs } from '../composables/usePrefs'
import { useViewAs } from '../composables/useViewAs'
import { useTheme } from '../composables/useTheme'
import { usePushAdmin } from '../composables/usePushAdmin'
import { DINER_APP_URL } from '../lib/config'
import { SUPPORTED_LOCALES } from '../i18n'

defineProps({
  restaurant: { type: Object, default: null },
  isModerator: { type: Boolean, default: false }
})
const emit = defineEmits(['signout'])

const { t } = useI18n()
const { fontScale, locale, larger, smaller, resetSize, setLocale } = useUiPrefs()
const { asOwner } = useViewAs()
const { mode: themeMode, setMode: setTheme } = useTheme()
const { supported: pushSupported, subscribed: pushSubscribed, enable: enablePush, disable: disablePush } = usePushAdmin()
const open = ref(false)
const pushBusy = ref(false)

async function toggleNotif() {
  if (pushBusy.value) return
  pushBusy.value = true
  try {
    if (pushSubscribed.value) await disablePush()
    else await enablePush()
  } finally {
    pushBusy.value = false
  }
}
const version = __APP_VERSION__ // from package.json — bump it on every release

// "View as client" — open the customer-facing diner app in a new tab.
function openClient() {
  window.open(DINER_APP_URL, '_blank', 'noopener')
}
</script>

<template>
  <button class="icon-btn" :aria-label="t('profile.title')" @click="open = true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </svg>
  </button>

  <Teleport to="body">
    <div v-if="open" class="pm-backdrop" @click.self="open = false">
      <div class="pm-panel" role="dialog" aria-modal="true">
        <div class="pm-head">
          <strong>{{ restaurant ? restaurant.name : t('profile.title') }}</strong>
          <span>{{ t('app.tagline') }}</span>
        </div>

        <!-- Moderator-only: preview the app as an owner, or open the client app -->
        <div v-if="isModerator" class="pm-section">
          <span class="pm-label">{{ t('viewAs.label') }}</span>
          <div class="pm-seg">
            <button type="button" :class="{ on: !asOwner }" @click="asOwner = false">
              {{ t('viewAs.moderator') }}
            </button>
            <button type="button" :class="{ on: asOwner }" @click="asOwner = true">
              {{ t('viewAs.owner') }}
            </button>
          </div>
          <button type="button" class="pm-viewclient" @click="openClient">
            {{ t('viewAs.client') }} ↗
          </button>
        </div>

        <div class="pm-section">
          <span class="pm-label">{{ t('profile.textSize') }}</span>
          <div class="pm-size">
            <button type="button" @click="smaller" :aria-label="t('profile.smaller')">A−</button>
            <button type="button" class="mid" @click="resetSize">A</button>
            <button type="button" @click="larger" :aria-label="t('profile.larger')">A+</button>
          </div>
          <span class="pm-scale">{{ Math.round(fontScale * 100) }}%</span>
        </div>

        <div class="pm-section pm-section--row">
          <span class="pm-label">{{ t('profile.language') }}</span>
          <select class="pm-select" :value="locale" @change="setLocale($event.target.value)">
            <option v-for="l in SUPPORTED_LOCALES" :key="l" :value="l">{{ t('lang.' + l) }}</option>
          </select>
        </div>

        <div class="pm-section pm-section--row">
          <span class="pm-label">{{ t('profile.theme') }}</span>
          <div class="pm-seg" role="group" :aria-label="t('profile.theme')">
            <button type="button" :class="{ on: themeMode === 'light' }"
              @click="setTheme('light')">{{ t('profile.themeLight') }}</button>
            <button type="button" :class="{ on: themeMode === 'dark' }"
              @click="setTheme('dark')">{{ t('profile.themeDark') }}</button>
            <button type="button" :class="{ on: themeMode === 'auto' }"
              @click="setTheme('auto')">{{ t('profile.themeAuto') }}</button>
          </div>
        </div>

        <!-- Push notifications (scaffold ready / failed). Registers THIS
             device so the alerts can actually reach it. -->
        <div v-if="isModerator && pushSupported" class="pm-section">
          <span class="pm-label">{{ t('profile.notifications') }}</span>
          <button
            type="button"
            class="pm-toggle"
            :class="{ on: pushSubscribed }"
            :disabled="pushBusy"
            @click="toggleNotif"
          >
            <span>{{ t('profile.notifPush') }}</span>
            <span class="pm-switch" :class="{ on: pushSubscribed }"><span class="pm-knob"></span></span>
          </button>
        </div>

        <button class="pm-signout" type="button" @click="open = false; emit('signout')">
          {{ t('common.signOut') }}
        </button>

        <div class="pm-version">v{{ version }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(20, 12, 14, 0.42);
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: calc(env(safe-area-inset-top) + 60px) 14px;
}
.pm-panel {
  width: 100%;
  max-width: 290px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}
.pm-head {
  padding: 16px 18px;
  background: linear-gradient(135deg, #9e053d, #6f032b);
  color: #fff;
}
.pm-head strong {
  font-family: 'Rufina', serif;
  font-size: 1.1rem;
  display: block;
  line-height: 1.15;
}
.pm-head span {
  font-size: 0.6rem;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  opacity: 0.85;
}
.pm-section {
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}
.pm-label {
  display: block;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mut);
  margin-bottom: 9px;
}
.pm-size {
  display: flex;
  gap: 6px;
}
.pm-size button {
  flex: 1;
  padding: 9px 0;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
  color: var(--ink);
  font-weight: 700;
  cursor: pointer;
}
.pm-size button:active { transform: scale(0.96); }
.pm-size button:nth-child(1) { font-size: 0.82rem; }
.pm-size button.mid { font-size: 1rem; }
.pm-size button:nth-child(3) { font-size: 1.15rem; }
.pm-scale {
  display: block;
  text-align: center;
  font-size: 0.7rem;
  color: var(--mut);
  margin-top: 8px;
}
/* Compact one-line language picker (native dropdown — mobile friendly). */
.pm-section--row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pm-section--row .pm-label { margin-bottom: 0; }
.pm-select {
  flex: 0 0 auto;
  max-width: 62%;
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 8px 10px;
  cursor: pointer;
}
/* Three-state theme segmented control (light / dark / auto). */
.pm-seg {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 9px;
  overflow: hidden;
  background: var(--surface);
}
.pm-seg button {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--mut);
  padding: 7px 12px;
  cursor: pointer;
  border-right: 1px solid var(--line);
  letter-spacing: 0.01em;
}
.pm-seg button:last-child { border-right: 0; }
.pm-seg button.on {
  background: var(--accent);
  color: #fff;
}
.pm-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 4px 2px;
  border: 0;
  background: none;
  font-family: inherit;
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}
.pm-toggle:disabled { opacity: 0.55; cursor: progress; }
.pm-switch {
  flex: 0 0 auto;
  width: 42px;
  height: 24px;
  border-radius: 12px;
  background: var(--line);
  position: relative;
  transition: background 0.18s;
}
.pm-switch.on { background: var(--accent); }
.pm-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  transition: transform 0.18s;
}
.pm-switch.on .pm-knob { transform: translateX(18px); }
.pm-seg {
  display: flex;
  border: 1px solid var(--line);
  border-radius: 9px;
  overflow: hidden;
}
.pm-seg button {
  flex: 1;
  padding: 9px 0;
  border: 0;
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-weight: 700;
  font-size: 0.82rem;
  cursor: pointer;
}
.pm-seg button + button { border-left: 1px solid var(--line); }
.pm-seg button.on { background: var(--accent); color: #fff; }
.pm-viewclient {
  width: 100%;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-weight: 600;
  font-size: 0.84rem;
  text-align: left;
  cursor: pointer;
}
.pm-viewclient:active { background: var(--surface-2); }
.pm-signout {
  width: 100%;
  padding: 14px;
  border: 0;
  background: var(--surface);
  color: var(--danger);
  font-family: inherit;
  font-weight: 700;
  font-size: 0.88rem;
  cursor: pointer;
}
.pm-signout:active { background: var(--surface-2); }
.pm-version {
  padding: 9px 18px 11px;
  text-align: center;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink);
  border-top: 1px solid var(--line);
}
</style>
