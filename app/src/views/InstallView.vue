<script setup>
// Customer-facing install landing — the target of the "App client" QR in
// restowner. Detects the platform: Android → one install button; iOS →
// Add-to-Home-Screen steps. Branded with the tenant's identity.
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { site } from '../data/site'
import { usePwaInstall } from '../composables/usePwaInstall'

const { install, platform, standalone, installed } = usePwaInstall()
const busy = ref(false)
const showFallback = ref(false)

const name = computed(() => site.name || 'notre application')
const initial = computed(() => (site.name || '?').trim().charAt(0).toUpperCase())

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
      <div class="badge">{{ initial }}</div>
      <h1>{{ name }}</h1>
      <p class="sub">Ajoutez notre application à votre écran d’accueil pour retrouver nos événements et votre carte de fidélité en un geste.</p>

      <!-- Already installed / running standalone -->
      <div v-if="standalone || installed" class="done">
        Application déjà installée.
        <RouterLink class="btn-main" :to="{ name: 'home' }">Ouvrir</RouterLink>
      </div>

      <!-- iOS — Add to Home Screen instructions -->
      <div v-else-if="platform.iOS" class="ios">
        <h2>Installer sur iPhone</h2>
        <ol class="steps">
          <li>
            <span class="step-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M8.5 7.5 12 4l3.5 3.5"/><path d="M6 12v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-6"/></svg>
            </span>
            <span>Touchez le bouton <b>Partager</b> dans la barre de Safari.</span>
          </li>
          <li>
            <span class="step-ic"><b>+</b></span>
            <span>Choisissez <b>Sur l’écran d’accueil</b>.</span>
          </li>
          <li>
            <span class="step-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-11"/></svg>
            </span>
            <span>Touchez <b>Ajouter</b> — c’est prêt !</span>
          </li>
        </ol>
      </div>

      <!-- Android / others — one button -->
      <div v-else class="android">
        <button class="btn-main" :disabled="busy" @click="onInstall">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>
          Installer l’application
        </button>
        <p v-if="showFallback || platform.desktop" class="fallback">
          {{ platform.desktop
            ? 'Sur ordinateur, utilisez le menu de votre navigateur puis « Installer l’application ».'
            : 'Si rien ne se passe, ouvrez le menu de votre navigateur puis « Ajouter à l’écran d’accueil ».' }}
        </p>
      </div>

      <RouterLink class="skip" :to="{ name: 'home' }">Continuer sans installer →</RouterLink>
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
  border-top: 5px solid var(--burgundy, #9e053d);
  padding: 34px 30px 26px; text-align: center;
}
.badge {
  width: 84px; height: 84px; margin: 0 auto; border-radius: 22px;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Rufina', Georgia, serif; font-weight: 700; font-size: 2.4rem; color: #fff;
  background: var(--burgundy, #9e053d);
  box-shadow: 0 8px 22px rgba(158, 5, 61, 0.28);
}
h1 { font-family: 'Rufina', Georgia, serif; font-size: 1.6rem; color: var(--burgundy, #9e053d); margin: 16px 0 0; line-height: 1.15; }
.sub { color: #6b5b5f; font-size: 0.95rem; line-height: 1.5; margin: 10px 0 24px; }
.btn-main {
  display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  width: 100%; font-family: inherit; font-weight: 700; font-size: 1rem;
  color: #fff; background: var(--burgundy, #9e053d); border: 0; border-radius: 14px;
  padding: 16px; cursor: pointer; text-decoration: none;
  box-shadow: 0 8px 20px rgba(158, 5, 61, 0.3);
}
.btn-main:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-main svg { width: 20px; height: 20px; }
.fallback { color: #6b5b5f; font-size: 0.85rem; line-height: 1.5; margin-top: 16px; }
h2 { font-family: 'Rufina', Georgia, serif; font-size: 1.15rem; color: #2a2126; margin-bottom: 16px; }
.steps { list-style: none; text-align: left; display: flex; flex-direction: column; gap: 16px; padding: 0; margin: 0; }
.steps li { display: flex; align-items: center; gap: 14px; font-size: 0.95rem; line-height: 1.4; color: #2a2126; }
.step-ic {
  width: 42px; height: 42px; flex: 0 0 auto; border-radius: 12px;
  background: rgba(158, 5, 61, 0.08); color: var(--burgundy, #9e053d);
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px;
}
.step-ic svg { width: 22px; height: 22px; }
.done { color: #2a2126; font-size: 0.95rem; line-height: 1.5; }
.done .btn-main { margin-top: 18px; }
.skip { display: inline-block; margin-top: 22px; color: #6b5b5f; font-size: 0.84rem; font-weight: 600; text-decoration: none; }
.skip:hover { color: var(--burgundy, #9e053d); }
</style>
