<script setup>
import { ref, computed } from 'vue'
import { useProfile } from '../composables/useProfile'
import { usePush } from '../composables/usePush'
import { site } from '../data/site'

const { profile, save, closeDialog, logout } = useProfile()
const { subscribeIfPossible, canPrompt } = usePush()

const today = new Date().toISOString().split('T')[0]
const isEdit = computed(() => !!profile.value)

const form = ref({
  name: profile.value?.name || '',
  birthDate: profile.value?.birthDate || ''
})

const valid = computed(() => form.value.name.trim().length >= 2 && !!form.value.birthDate)

async function submit() {
  if (!valid.value) return
  const wasNew = !profile.value
  save(form.value)
  // First-time onboarding: chain straight into the notification
  // permission prompt while we still hold the user-gesture. The user
  // never has to dig into Agenda to enable pushes. No-op on a profile
  // edit, or on iOS Safari (non-standalone), or if push isn't supported.
  if (wasNew && canPrompt.value && profile.value?.id) {
    try { await subscribeIfPossible(profile.value.id) } catch { /* best effort */ }
  }
}

function doLogout() {
  logout()
  form.value = { name: '', birthDate: '' }
}
</script>

<template>
  <div class="overlay" @click.self="isEdit && closeDialog()">
    <div class="dialog" role="dialog" aria-modal="true">
      <button v-if="isEdit" class="x" aria-label="Fermer" @click="closeDialog">✕</button>

      <img class="logo" :src="site.logoUrl" :alt="site.name" />
      <h2>{{ isEdit ? 'Votre profil' : 'Bienvenue' + (site.name ? ' chez ' + site.name : '') }}</h2>
      <p class="intro">
        {{ isEdit
          ? 'Modifiez vos informations ci-dessous.'
          : 'Faisons connaissance — dites-nous qui vous êtes pour personnaliser votre visite.' }}
      </p>

      <form @submit.prevent="submit">
        <label>
          Votre nom
          <input
            v-model="form.name"
            type="text"
            placeholder="Prénom et nom"
            autocomplete="name"
            required
          />
        </label>

        <label>
          Date de naissance
          <input
            v-model="form.birthDate"
            type="date"
            :max="today"
            required
          />
        </label>

        <button class="btn" type="submit" :disabled="!valid">
          {{ isEdit ? 'Enregistrer' : 'Commencer' }}
        </button>
      </form>

      <p class="note">🔒 Enregistré sur votre appareil — on ne vous le redemandera pas.</p>

      <button v-if="isEdit" class="logout" type="button" @click="doLogout">
        Se déconnecter
      </button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(15, 0, 6, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  backdrop-filter: blur(2px);
}
.dialog {
  position: relative;
  width: 100%;
  max-width: 380px;
  background: #fff;
  border-radius: 12px;
  padding: 32px 28px 22px;
  text-align: center;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
  animation: pop 0.22s ease;
}
@keyframes pop {
  from { opacity: 0; transform: translateY(14px) scale(0.97); }
  to { opacity: 1; transform: none; }
}
.x {
  position: absolute;
  top: 12px; right: 14px;
  background: none; border: 0;
  font-size: 1.1rem;
  color: var(--grey);
  cursor: pointer;
}
.logo { height: 64px; width: auto; margin: 0 auto 10px; }
h2 { font-size: 1.5rem; color: var(--burgundy); margin-bottom: 6px; }
.intro { color: var(--grey); font-size: 0.9rem; margin-bottom: 20px; }

label {
  display: block;
  text-align: left;
  font-size: 0.76rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-bottom: 14px;
}
input {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  outline: none;
  font-weight: 400;
  text-transform: none;
}
input:focus { border-color: var(--burgundy); }

.btn { width: 100%; margin-top: 4px; }
.note {
  font-size: 0.74rem;
  color: var(--grey);
  margin-top: 14px;
}
.logout {
  margin-top: 8px;
  background: none;
  border: 0;
  color: var(--grey);
  font-size: 0.8rem;
  text-decoration: underline;
  cursor: pointer;
}
.logout:hover { color: var(--burgundy); }
</style>
