<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'

const {
  session, owner, pendingOwner, isModerator,
  sendOtp, verifyOtp, rootLogin, requestAccess, refreshOwner, signOut
} = useAuth()
const router = useRouter()
const { t } = useI18n()
const version = __APP_VERSION__

const step = ref('email') // 'email' | 'code'
const email = ref('')
const code = ref('')
const error = ref('')
const busy = ref(false)

// While the owner waits on the "pending" screen, poll their approval
// status so the app drops them into the console the instant root approves
// — that IS the in-app notification of acceptance.
let pendingPoll = null
watch(pendingOwner, (p) => {
  if (p && !pendingPoll) {
    pendingPoll = setInterval(() => { refreshOwner() }, 5000)
  } else if (!p && pendingPoll) {
    clearInterval(pendingPoll); pendingPoll = null
  }
}, { immediate: true })
onBeforeUnmount(() => { if (pendingPoll) clearInterval(pendingPoll) })

async function onRequestAccess() {
  busy.value = true
  error.value = ''
  try {
    const { error: e } = await requestAccess()
    if (e) { error.value = e.message || String(e); return }
    await refreshOwner()  // flips the UI to the pending screen
  } catch (e) {
    error.value = (e && e.message) || String(e)
  } finally {
    busy.value = false
  }
}

watch([session, owner, isModerator], () => {
  if (session.value && (owner.value || isModerator.value)) {
    router.push({ name: owner.value ? 'dashboard' : 'approve' })
  }
})

async function onSendOtp() {
  const entry = email.value.trim()
  if (!entry) return
  busy.value = true
  error.value = ''
  try {
    // Dev-only "root" shortcut — also accept "root@anything" because
    // iOS autocomplete loves to append a domain to "root". Anything
    // that starts with "root" before an @ counts.
    if (/^root($|@)/i.test(entry)) {
      const { error: e } = await rootLogin()
      if (e) { error.value = e.message || t('login.codeInvalid'); return }
      return // the session watcher handles the redirect
    }
    const { error: e } = await sendOtp(entry)
    if (e) { error.value = e.message; return }
    step.value = 'code'
  } catch (e) {
    error.value = (e && e.message) || String(e)
  } finally {
    busy.value = false
  }
}

// Dedicated root login — one click, no typing, no autocomplete to
// worry about. Same backdoor as the typed shortcut.
async function onRootLogin() {
  busy.value = true
  error.value = ''
  try {
    const { error: e } = await rootLogin()
    if (e) { error.value = e.message || t('login.codeInvalid'); return }
  } catch (e) {
    error.value = (e && e.message) || String(e)
  } finally {
    busy.value = false
  }
}

async function onVerify() {
  if (!code.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    const { error: e } = await verifyOtp(email.value, code.value)
    if (e) { error.value = t('login.codeInvalid'); return }
  } catch (e) {
    error.value = t('login.codeInvalid')
  } finally {
    busy.value = false
  }
}

async function backToEmail() {
  step.value = 'email'
  code.value = ''
  error.value = ''
}

async function onSignOut() {
  await signOut()
  step.value = 'email'
  email.value = ''
  code.value = ''
  error.value = ''
}
</script>

