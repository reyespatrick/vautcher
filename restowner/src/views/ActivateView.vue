<script setup>
// Public owner activation. The restaurateur enters their e-mail + the
// durable code given by the moderator → claim-owner binds the e-mail and
// returns a fresh OTP → we verify it → they're signed in. No expiring link.
import { ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import { claimOwner } from '../lib/claim'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { session, owner, isModerator, verifyOtp } = useAuth()

const email = ref('')
const code = ref('')
const error = ref('')
const busy = ref(false)

onMounted(() => {
  const c = route.query.code
  if (typeof c === 'string') code.value = c.toUpperCase()
})

// Once signed in and recognised as an owner, go to the dashboard.
watch([session, owner, isModerator], () => {
  if (session.value && (owner.value || isModerator.value)) {
    router.push({ name: owner.value ? 'dashboard' : 'approve' })
  }
})

async function onActivate() {
  if (busy.value) return
  const e = email.value.trim()
  const c = code.value.trim()
  if (!e || !c) return
  busy.value = true
  error.value = ''
  try {
    const { data, error: cErr } = await claimOwner(c, e)
    if (cErr || !data?.otp) {
      error.value = cErr?.message || t('activate.failed')
      return
    }
    const { error: vErr } = await verifyOtp(data.email || e, data.otp)
    if (vErr) {
      error.value = t('activate.signinFailed')
      return
    }
    // success → the watcher redirects to the dashboard.
  } catch (err) {
    error.value = (err && err.message) || String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="activate">
    <div class="card">
      <img class="app-icon" src="/icon-192.png" alt="restowner" />
      <h1>{{ t('activate.title') }}</h1>
      <p class="sub">{{ t('activate.subtitle') }}</p>

      <form @submit.prevent="onActivate">
        <div class="field">
          <label>{{ t('activate.email') }}</label>
          <input
            v-model="email" type="text" inputmode="email"
            autocomplete="email" autocorrect="off" autocapitalize="none" spellcheck="false"
            :placeholder="t('activate.emailPlaceholder')" required
          />
        </div>
        <div class="field">
          <label>{{ t('activate.code') }}</label>
          <input
            v-model="code" type="text"
            autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false"
            class="code-input" placeholder="XXXXXXXX" required
          />
        </div>
        <button class="btn-main" type="submit" :disabled="busy">
          {{ busy ? t('activate.activating') : t('activate.activate') }}
        </button>
      </form>

      <p v-if="error" class="err">{{ error }}</p>
      <p class="foot">{{ t('activate.foot') }}</p>
    </div>
  </div>
</template>

<style scoped>
.activate {
  min-height: 100vh;
  background: linear-gradient(165deg, #b3074a 0%, #6f032b 55%, #420320 100%);
  display: flex; align-items: center; justify-content: center; padding: 28px 20px;
}
.card {
  width: 100%; max-width: 380px; background: #fff; border-radius: 22px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28); padding: 32px 28px 24px; text-align: center;
}
.app-icon { width: 76px; height: 76px; border-radius: 18px; box-shadow: 0 8px 22px rgba(158, 5, 61, 0.3); }
h1 { font-family: 'Rufina', serif; font-size: 1.5rem; color: var(--accent-dark); margin: 14px 0 0; }
.sub { color: var(--mut); font-size: 0.88rem; line-height: 1.5; margin: 8px 0 22px; }
.field { text-align: left; margin-bottom: 14px; }
.field label { display: block; font-size: 0.78rem; font-weight: 700; color: var(--mut); margin-bottom: 6px; }
.field input {
  width: 100%; font-family: inherit; font-size: 1rem; padding: 12px 13px;
  border: 1.5px solid var(--line); border-radius: 11px; background: #fff; color: var(--ink); box-sizing: border-box;
}
.field input:focus { outline: none; border-color: var(--accent); }
.code-input { text-align: center; font-size: 1.25rem; letter-spacing: 0.28em; font-weight: 700; text-transform: uppercase; }
.btn-main {
  width: 100%; font-family: inherit; font-weight: 700; font-size: 1rem; color: #fff;
  background: var(--accent); border: 0; border-radius: 13px; padding: 15px; cursor: pointer; margin-top: 4px;
  box-shadow: 0 8px 20px rgba(158, 5, 61, 0.3);
}
.btn-main:disabled { opacity: 0.55; cursor: not-allowed; }
.err { margin-top: 14px; color: var(--danger); font-size: 0.84rem; font-weight: 600; }
.foot { margin-top: 20px; font-size: 0.76rem; color: var(--mut); line-height: 1.4; }
</style>
