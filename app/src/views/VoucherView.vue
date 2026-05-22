<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useProfile } from '../composables/useProfile'
import { fetchVoucher } from '../lib/api'
import { supabase } from '../lib/supabase'
import LoyaltyCard from '../components/LoyaltyCard.vue'
import QrCard from '../components/QrCard.vue'

const { profile } = useProfile()

const data = ref(null)   // { lifetime_visits, vouchers_redeemed, template, cards }
const loading = ref(true)
const qrCard = ref(null) // the card whose QR modal is open, or null

const profileId = computed(() => profile.value?.id || '')
const holderName = computed(() => profile.value?.name || 'invité')

const cards = computed(() => data.value?.cards || [])
const activeCard = computed(() => cards.value.find((c) => c.status === 'active') || null)
const completedCards = computed(() => cards.value.filter((c) => c.status === 'completed'))

// The card to collect on — the real active card, or an empty one built
// from the template for a diner who has no card yet.
const displayCard = computed(() => {
  if (activeCard.value) return activeCard.value
  const tpl = data.value?.template
  if (!tpl) return null
  return {
    id: null,
    status: 'active',
    card_no: (data.value?.vouchers_redeemed || 0) + completedCards.value.length + 1,
    label: tpl.label,
    reward_text: tpl.reward_text,
    stamps_required: tpl.stamps_required,
    stamps: []
  }
})

const lifetime = computed(() => data.value?.lifetime_visits || 0)
const redeemed = computed(() => data.value?.vouchers_redeemed || 0)
const locked = computed(() => data.value?.locked === true)

// QR payload: a completed card shows a redeem code (its card id);
// the active card shows the stamp code (the profile id).
const qrData = computed(() => {
  const c = qrCard.value
  if (!c) return ''
  return c.status === 'completed' && c.id
    ? `vautcher-redeem:${c.id}`
    : `vautcher-stamp:${profileId.value}`
})

// Apple Wallet pass — the signed .pkpass endpoint. iOS opens the "Add"
// sheet; the pass then live-updates whenever a stamp is scanned.
const passUrl = computed(() => {
  const base = import.meta.env.VITE_SUPABASE_URL
  return profile.value && base
    ? `${base}/functions/v1/vautcher-pass/pass/${profile.value.id}`
    : ''
})

async function load() {
  try {
    data.value = await fetchVoucher(profileId.value)
  } finally {
    loading.value = false
  }
}

// Realtime — the owner's scan broadcasts to the topic vautcher:<profileId>,
// so the card updates on its own with no page refresh.
let channel = null
function subscribe() {
  if (!supabase || !profileId.value) return
  channel = supabase
    .channel(`vautcher:${profileId.value}`)
    .on('broadcast', { event: 'voucher_changed' }, () => load())
    .subscribe()
}

// Returning to the app (e.g. after the owner scanned) also refreshes.
function onVisible() {
  if (document.visibilityState === 'visible') load()
}

onMounted(async () => {
  await load()
  subscribe()
  document.addEventListener('visibilitychange', onVisible)
})

