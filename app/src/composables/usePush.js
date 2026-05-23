// Web-Push subscribe flow, factored out so anyone (onboarding, the
// auto-prompt modal, the Agenda banner) can call it from a user-gesture
// handler and get identical behaviour.
import { ref, computed, onMounted } from 'vue'
import { registerPushSubscription } from '../lib/api'

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim()

// Base64URL → Uint8Array. PushManager.subscribe() needs the public key
// in that form.
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Module-level singletons so usePush() consumers share the same state
// (a subscribe in one component flips `subscribed` in every other).
const supported = ref(false)
const permission = ref('default')
const isiOS = ref(false)
const isStandalone = ref(false)
const subscribed = ref(false)
let detected = false

async function detect() {
  if (detected) return
  supported.value = typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  if (supported.value) permission.value = Notification.permission
  isiOS.value = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
  isStandalone.value = typeof window !== 'undefined' && (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
  if (supported.value) {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      subscribed.value = !!sub
    } catch { /* ignore */ }
  }
  detected = true
}

export function usePush() {
  onMounted(detect)

  // iOS only delivers Web-Push when the PWA is launched from the Home
  // Screen (display-mode: standalone). In a regular Safari tab, the
  // permission prompt would either fail outright or have no delivery
  // path — better to suppress the ask there and steer them to install.
  const canPrompt = computed(() =>
    supported.value && !!VAPID_PUBLIC_KEY && (!isiOS.value || isStandalone.value)
  )
  const needsInstallFirst = computed(() => isiOS.value && !isStandalone.value)

  /**
   * Run the full subscribe flow. MUST be invoked from a user-gesture
   * handler — Notification.requestPermission() rejects otherwise on
   * Safari and Chrome.
   *
   *  returns true  → subscription exists & is registered server-side
   *  returns false → blocked, denied, unsupported, or no profile yet
   */
  async function subscribeIfPossible(profileId) {
    if (!supported.value || !VAPID_PUBLIC_KEY || !profileId) return false
    if (needsInstallFirst.value) return false
    if (permission.value === 'denied') return false

    if (permission.value !== 'granted') {
      permission.value = await Notification.requestPermission()
      if (permission.value !== 'granted') return false
    }

    try {
      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        })
      }
      const res = await registerPushSubscription(profileId, sub, navigator.userAgent)
      if (!res.ok) return false
      subscribed.value = true
      return true
    } catch {
      return false
    }
  }

  return {
    supported, permission, isiOS, isStandalone, subscribed,
    canPrompt, needsInstallFirst, subscribeIfPossible
  }
}
