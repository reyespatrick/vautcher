<script setup>
// Customer-facing install landing — the target of the "App client" QR in
// restowner. iOS sees French add-to-home-screen instructions. Android
// goes straight to the app (Chrome shows its own install banner when the
// PWA is installable). Branded with the tenant's identity.
import { ref, computed, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { site } from '../data/site'
import { usePwaInstall } from '../composables/usePwaInstall'

const router = useRouter()
const { platform, standalone, installed } = usePwaInstall()

// Android scanners land in the app directly — Chrome offers its own
// install affordance when the criteria are met, no walkthrough needed.
onMounted(() => {
  if (!standalone && !installed.value && platform.android) {
    router.replace({ name: 'home' })
  }
})

const name = computed(() => site.name || 'notre application')
const initial = computed(() => (site.name || '?').trim().charAt(0).toUpperCase())
</script>

<template>
  <div class="install">
    <div class="card">
      <div class="badge">{{ initial }}</div>
      <h1>{{ name }}</h1>
      <p class="sub">Ajoutez notre application à votre écran d’accueil pour retrouver nos événements et votre carte de fidélité en un geste.</p>

      <!-- Already installed / running standalone -->
      <div v-if="standalone || installed" class="done">
        L’application est déjà installée sur cet appareil.
        <RouterLink class="btn-main" :to="{ name: 'home' }">Ouvrir l’application</RouterLink>
      </div>

      <!-- iOS — three-step add-to-home-screen walkthrough -->
      <div v-else-if="platform.iOS" class="ios">
        <h2>Installer sur iPhone</h2>
        <p class="ios-intro">Trois petits gestes — c’est tout :</p>
        <ol class="steps">
          <li>
            <span class="step-n">1</span>
            <span class="step-txt">
              Dans Safari, touchez l’icône <b>Partager</b>
              <svg class="inline-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 3v13"/><path d="M8 7l4-4 4 4"/>
                <path d="M6 11v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-9"/>
              </svg>
              en bas de l’écran.
            </span>
          </li>
          <li>
            <span class="step-n">2</span>
            <span class="step-txt">
              Faites défiler et choisissez
              <b>« Sur l’écran d’accueil »</b>
              <svg class="inline-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="4"/>
                <path d="M12 9v6M9 12h6"/>
              </svg>.
            </span>
          </li>
          <li>
            <span class="step-n">3</span>
            <span class="step-txt">
              Touchez <b>« Ajouter »</b> en haut à droite. L’application apparaît sur votre écran d’accueil ✨
            </span>
          </li>
        </ol>
      </div>

      <!-- Desktop fallback (Android scanners are auto-redirected above) -->
      <div v-else class="desktop">
        <p class="fallback">Pour ajouter l’application, utilisez le menu de votre navigateur puis <b>« Installer l’application »</b> ou <b>« Ajouter à l’écran d’accueil »</b>.</p>
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
h2 { font-family: 'Rufina', Georgia, serif; font-size: 1.25rem; color: #2a2126; margin: 4px 0 6px; }
.ios-intro { color: #6b5b5f; font-size: 0.88rem; margin: 0 0 14px; }
.steps { list-style: none; text-align: left; display: flex; flex-direction: column; gap: 14px; padding: 0; margin: 0; }
.steps li { display: flex; align-items: flex-start; gap: 12px; font-size: 0.96rem; line-height: 1.5; color: #2a2126; }
.step-n {
  flex: 0 0 auto;
  width: 30px; height: 30px; border-radius: 50%;
  background: var(--burgundy, #9e053d); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Rufina', Georgia, serif; font-weight: 700; font-size: 0.95rem;
  margin-top: 1px;
}
.step-txt { flex: 1 1 auto; }
.step-txt b { color: #2a2126; }
.inline-ic {
  display: inline-block;
  width: 18px; height: 18px;
  vertical-align: -4px;
  color: var(--burgundy, #9e053d);
  margin: 0 2px;
}
.done { color: #2a2126; font-size: 0.95rem; line-height: 1.5; }
.done .btn-main { margin-top: 18px; }
.skip { display: inline-block; margin-top: 22px; color: #6b5b5f; font-size: 0.84rem; font-weight: 600; text-decoration: none; }
.skip:hover { color: var(--burgundy, #9e053d); }
</style>
