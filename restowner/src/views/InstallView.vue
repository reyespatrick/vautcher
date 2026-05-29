<script setup>
// Public install landing — scanned from the QR. iOS sees a polished
// add-to-home-screen walkthrough. Android scanners are forwarded straight
// to the app root (Chrome offers its own install banner).
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePwaInstall } from '../composables/usePwaInstall'

const router = useRouter()
const { t } = useI18n()
const { platform, standalone, installed } = usePwaInstall()

onMounted(() => {
  if (!standalone && !installed.value && platform.android) {
    router.replace('/')
  }
})
</script>

<template>
  <div class="install">
    <div class="card">
      <img class="app-icon" src="/icon-192.png" alt="restowner" />
      <h1>restowner</h1>
      <p class="sub">{{ t('install.subtitle') }}</p>

      <!-- Already installed / running standalone -->
      <div v-if="standalone || installed" class="done">
        {{ t('install.installed') }}
        <a class="btn-main" href="/">{{ t('install.open') }}</a>
      </div>

      <!-- iOS — Add to Home Screen walkthrough (numbered circles + an
           inline iOS-style "Partager" glyph). -->
      <div v-else-if="platform.iOS" class="ios">
        <h2>{{ t('install.iosTitle') }}</h2>
        <ol class="steps">
          <li>
            <span class="step-n">1</span>
            <span class="step-txt">{{ t('install.iosStep1') }}
              <svg class="inline-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 3v13"/><path d="M8 7l4-4 4 4"/>
                <path d="M6 11v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-9"/>
              </svg>
            </span>
          </li>
          <li>
            <span class="step-n">2</span>
            <span class="step-txt">{{ t('install.iosStep2') }}</span>
          </li>
          <li>
            <span class="step-n">3</span>
            <span class="step-txt">{{ t('install.iosStep3') }}</span>
          </li>
        </ol>
      </div>

      <!-- Desktop fallback (Android scanners are auto-forwarded above) -->
      <div v-else class="desktop">
        <p class="fallback">{{ t('install.desktopHint') }}</p>
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

h2 { font-family: 'Rufina', serif; font-size: 1.25rem; color: var(--ink); margin: 4px 0 12px; }
.steps { list-style: none; text-align: left; display: flex; flex-direction: column; gap: 14px; padding: 0; }
.steps li { display: flex; align-items: flex-start; gap: 12px; font-size: 0.96rem; line-height: 1.5; color: var(--ink); }
.step-n {
  flex: 0 0 auto;
  width: 30px; height: 30px; border-radius: 50%;
  background: var(--accent); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Rufina', serif; font-weight: 700; font-size: 0.95rem;
  margin-top: 1px;
}
.step-txt { flex: 1 1 auto; }
.inline-ic {
  display: inline-block;
  width: 18px; height: 18px;
  vertical-align: -4px;
  color: var(--accent);
  margin: 0 2px;
}

.done { color: var(--ink); font-size: 0.95rem; line-height: 1.5; }
.done .btn-main { margin-top: 18px; }

.foot { margin-top: 24px; font-size: 0.78rem; color: var(--mut); }
</style>
