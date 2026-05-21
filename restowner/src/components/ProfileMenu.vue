<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiPrefs } from '../composables/usePrefs'
import { SUPPORTED_LOCALES } from '../i18n'

defineProps({ restaurant: { type: Object, default: null } })
const emit = defineEmits(['signout'])

const { t } = useI18n()
const { fontScale, locale, larger, smaller, resetSize, setLocale } = useUiPrefs()
const open = ref(false)
const version = __APP_VERSION__ // from package.json — bump it on every release
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

        <div class="pm-section">
          <span class="pm-label">{{ t('profile.textSize') }}</span>
          <div class="pm-size">
            <button type="button" @click="smaller" :aria-label="t('profile.smaller')">A−</button>
            <button type="button" class="mid" @click="resetSize">A</button>
            <button type="button" @click="larger" :aria-label="t('profile.larger')">A+</button>
          </div>
          <span class="pm-scale">{{ Math.round(fontScale * 100) }}%</span>
        </div>

        <div class="pm-section">
          <span class="pm-label">{{ t('profile.language') }}</span>
          <div class="pm-langs">
            <button
              v-for="l in SUPPORTED_LOCALES"
              :key="l"
              type="button"
              :class="{ on: locale === l }"
              @click="setLocale(l)"
            >{{ t('lang.' + l) }}</button>
          </div>
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
.pm-langs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pm-langs button {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  font-size: 0.88rem;
  text-align: left;
  cursor: pointer;
}
.pm-langs button.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
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
.pm-signout:active { background: #faf4ea; }
.pm-version {
  padding: 9px 18px 11px;
  text-align: center;
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  color: var(--mut);
  border-top: 1px solid var(--line);
}
</style>
