<script setup>
import { ref, onMounted, computed } from 'vue'
import { site } from '../data/site'
import { useProfile } from '../composables/useProfile'
import { registerPushSubscription } from '../lib/api'

const { profile } = useProfile()

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim()

const supported = ref(false)
const permission = ref('default')
const isiOS = ref(false)
const isStandalone = ref(false)
const busy = ref(false)
const message = ref('')
const subscribed = ref(false)

onMounted(async () => {
  supported.value = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
  if (supported.value) {
    permission.value = Notification.permission
    // Already subscribed on this device?
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      subscribed.value = !!sub
    } catch { /* ignore */ }
  }
  isiOS.value = /iphone|ipad|ipod/i.test(navigator.userAgent)
  isStandalone.value =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
})

// iOS only delivers push to a PWA added to the Home Screen.
const iosNeedsInstall = computed(() => isiOS.value && !isStandalone.value)

// Standard helper to convert the VAPID public key (base64url) into the
// Uint8Array pushManager.subscribe() wants.
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function subscribeAndRegister() {
  if (!VAPID_PUBLIC_KEY) {
    message.value = 'Push non configuré sur ce build.'
    return false
  }
  if (!profile.value?.id) {
    message.value = 'Renseignez d’abord votre profil.'
    return false
  }
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    })
  }
  const res = await registerPushSubscription(profile.value.id, sub, navigator.userAgent)
  if (!res.ok) {
    message.value = 'Inscription au push impossible : ' + (res.error || 'erreur réseau')
    return false
  }
  subscribed.value = true
  return true
}

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
    if (permission.value !== 'granted') {
      if (permission.value === 'denied') {
        message.value = 'Notifications refusées — réactivez-les dans les réglages de votre téléphone.'
      }
      return
    }
    const ok = await subscribeAndRegister()
    if (ok) {
      await showSample()
      message.value = '✓ Vous êtes inscrit·e — les futurs événements vous seront notifiés.'
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
