<script setup>
import { ref, computed, onMounted } from 'vue'
import { useProfile } from '../composables/useProfile'
import { fetchVoucher } from '../lib/api'
import QrCard from '../components/QrCard.vue'

const { profile } = useProfile()

const stamps = ref([])
const required = ref(10)
const reward = ref('')
const loading = ref(true)
const showQr = ref(false)

// Payload the restaurant's owner app scans to add a stamp.
const qrData = computed(() =>
  profile.value ? `vautcher-stamp:${profile.value.id}` : ''
)

// Apple Wallet pass — the signed .pkpass endpoint. iOS sees the
// application/vnd.apple.pkpass response and opens the "Add" sheet;
// the pass then live-updates whenever a stamp is scanned.
const passUrl = computed(() => {
  const base = import.meta.env.VITE_SUPABASE_URL
  return profile.value && base
    ? `${base}/functions/v1/vautcher-pass/pass/${profile.value.id}`
    : ''
})

onMounted(async () => {
  try {
    const v = await fetchVoucher(profile.value?.id)
    stamps.value = v.stamps || []
    required.value = v.required || 10
    reward.value = v.reward || 'Une récompense'
  } catch (e) {
    /* keep the default empty card — reward falls back below */
    if (!reward.value) reward.value = 'Une récompense'
  } finally {
    loading.value = false
  }
})

const collected = computed(() => stamps.value.length)
const complete = computed(() => collected.value >= required.value)
const remaining = computed(() => Math.max(0, required.value - collected.value))
const progress = computed(() =>
  required.value ? Math.min(100, (collected.value / required.value) * 100) : 0
)

// One slot per required stamp; each holds an order date or null.
const slots = computed(() =>
  Array.from({ length: required.value }, (_, i) => stamps.value[i] || null)
)

const MONTHS = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN',
                'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC']
function dayOf(d) { return String(new Date(d).getDate()).padStart(2, '0') }
function monthOf(d) { return MONTHS[new Date(d).getMonth()] }
function yearOf(d) { return String(new Date(d).getFullYear()).slice(2) }
// Deterministic tilt — the hand-stamped, slightly-crooked look.
function tilt(i) { return ((i * 53) % 15) - 7 }
</script>

<template>
  <div class="page">
    <header class="page-head">
      <span class="kicker">Fidélité</span>
      <h1>Votre carte Vautcher</h1>
      <p>Une visite, un tampon. Collectionnez-les pour votre récompense.</p>
    </header>

    <div class="card-wrap">
      <article class="voucher" :class="{ done: complete }">
        <!-- Header band -->
        <div class="vc-head">
          <span class="vc-logo"><img src="/assets/logo.jpg" alt="La Gioconda" /></span>
          <span class="vc-title">
            <strong>La Gioconda</strong>
            <small>Carte de Fidélité</small>
          </span>
        </div>

        <!-- Perforation with ticket notches -->
        <div class="perf"></div>

        <p class="vc-holder">
          Carte de <strong>{{ profile ? profile.name : 'invité' }}</strong>
        </p>

        <!-- Stamp grid -->
        <p v-if="loading" class="vc-loading">Chargement de votre carte…</p>

        <template v-else>
          <div class="stamps">
            <div
              v-for="(date, i) in slots"
              :key="i"
              class="slot"
              :class="{ filled: !!date }"
              :style="date ? { '--tilt': tilt(i) + 'deg', animationDelay: i * 55 + 'ms' } : null"
            >
              <template v-if="date">
                <span class="st-star">★</span>
                <span class="st-day">{{ dayOf(date) }}</span>
                <span class="st-mon">{{ monthOf(date) }} {{ yearOf(date) }}</span>
              </template>
              <span v-else class="st-num">{{ i + 1 }}</span>
            </div>
          </div>

          <!-- Progress -->
          <div class="bar"><span :style="{ width: progress + '%' }"></span></div>
          <p class="count">{{ collected }} / {{ required }} tampons collectés</p>

          <!-- Reward cell -->
          <div class="reward" :class="{ unlocked: complete }">
            <span class="rw-icon">{{ complete ? '🎉' : '🎁' }}</span>
            <span class="rw-text">
              <template v-if="complete">
                Récompense débloquée&nbsp;: <strong>{{ reward }}</strong>
              </template>
              <template v-else>
                <strong>{{ reward }}</strong>
                <small>Encore {{ remaining }} {{ remaining > 1 ? 'visites' : 'visite' }}</small>
              </template>
            </span>
          </div>
        </template>

        <button
          v-if="!loading"
          class="qr-btn"
          type="button"
          :disabled="!profile"
          @click="showQr = true"
        >
          <span class="qr-btn-ico">▣</span> Présenter mon code
        </button>

        <a v-if="!loading && passUrl" class="wallet-btn" :href="passUrl">
          <svg class="wallet-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm14 4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z" />
          </svg>
          Ajouter à Apple&nbsp;Wallet
        </a>

        <p class="vc-note">Un tampon est ajouté par le restaurant à chaque visite.</p>
      </article>
    </div>

    <!-- QR modal -->
    <div v-if="showQr" class="qr-overlay" @click.self="showQr = false">
      <div class="qr-modal" role="dialog" aria-modal="true">
        <button class="qr-x" aria-label="Fermer" @click="showQr = false">✕</button>
        <h3>Votre code fidélité</h3>
        <p class="qr-sub">Présentez ce code au restaurant — il l’ajoute à votre carte.</p>
        <QrCard :data="qrData" />
        <p class="qr-name">{{ profile ? profile.name : '' }}</p>
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