<template>
  <div class="login-wrap">
    <div class="login card">
      <div class="login-brand">
        <img src="/icon-192.png" alt="" />
        <b>restowner</b>
        <small>{{ t('app.tagline') }} · v{{ version }}</small>
      </div>

      <!-- Signed in but the email is not (yet) an approved owner -->
      <div v-if="session && !owner" class="denied">
        <!-- Waiting for root to authorise this account. -->
        <template v-if="pendingOwner">
          <h2 class="pending-title">{{ t('login.pendingTitle') }}</h2>
          <p>{{ t('login.pendingBody') }}</p>
          <span class="pending-dot" aria-hidden="true"></span>
          <button class="btn btn--plain full" @click="onSignOut">{{ t('login.useAnother') }}</button>
        </template>
        <!-- Unknown email: offer to request owner access. -->
        <template v-else>
          <h2>{{ t('login.deniedTitle') }}</h2>
          <p>{{ t('login.deniedBody', { email: session.user.email }) }}</p>
          <button class="btn full request-access" :disabled="busy" @click="onRequestAccess">
            {{ busy ? t('login.requesting') : t('login.requestAccess') }}
          </button>
          <button class="btn btn--plain full" @click="onSignOut">{{ t('login.useAnother') }}</button>
        </template>
      </div>

      <!-- Step 1: email -->
      <form v-else-if="step === 'email'" @submit.prevent="onSendOtp">
        <h2>{{ t('login.title') }}</h2>
        <p class="sub">{{ t('login.subtitle') }}</p>
        <div class="field">
          <label>{{ t('login.email') }}</label>
          <input
            v-model="email" type="text" inputmode="email"
            autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false"
            :placeholder="t('login.emailPlaceholder')" required
          />
        </div>
        <button class="btn full" type="submit" :disabled="busy">
          {{ busy ? t('login.sending') : t('login.sendCode') }}
        </button>

        <button type="button" class="link" @click="router.push({ name: 'activate' })">
          {{ t('login.haveCode') }}
        </button>

        <!-- Dev-only one-click root login. Avoids typing 'root' into a
             field where iOS autocorrect / browser autocomplete can turn
             it into something else before the form submits. -->
        <button
          type="button" class="btn btn--plain btn--root full"
          :disabled="busy"
          @click="onRootLogin"
        >🔑 Entrer en root (dev)</button>
      </form>

      <!-- Step 2: code -->
      <form v-else @submit.prevent="onVerify">
        <h2>{{ t('login.codeTitle') }}</h2>
        <p class="sub">{{ t('login.codeSentTo', { email }) }}</p>
        <div class="field">
          <label>{{ t('login.code') }}</label>
          <input
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="••••••"
            class="code-input"
            required
          />
        </div>
        <button class="btn full" type="submit" :disabled="busy">
          {{ busy ? t('login.verifying') : t('login.verify') }}
        </button>
        <button type="button" class="link" @click="backToEmail">{{ t('login.changeEmail') }}</button>
      </form>

      <p v-if="error" class="err">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 22px;
  background: linear-gradient(165deg, #b3074a 0%, #6f032b 55%, #420320 100%);
}
.login {
  width: 100%;
  max-width: 360px;
  padding: 32px 26px 26px;
}
.login-brand { text-align: center; margin-bottom: 24px; }
.login-brand img {
  height: 58px; width: 58px;
  border-radius: 14px;
  margin: 0 auto 10px;
  object-fit: cover;
  box-shadow: 0 6px 18px rgba(158, 5, 61, 0.3);
}
.login-brand b {
  font-family: 'Rufina', serif;
  font-size: 1.5rem;
  display: block;
  color: var(--accent-dark);
}
.login-brand small {
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--mut);
}
h2 { font-size: 1.4rem; margin-bottom: 4px; color: var(--ink); }
.sub { color: var(--mut); font-size: 0.85rem; margin-bottom: 20px; }
.full { width: 100%; }
.btn--root {
  margin-top: 14px;
  font-size: 0.86rem;
  opacity: 0.85;
}
.btn--root:hover { opacity: 1; }
.code-input {
  text-align: center;
  font-size: 1.5rem;
  letter-spacing: 0.4em;
  font-weight: 700;
}
.link {
  display: block;
  margin: 16px auto 0;
  background: none;
  border: 0;
  color: var(--mut);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}
.link:hover { color: var(--accent); }
.err {
  margin-top: 16px;
  text-align: center;
  color: var(--danger);
  font-size: 0.84rem;
  font-weight: 600;
}
.denied { text-align: center; }
.denied h2 { color: var(--danger); }
.denied p { color: var(--mut); font-size: 0.88rem; margin: 10px 0 20px; }
.denied h2.pending-title { color: var(--accent-dark); }
.request-access { margin-bottom: 10px; }
/* Pulsing dot while we poll for root's approval. */
.pending-dot {
  display: block;
  width: 9px; height: 9px;
  border-radius: 50%;
  background: var(--accent);
  margin: 0 auto 18px;
  animation: pendingPulse 1.4s ease-in-out infinite;
}
@keyframes pendingPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
</style>
