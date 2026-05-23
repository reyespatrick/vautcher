<script setup>
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { site } from '../data/site'
import { createReservation } from '../lib/api'
import { useProfile } from '../composables/useProfile'

const { profile } = useProfile()
const today = new Date().toISOString().split('T')[0]

const form = ref({
  date: '',
  time: '',
  guests: 2,
  name: profile.value?.name || '',
  phone: '',
  notes: ''
})

// Per-tenant time slots, configured via vautcher_restaurants.config.reservation_slots
// (array of strings like "12:00"). When unset, the view falls back to a
// free-text time input — never claim service hours we don't know.
const times = computed(() => site.reservationSlots || [])

const submitted = ref(false)
const saving = ref(false)
const error = ref('')

const valid = computed(() =>
  form.value.date && form.value.time && form.value.name.trim() && form.value.phone.trim()
)

async function submit() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const res = await createReservation(form.value)
    if (!res.ok) {
      error.value = 'Une erreur est survenue. Réessayez ou appelez-nous directement.'
      return
    }
    submitted.value = true
  } catch (e) {
    error.value = 'Une erreur est survenue. Réessayez ou appelez-nous directement.'
  } finally {
    saving.value = false
  }
}

function reset() {
  form.value = { date: '', time: '', guests: 2, name: profile.value?.name || '', phone: '', notes: '' }
  submitted.value = false
  error.value = ''
}
</script>

<template>
  <div class="container resa">
    <header class="page-head">
      <span class="kicker">Réservation</span>
      <h1>Réservez votre table</h1>
      <p>Confirmation immédiate.</p>
    </header>

    <!-- Confirmation screen -->
    <div v-if="submitted" class="confirm card">
      <div class="check">✓</div>
      <h2>Réservation confirmée&nbsp;!</h2>
      <p>
        Merci <strong>{{ form.name }}</strong>. Une table pour
        <strong>{{ form.guests }}</strong>
        {{ form.guests > 1 ? 'personnes' : 'personne' }} vous attend le
        <strong>{{ form.date }}</strong> à <strong>{{ form.time }}</strong>.
      </p>
      <p class="muted">Nous vous contacterons au {{ form.phone }} en cas de besoin.</p>
      <div class="confirm-actions">
        <button class="btn btn--ghost" @click="reset">Nouvelle réservation</button>
        <RouterLink to="/evenements" class="btn">Voir les événements</RouterLink>
      </div>
    </div>

    <!-- Booking form -->
    <form v-else class="card" @submit.prevent="submit">
      <div class="row">
        <label>
          Date
          <input v-model="form.date" type="date" :min="today" required />
        </label>
        <label>
          Nombre de personnes
          <select v-model.number="form.guests">
            <option v-for="n in 10" :key="n" :value="n">{{ n }} {{ n > 1 ? 'personnes' : 'personne' }}</option>
          </select>
        </label>
      </div>

      <fieldset class="time-field">
        <legend>Heure</legend>
        <div v-if="times.length" class="time-grid">
          <button
            v-for="t in times"
            :key="t"
            type="button"
            :class="{ on: form.time === t }"
            @click="form.time = t"
          >{{ t }}</button>
        </div>
        <input v-else v-model="form.time" type="time" required />
      </fieldset>

      <div class="row">
        <label>
          Nom
          <input v-model="form.name" type="text" placeholder="Votre nom" required />
        </label>
        <label>
          Téléphone
          <input v-model="form.phone" type="tel" placeholder="+41 …" required />
        </label>
      </div>

      <label>
        Remarques <span class="opt">(facultatif)</span>
        <textarea v-model="form.notes" rows="3" placeholder="Allergie, occasion spéciale, terrasse…"></textarea>
      </label>

      <button class="btn submit" type="submit" :disabled="!valid || saving">
        {{ saving ? 'Envoi en cours…' : 'Confirmer la réservation' }}
      </button>
      <p v-if="error" class="error">{{ error }}</p>
      <p class="hint">Besoin d’aide&nbsp;? Appelez-nous au
        <a :href="site.phoneHref">{{ site.phone }}</a>.</p>
    </form>
  </div>
</template>

<style scoped>
.resa { padding-bottom: 50px; }
.page-head { text-align: center; padding: 38px 20px 24px; }
.kicker { color: var(--burgundy); font-size: 0.74rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; }
.page-head h1 { font-size: clamp(2rem, 6vw, 2.8rem); margin: 6px 0; }
.page-head p { color: var(--grey); }

.card {
  max-width: 620px;
  margin: 0 auto;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 28px;
}

.row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--ink);
  margin-bottom: 16px;
}
.opt { text-transform: none; color: var(--grey); font-weight: 400; }
input, select, textarea {
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
input:focus, select:focus, textarea:focus { border-color: var(--burgundy); }

.time-field { border: 0; margin-bottom: 8px; }
.time-field legend {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.time-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
.time-grid button {
  padding: 9px 4px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #fff;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.time-grid button.on { background: var(--burgundy); border-color: var(--burgundy); color: #fff; }

.submit { display: flex; width: 100%; margin-top: 6px; }
.hint { text-align: center; font-size: 0.85rem; color: var(--grey); margin-top: 14px; }
.hint a { color: var(--burgundy); font-weight: 600; }
.error {
  text-align: center;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--burgundy);
  margin-top: 12px;
}

.confirm { text-align: center; }
.check {
  width: 64px; height: 64px;
  margin: 0 auto 14px;
  border-radius: 50%;
  background: var(--burgundy);
  color: #fff;
  font-size: 2rem;
  display: flex; align-items: center; justify-content: center;
}
.confirm h2 { font-size: 1.6rem; margin-bottom: 8px; }
.confirm p { color: var(--grey); margin-bottom: 6px; }
.confirm .muted { font-size: 0.88rem; }
.confirm-actions { display: flex; gap: 12px; justify-content: center; margin-top: 18px; flex-wrap: wrap; }

@media (max-width: 560px) {
  .row { grid-template-columns: 1fr; gap: 0; }
  .time-grid { grid-template-columns: repeat(4, 1fr); }
}
</style>
