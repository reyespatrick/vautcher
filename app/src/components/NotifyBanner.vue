<script setup>
import { ref } from 'vue'
import { site } from '../data/site'
import { useProfile } from '../composables/useProfile'
import { usePush } from '../composables/usePush'

const { profile } = useProfile()
const {
  supported, permission, subscribed, needsInstallFirst, subscribeIfPossible
} = usePush()

const busy = ref(false)
const message = ref('')

async function showSample() {
  const reg = await navigator.serviceWorker.ready
  await reg.showNotification(site.name, {
    body: 'Vous serez prévenu·e quand le restaurant annonce un événement.',
    icon: site.logoUrl,
    badge: site.logoUrl,
    data: { url: '/evenements' },
    tag: 'vautcher-sample'
  })
}

async function onClick() {
  message.value = ''
  if (!supported.value) {
    message.value = 'Les notifications ne sont pas supportées sur ce navigateur.'
    return
  }
  if (needsInstallFirst.value) {
    message.value =
      'Sur iPhone : ajoutez d’abord l’app à l’écran d’accueil (Partager → Sur l’écran d’accueil), puis réessayez.'
    return
  }
  if (!profile.value?.id) {
    message.value = 'Renseignez d’abord votre profil.'
    return
  }
  busy.value = true
  try {
    const ok = await subscribeIfPossible(profile.value.id)
    if (ok) {
      await showSample()
      message.value = '✓ Vous êtes inscrit·e — les futurs événements vous seront notifiés.'
    } else if (permission.value === 'denied') {
      message.value = 'Notifications refusées — réactivez-les dans les réglages de votre téléphone.'
    }
  } catch (e) {
    message.value = 'Inscription au push impossible : ' + (e?.message || e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="notify card">
    <span class="bell">🔔</span>
    <div class="notify-text">
      <strong>Ne manquez aucun événement</strong>
      <span>Recevez une alerte quand le restaurant annonce une soirée.</span>
    </div>
    <button class="notify-btn" :disabled="busy" @click="onClick">
      {{ subscribed ? 'Activé ✓' : (permission === 'granted' ? 'S\'inscrire' : 'Activer') }}
    </button>
  </div>
  <p v-if="message" class="notify-msg">{{ message }}</p>
</template>

<style scoped>
.notify {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.bell { font-size: 1.6rem; flex: 0 0 auto; }
.notify-text { flex: 1; display: flex; flex-direction: column; line-height: 1.3; }
.notify-text strong { font-family: 'Rufina', serif; font-size: 1.05rem; }
.notify-text span { font-size: 0.82rem; color: var(--grey); }
.notify-btn {
  flex: 0 0 auto;
  border: 0;
  border-radius: 8px;
  background: var(--burgundy);
  color: #fff;
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 11px 18px;
  cursor: pointer;
  transition: background 0.15s;
}
.notify-btn:hover { background: var(--burgundy-dark); }
.notify-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.notify-msg {
  text-align: center;
  font-size: 0.82rem;
  color: var(--grey);
  margin-top: 10px;
}
</style>
