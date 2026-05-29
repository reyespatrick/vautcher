// Web-Push subscribe flow for restowner admins/moderators. Subscribes this
// device and registers it server-side (keyed by the JWT email) so the
// scaffold-done notifier can reach the admin who created a site.
import { ref } from 'vue'
import { supabase } from '../lib/supabase'

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim()

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const supported = ref(false)
const permission = ref('default')
const subscribed = ref(false)
let detected = false

async function detect() {
  supported.value = typeof window !== 'undefined' &&
    'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
  if (supported.value) {
    permission.value = Notification.permission
    try {
      const reg = await navigator.serviceWorker.ready
      subscribed.value = !!(await reg.pushManager.getSubscription())
    } catch { /* ignore */ }
  }
  detected = true
}

export function usePushAdmin() {
  if (!detected) detect()

  // MUST be called from a user gesture (permission prompt requirement).
  async function enable() {
    await detect()
    if (!supported.value || !VAPID_PUBLIC_KEY) return { ok: false, reason: 'unsupported' }
    if (permission.value === 'denied') return { ok: false, reason: 'denied' }
    if (permission.value !== 'granted') {
      permission.value = await Notification.requestPermission()
      if (permission.value !== 'granted') return { ok: false, reason: 'denied' }
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
      const json = sub.toJSON()
      const { error } = await supabase.rpc('vautcher_register_admin_push', {
        p_endpoint: sub.endpoint,
        p_p256dh: json.keys?.p256dh,
        p_auth: json.keys?.auth,
        p_user_agent: navigator.userAgent
      })
      if (error) return { ok: false, reason: error.message }
      subscribed.value = true
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: String(e?.message ?? e) }
    }
  }

  return { supported, permission, subscribed, enable }
}