onBeforeUnmount(() => {
  if (channel) supabase.removeChannel(channel)
  document.removeEventListener('visibilitychange', onVisible)
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <span class="kicker">Fidélité</span>
      <h1>Votre carte Vautcher</h1>
      <p>Une visite, un tampon. Collectionnez-les pour votre récompense.</p>
    </header>

    <p v-if="loading" class="vc-loading">Chargement de votre carte…</p>

    <div v-else-if="locked" class="vc-locked">
      <span class="vc-locked-ico">🔒</span>
      <h2>Compte bloqué</h2>
      <p>Votre carte de fidélité est momentanément indisponible. Contactez le restaurant.</p>
    </div>

    <template v-else>
      <p class="counters">
        <strong>{{ lifetime }}</strong> {{ lifetime > 1 ? 'visites' : 'visite' }}
        <span class="dot">·</span>
        <strong>{{ redeemed }}</strong>
        {{ redeemed > 1 ? 'vautchers utilisés' : 'vautcher utilisé' }}
      </p>

      <!-- Completed cards awaiting their reward -->
      <div v-for="c in completedCards" :key="c.id" class="card-wrap">
        <LoyaltyCard :card="c" :holder-name="holderName" @present="qrCard = c" />
      </div>

      <!-- The card currently being collected -->
      <div v-if="displayCard" class="card-wrap">
        <LoyaltyCard :card="displayCard" :holder-name="holderName" @present="qrCard = displayCard" />
        <a v-if="passUrl" class="wallet-btn" :href="passUrl">
          <svg class="wallet-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm14 4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z" />
          </svg>
          Ajouter à Apple&nbsp;Wallet
        </a>
      </div>
    </template>

    <!-- QR modal -->
    <div v-if="qrCard" class="qr-overlay" @click.self="qrCard = null">
      <div class="qr-modal" role="dialog" aria-modal="true">
        <button class="qr-x" aria-label="Fermer" @click="qrCard = null">✕</button>
        <h3>{{ qrCard.status === 'completed' ? 'Votre récompense' : 'Votre code fidélité' }}</h3>
        <p class="qr-sub">
          {{ qrCard.status === 'completed'
            ? 'Présentez ce code au restaurant pour recevoir votre récompense.'
            : 'Présentez ce code au restaurant — il l’ajoute à votre carte.' }}
        </p>
        <QrCard :data="qrData" />
        <p class="qr-name">{{ holderName }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { background: var(--paper); min-height: 100%; padding-bottom: 54px; }
.page-head { text-align: center; padding: 36px 20px 8px; }
.kicker {
  color: var(--burgundy);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.page-head h1 { font-size: clamp(2rem, 6vw, 2.8rem); margin: 6px 0; }
.page-head p { color: var(--grey); }

.vc-loading { text-align: center; color: var(--grey); padding: 48px 0; }

.vc-locked {
  text-align: center;
  max-width: 380px;
  margin: 24px auto;
  padding: 40px 28px;
  background: #fffaf2;
  border: 1px solid var(--line);
  border-radius: 18px;
}
.vc-locked-ico { font-size: 2.4rem; }
.vc-locked h2 { color: var(--burgundy); margin: 12px 0 6px; }
.vc-locked p { color: var(--grey); font-size: 0.9rem; }

/* Two counters: lifetime visits + vautchers redeemed */
.counters {
  text-align: center;
  font-size: 0.84rem;
  color: var(--grey);
  margin: 6px 20px 6px;
}
.counters strong { color: var(--burgundy); font-size: 1.02rem; }
.counters .dot { margin: 0 7px; opacity: 0.5; }

.card-wrap { display: flex; flex-direction: column; align-items: center; padding: 14px 20px; }

/* ---- Add to Apple Wallet ---- */
.wallet-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: fit-content;
  margin: 14px auto 0;
  padding: 12px 26px;
  border-radius: 12px;
  background: #000;
  color: #fff;
  font-weight: 600;
  font-size: 0.82rem;
  letter-spacing: 0.02em;
  text-decoration: none;
  transition: opacity 0.15s, transform 0.1s;
}
.wallet-btn:active { transform: scale(0.99); }
.wallet-ico { width: 19px; height: 19px; fill: #fff; flex: 0 0 auto; }

/* ---- QR modal ---- */
.qr-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(15, 0, 6, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
  backdrop-filter: blur(2px);
}
.qr-modal {
  position: relative;
  width: 100%;
  max-width: 330px;
  background: #fff;
  border-radius: 16px;
  padding: 30px 26px 24px;
  text-align: center;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  animation: qr-pop 0.22s ease;
}
@keyframes qr-pop {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to { opacity: 1; transform: none; }
}
.qr-x {
  position: absolute;
  top: 12px;
  right: 14px;
  background: none;
  border: 0;
  font-size: 1.1rem;
  color: var(--grey);
  cursor: pointer;
}
.qr-modal h3 { font-size: 1.3rem; color: var(--burgundy); margin-bottom: 4px; }
.qr-sub { font-size: 0.82rem; color: var(--grey); margin-bottom: 18px; }
.qr-name {
  margin-top: 14px;
  font-family: 'Rufina', serif;
  font-size: 1.1rem;
  color: var(--ink);
}
</style>
