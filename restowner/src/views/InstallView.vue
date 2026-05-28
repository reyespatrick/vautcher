<script setup>
// Public install landing page (scanned from the QR in Admin). Detects the
// platform: Android → one install button; iOS → Add-to-Home-Screen steps.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePwaInstall } from '../composables/usePwaInstall'

const { t } = useI18n()
const { install, platform, standalone, installed } = usePwaInstall()

const busy = ref(false)
const showFallback = ref(false)

async function onInstall() {
  if (busy.value) return
  busy.value = true
  try {
    const res = await install()
    if (res.outcome === 'unavailable') showFallback.value = true
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="install">
    <div class="card">
      <img class="app-icon" src="/icon-192.png" alt="vautcher" />
      <h1>vautcher</h1>
      <p class="sub">{{ t('install.subtitle') }}</p>

      <!-- Already installed / running standalone -->
      <div v-if="standalone || installed" class="done">
        {{ t('install.installed') }}
        <a class="btn-main" href="/">{{ t('install.open') }}</a>
      </div>

      <!-- iOS — Add to Home Screen instructions -->
      <div v-else-if="platform.iOS" class="ios">
        <h2>{{ t('install.iosTitle') }}</h2>
        <ol class="steps">
          <li>
            <span class="step-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M8.5 7.5 12 4l3.5 3.5"/><path d="M6 12v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-6"/></svg>
            </span>
            <span>{{ t('install.iosStep1') }}</span>
          </li>
          <li>
            <span class="step-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 9v6M9 12h6"/></svg>
            </span>
            <span>{{ t('install.iosStep2') }}</span>
          </li>
          <li>
            <span class="step-ic"><b>+</b></span>
            <span>{{ t('install.iosStep3') }}</span>
          </li>
        </ol>
      </div>

      <!-- Android / others — one button -->
      <div v-else class="android">
        <button class="btn-main" :disabled="busy" @click="onInstall">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>
          {{ t('install.androidBtn') }}
        </button>
        <p v-if="showFallback || platform.desktop" class="fallback">
          {{ platform.desktop ? t('install.desktopHint') : t('install.androidFallback') }}
        </p>
      </div>

      <p class="foot">{{ t('install.foot') }}</p>
    </div>
  </div>
</template>

<style scoped>
.install {
  min-height: 100vh;
  background: radial-gradient(120% 80% at 50% 0%, #fbf3ea, #f1e6d6);
  display: flex; align-items: center; justify-content: center;
  padding: 28px 20px;
}
.card {
  width: 100%; max-width: 420px;
  background: #fff; border-radius: 22px;
  box-shadow: 0 24px 60px rgba(60, 20, 30, 0.16);
  border-top: 5px solid var(--accent);
  padding: 34px 30px 28px; text-align: center;
}
.app-icon {
  width: 92px; height: 92px; border-radius: 22px;
  box-shadow: 0 8px 22px rgba(158, 5, 61, 0.28);
}
h1 {
  font-family: 'Rufina', serif; font-size: 1.9rem; color: var(--accent);
  margin: 16px 0 0;
}
.sub { color: var(--mut); font-size: 0.95rem; line-height: 1.5; margin: 10px 0 24px; }

.btn-main {
  display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  width: 100%; font-family: inherit; font-weight: 700; font-size: 1rem;
  color: #fff; background: var(--accent); border: 0; border-radius: 14px;
  padding: 16px; cursor: pointer; text-decoration: none;
  box-shadow: 0 8px 20px rgba(158, 5, 61, 0.3);
  transition: filter 0.15s, opacity 0.15s;
}
.btn-main:hover { filter: brightness(1.06); }
.btn-main:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-main svg { width: 20px; height: 20px; }

.fallback { color: var(--mut); font-size: 0.85rem; line-height: 1.5; margin-top: 16px; }

h2 { font-family: 'Rufina', serif; font-size: 1.15rem; color: var(--ink); margin-bottom: 16px; }
.steps { list-style: none; text-align: left; display: flex; flex-direction: column; gap: 16px; }
.steps li { display: flex; align-items: center; gap: 14px; font-size: 0.95rem; line-height: 1.4; color: var(--ink); }
.step-ic {
  width: 42px; height: 42px; flex: 0 0 auto; border-radius: 12px;
  background: rgba(158, 5, 61, 0.08); color: var(--accent);
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px;
}
.step-ic svg { width: 22px; height: 22px; }

.done { color: var(--ink); font-size: 0.95rem; line-height: 1.5; }
.done .btn-main { margin-top: 18px; }

.foot { margin-top: 24px; font-size: 0.78rem; color: var(--mut); }
</style>
