<script setup>
// Mandatory pre-onboarding gate. Layered ABOVE OnboardingDialog so it
// is the very first thing a diner sees when the PWA cold-launches.
// One button: Activer. Tapping it gives us the user-gesture we need
// to call Notification.requestPermission(); regardless of grant/deny
// the modal disappears (the iOS prompt only fires once anyway) and
// onboarding becomes visible underneath.
//
// The server-side registerPushSubscription() happens later, in the
// OnboardingDialog submit handler — once a profile_id exists.
//
// For diners who launched the PWA before this feature shipped (profile
// already exists, never enrolled), the same modal completes the full
// subscribe right here.
import { computed, ref } from 'vue'
import { usePush } from '../composables/usePush'
import { useProfile } from '../composables/useProfile'

const { profile } = useProfile()
const {
  supported, permission, subscribed,
  canPrompt, requestPermission, subscribeIfPossible
} = usePush()

const busy = ref(false)

// Show only when push is actually usable here (canPrompt already
// requires standalone on iOS), the user hasn't been asked yet
// (permission === 'default'), and they aren't already subscribed.
// Both pre-login (no profile) and post-login (profile but never
// enrolled) qualify — same one-button UX either way.
const show = computed(() =>
  supported.value &&
  canPrompt.value &&
  permission.value === 'default' &&
  !subscribed.value
)

async function activate() {
  if (busy.value) return
  busy.value = true
  try {
    if (profile.value?.id) {
      // Returning user with a profile — do the full enrollment now.
      await subscribeIfPossible(profile.value.id)
    } else {
      // No profile yet — only ask for permission. The subscribe + server
      // registration completes inside OnboardingDialog.submit() once the
      // diner finishes filling the form.
      await requestPermission()
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="show" class="overlay">
    <div class="dialog" role="dialog" aria-modal="true">
      <span class="ico">🔔</span>
      <h2>Restez informé·e</h2>
      <p>
        Activez les notifications pour ne manquer aucun événement du
        restaurant.
      </p>
      <button class="btn" type="button" :disabled="busy" @click="activate">
        {{ busy ? '…' : 'Activer les notifications' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  /* Above OnboardingDialog (z-index 300) so this is the FIRST modal
     the diner interacts with on cold launch. */
  z-index: 360;
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
  padding: 32px 28px 28px;
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
  margin-bottom: 22px;
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
</style>
