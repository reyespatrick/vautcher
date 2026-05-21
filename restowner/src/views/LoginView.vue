<script setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const { session, owner, sendOtp, verifyOtp, signOut } = useAuth()
const router = useRouter()
const version = __APP_VERSION__

const step = ref('email') // 'email' | 'code'
const email = ref('')
const code = ref('')
const error = ref('')
const busy = ref(false)

// Once a recognised owner is signed in, go to the console.
watch([session, owner], () => {
  if (session.value && owner.value) router.push({ name: 'dashboard' })
})

async function onSendOtp() {
  if (!email.value.trim()) return
  busy.value = true
  error.value = ''
  const { error: e } = await sendOtp(email.value)
  busy.value = false
  if (e) { error.value = e.message; return }
  step.value = 'code'
}

async function onVerify() {
  if (!code.value.trim()) return
  busy.value = true
  error.value = ''
  const { error: e } = await verifyOtp(email.value, code.value)
  busy.value = false
  if (e) { error.value = 'Code invalide ou expiré. Réessayez.'; return }
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
        <small>Console restaurateur · v{{ version }}</small>
      </div>

      <!-- Signed in but the email is not a registered owner -->
      <div v-if="session && !owner" class="denied">
        <h2>Accès refusé</h2>
        <p>L’adresse <strong>{{ session.user.email }}</strong> n’est pas enregistrée
          comme propriétaire de restaurant.</p>
        <button class="btn btn--plain full" @click="onSignOut">Utiliser une autre adresse</button>
      </div>

      <!-- Step 1: email -->
      <form v-else-if="step === 'email'" @submit.prevent="onSendOtp">
        <h2>Connexion</h2>
        <p class="sub">Recevez un code à usage unique par e-mail.</p>
        <div class="field">
          <label>Adresse e-mail</label>
          <input v-model="email" type="email" placeholder="vous@restaurant.ch" required />
        </div>
        <button class="btn full" type="submit" :disabled="busy">
          {{ busy ? 'Envoi…' : 'Recevoir le code' }}
        </button>
      </form>

      <!-- Step 2: code -->
      <form v-else @submit.prevent="onVerify">
        <h2>Code de vérification</h2>
        <p class="sub">Saisissez le code envoyé à <strong>{{ email }}</strong>.</p>
        <div class="field">
          <label>Code reçu</label>
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
          {{ busy ? 'Vérification…' : 'Se connecter' }}
        </button>
        <button type="button" class="link" @click="backToEmail">← Changer d’adresse</button>
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
