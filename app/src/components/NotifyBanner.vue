<script setup>
import { ref, onMounted, computed } from 'vue'
import { site } from '../data/site'

const supported = ref(false)
const permission = ref('default')
const isiOS = ref(false)
const isStandalone = ref(false)
const busy = ref(false)
const message = ref('')

onMounted(() => {
  supported.value = 'Notification' in window && 'serviceWorker' in navigator
  if (supported.value) permission.value = Notification.permission
  isiOS.value = /iphone|ipad|ipod/i.test(navigator.userAgent)
  isStandalone.value =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
})

// iOS only delivers push to a PWA added to the Home Screen.
const iosNeedsInstall = computed(() => isiOS.value && !isStandalone.value)

async function showSample() {
  const reg = await navigator.serviceWorker.ready
  await reg.showNotification(site.name, {
    body: 'Une nouvelle proposition vous attend — ouvrez l’app pour la découvrir.',
    icon: site.logoUrl,
    badge: site.logoUrl,
    image: site.gallery?.[0]?.src || site.logoUrl,
    data: { url: '/evenements' },
    tag: 'vautcher-sample'
  })
  message.value = '✓ Notification envoyée — regardez l’écran de votre téléphone.'
}

async function onClick() {
  message.value = ''
  if (!supported.value) {
    message.value = 'Les notifications ne sont pas supportées sur ce navigateur.'
    return
  }
  if (iosNeedsInstall.value) {
    message.value =
      'Sur iPhone : ajoutez d’abord l’app à l’écran d’accueil (Partager → Sur l’écran d’accueil), puis réessayez.'
    return
  }
  busy.value = true
  try {
    if (permission.value !== 'granted') {
      permission.value = await Notification.requestPermission()
    }
    if (permission.value === 'granted') {
      await showSample()
    } else if (permission.value === 'denied') {
      message.value = 'Notifications refusées — réactivez-les dans les réglages de votre téléphone.'
    }
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
      {{ permission === 'granted' ? 'Voir un exemple' : 'Activer' }}
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
