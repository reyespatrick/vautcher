<script setup>
// Auto-opening modal that asks for notification permission on first
// app launch when the user has already onboarded but never enrolled
// in push (e.g. they installed the PWA before the push feature shipped).
//
// MUST be triggered from a user gesture for the iOS permission dialog
// to appear — so the Activer button is the gesture. We don't try to
// auto-call requestPermission() on mount, only auto-SHOW the modal.
import { computed, onMounted, ref } from 'vue'
import { usePush } from '../composables/usePush'
import { useProfile } from '../composables/useProfile'

const { profile } = useProfile()
const { supported, permission, isStandalone, subscribed, canPrompt, subscribeIfPossible } = usePush()

const DISMISS_KEY = 'lagioconda.notifyPromptDismissed'
const dismissed = ref(false)
const busy = ref(false)

onMounted(() => {
  try { dismissed.value = localStorage.getItem(DISMISS_KEY) === '1' } catch { /* ignore */ }
})

const show = computed(() =>
  !!profile.value &&
  supported.value &&
  isStandalone.value &&            // only inside the installed PWA
  permission.value === 'default' && // not yet asked
  !subscribed.value &&
  !dismissed.value &&
  canPrompt.value
)

async function activate() {
  if (busy.value) return
  busy.value = true
  try {
    await subscribeIfPossible(profile.value.id)
  } finally {
    busy.value = false
  }
}
function postpone() {
  dismissed.value = true
  try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
}
</script>

<template>
  <div v-if="show" class="overlay">
    <div class="dialog" role="dialog" aria-modal="true">
      <span class="ico">🔔</span>
      <h2>Activer les notifications</h2>
      <p>
        Soyez prévenu·e dès qu'un nouvel événement est annoncé, ou avant
        un événement auquel vous participez.
      </p>
      <button class="btn" type="button" :disabled="busy" @click="activate">
        {{ busy ? '…' : 'Activer' }}
      </button>
      <button class="link" type="button" @click="postpone">Plus tard</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 280;          /* below OnboardingDialog (300) but above app */
  background: rgba(15, 0, 6, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  backdrop-filter: blur(2px);
}
.dialog {
  width: 100%;
  max-width: 360px;
  background: #fff;
  border-radius: 14px;
  padding: 32px 28px 22px;
  text-align: center;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
  animation: pop 0.22s ease;
}
@keyframes pop {
  from { opacity: 0; transform: translateY(14px) scale(0.97); }
  to { opacity: 1; transform: none; }
}
.ico { font-size: 2.4rem; display: inline-block; margin-bottom: 6px; }
h2 { font-size: 1.35rem; color: var(--burgundy); margin-bottom: 8px; }
p {
  color: var(--grey);
  font-size: 0.92rem;
  line-height: 1.5;
  margin-bottom: 20px;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  border: 0;
  border-radius: 10px;
  background: var(--burgundy);
  color: #fff;
  font-family: inherit;
  font-weight: 700;
  font-size: 0.86rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 14px 22px;
  cursor: pointer;
}
.btn:hover { background: var(--burgundy-dark); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.link {
  display: block;
  background: none;
  border: 0;
  color: var(--grey);
  font-size: 0.86rem;
  margin: 12px auto 0;
  text-decoration: underline;
  cursor: pointer;
}
.link:hover { color: var(--burgundy); }
</style>