.card-wrap { display: flex; justify-content: center; padding: 18px 20px; }

/* ---- The voucher card ---- */
.voucher {
  width: 100%;
  max-width: 430px;
  background: #fffaf2;
  border-radius: 18px;
  box-shadow: 0 22px 50px rgba(20, 0, 8, 0.26);
  overflow: hidden;
  padding-bottom: 22px;
}
.voucher.done { box-shadow: 0 22px 54px rgba(158, 5, 61, 0.4); }

/* Header band */
.vc-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 22px 24px;
  background: linear-gradient(135deg, #9e053d, #6f001d);
  color: #fff;
}
.vc-logo {
  width: 56px;
  height: 56px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
}
.vc-logo img { width: 44px; height: 44px; object-fit: contain; }
.vc-title strong { font-family: 'Rufina', serif; font-size: 1.4rem; display: block; line-height: 1.1; }
.vc-title small {
  font-size: 0.66rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  opacity: 0.85;
}

/* Perforation line + notch cut-outs */
.perf {
  position: relative;
  height: 0;
  border-top: 2px dashed #e6d6bd;
}
.perf::before,
.perf::after {
  content: '';
  position: absolute;
  top: -12px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--paper);
}
.perf::before { left: -12px; }
.perf::after { right: -12px; }

.vc-holder {
  text-align: center;
  font-size: 0.9rem;
  color: var(--grey);
  padding: 16px 24px 4px;
}
.vc-holder strong { color: var(--ink); }

.vc-loading { text-align: center; color: var(--grey); padding: 36px 0; }

/* ---- Stamp grid ---- */
.stamps {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  padding: 14px 22px 6px;
}
.slot {
  position: relative;
  aspect-ratio: 1;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 2px dashed #d9c8ac;
  color: #c0ad8e;
  background: rgba(0, 0, 0, 0.015);
}
.st-num { font-family: 'Rufina', serif; font-size: 1.1rem; }

.slot.filled {
  border: 2.5px solid var(--burgundy);
  background: rgba(158, 5, 61, 0.07);
  color: var(--burgundy);
  transform: rotate(var(--tilt));
  opacity: 0.94;
  box-shadow: inset 0 0 0 2px rgba(158, 5, 61, 0.12);
  animation: stamp-in 0.32s cubic-bezier(0.2, 1.4, 0.5, 1) both;
}
@keyframes stamp-in {
  from { opacity: 0; transform: rotate(var(--tilt)) scale(1.7); }
  to { opacity: 0.94; transform: rotate(var(--tilt)) scale(1); }
}
.st-star { font-size: 0.5rem; line-height: 1; margin-bottom: 1px; }
.st-day { font-family: 'Rufina', serif; font-weight: 700; font-size: 1.5rem; line-height: 1; }
.st-mon { font-size: 0.46rem; font-weight: 700; letter-spacing: 0.08em; margin-top: 2px; }

/* ---- Progress ---- */
.bar {
  height: 7px;
  background: #ece0cd;
  border-radius: 99px;
  margin: 18px 24px 0;
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #9e053d, #c8295c);
  border-radius: 99px;
  transition: width 0.5s ease;
}
.count {
  text-align: center;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--grey);
  margin-top: 8px;
}

/* ---- Reward cell ---- */
.reward {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 12px 22px 0;
  padding: 14px 16px;
  border-radius: 12px;
  border: 2px dashed #cdb78c;
  background: #fdf6e7;
}
.reward.unlocked {
  border-style: solid;
  border-color: #b8902f;
  background: linear-gradient(135deg, #fbeec4, #f3d98c);
  box-shadow: 0 6px 18px rgba(184, 144, 47, 0.35);
}
.rw-icon { font-size: 1.7rem; flex: 0 0 auto; }
.rw-text { display: flex; flex-direction: column; line-height: 1.3; }
.rw-text strong { font-family: 'Rufina', serif; font-size: 1.05rem; color: var(--ink); }
.rw-text small { font-size: 0.74rem; color: var(--grey); }
.reward.unlocked .rw-text strong { color: #6e5414; }

.vc-note {
  text-align: center;
  font-size: 0.72rem;
  color: #a99c88;
  padding: 16px 24px 0;
}

/* ---- QR button + modal ---- */
.qr-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: fit-content;
  margin: 18px auto 0;
  padding: 13px 28px;
  border: 0;
  border-radius: 12px;
  background: var(--burgundy);
  color: #fff;
  font-weight: 700;
  font-size: 0.82rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.18s, transform 0.1s;
}
.qr-btn:hover { background: var(--burgundy-dark); }
.qr-btn:active { transform: scale(0.99); }
.qr-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.qr-btn-ico { font-size: 1.05rem; }

/* ---- Add to Apple Wallet ---- */
.wallet-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: fit-content;
  margin: 10px auto 0;
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

@media (max-width: 380px) {
  .stamps { grid-template-columns: repeat(4, 1fr); gap: 10px; }
}
</style>
