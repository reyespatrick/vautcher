<script setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'

const { session, owner, isModerator, sendOtp, verifyOtp, signOut } = useAuth()
const router = useRouter()
const { t } = useI18n()
const version = __APP_VERSION__

const step = ref('email') // 'email' | 'code'
const email = ref('')
const code = ref('')
const error = ref('')
const busy = ref(false)

watch([session, owner, isModerator], () => {
  if (session.value && (owner.value || isModerator.value)) {
    router.push({ name: owner.value ? 'dashboard' : 'approve' })
  }
})

async function onSendOtp() {
  if (!email.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    const { error: e } = await sendOtp(email.value)
    if (e) { error.value = e.message; return }
    step.value = 'code'
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
        <img src="/assets/logo.jpg" alt="" />
        <b>restowner</b>
        <small>{{ t('app.tagline') }} · v{{ version }}</small>
      </div>

      <!-- Signed in but the email is not a registered owner -->
      <div v-if="session && !owner" class="denied">
        <h2>{{ t('login.deniedTitle') }}</h2>
        <p>{{ t('login.deniedBody', { email: session.user.email }) }}</p>
        <button class="btn btn--plain full" @click="onSignOut">{{ t('login.useAnother') }}</button>
      </div>

      <!-- Step 1: email -->
      <form v-else-if="step === 'email'" @submit.prevent="onSendOtp">
        <h2>{{ t('login.title') }}</h2>
        <p class="sub">{{ t('login.subtitle') }}</p>
        <div class="field">
          <label>{{ t('login.email') }}</label>
          <input v-model="email" type="email" :placeholder="t('login.emailPlaceholder')" required />
        </div>
        <button class="btn full" type="submit" :disabled="busy">
          {{ busy ? t('login.sending') : t('login.sendCode') }}
        </button>
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
</style>
