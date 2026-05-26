<script setup>
import { computed } from 'vue'
import { site } from '../data/site'

// One loyalty card — the stamp grid for a single vautcher. Used both for
// the card the diner is currently collecting and for completed cards
// still awaiting their reward.
const props = defineProps({
  card: { type: Object, required: true },
  holderName: { type: String, default: 'invité' }
})
defineEmits(['present'])

const required = computed(() => props.card.stamps_required || 10)
const stampDates = computed(() => props.card.stamps || [])
const collected = computed(() => stampDates.value.length)
const complete = computed(() =>
  props.card.status === 'completed' || collected.value >= required.value
)
const remaining = computed(() => Math.max(0, required.value - collected.value))
const progress = computed(() =>
  required.value ? Math.min(100, (collected.value / required.value) * 100) : 0
)

// One slot per required stamp; each holds a stamp date or null.
const slots = computed(() =>
  Array.from({ length: required.value }, (_, i) => stampDates.value[i] || null)
)
const reward = computed(() => props.card.reward_text || 'Une récompense')

const MONTHS = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN',
                'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC']
function dayOf(d) { return String(new Date(d).getDate()).padStart(2, '0') }
function monthOf(d) { return MONTHS[new Date(d).getMonth()] }
function yearOf(d) { return String(new Date(d).getFullYear()).slice(2) }
// Deterministic tilt — the hand-stamped, slightly-crooked look.
function tilt(i) { return ((i * 53) % 15) - 7 }
</script>

<template>
  <article class="voucher" :class="{ done: complete }">
    <!-- Header band -->
    <div class="vc-head">
      <span class="vc-logo"><img :src="site.logoUrl" :alt="site.name" /></span>
      <span class="vc-title">
        <strong>{{ card.label }}</strong>
        <small>Carte n° {{ card.card_no }}</small>
      </span>
    </div>

    <!-- Perforation with ticket notches -->
    <div class="perf"></div>

    <p class="vc-holder">
      Carte de <strong>{{ holderName }}</strong>
    </p>

    <!-- Stamp grid -->
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
          Récompense&nbsp;: <strong>{{ reward }}</strong>
        </template>
        <template v-else>
          <strong>{{ reward }}</strong>
          <small>Encore {{ remaining }} {{ remaining > 1 ? 'visites' : 'visite' }}</small>
        </template>
      </span>
    </div>

    <button
      class="qr-btn"
      :class="{ 'qr-btn--reward': complete }"
      type="button"
      @click="$emit('present')"
    >
      <span class="qr-btn-ico">▣</span>
      {{ complete ? 'Présenter pour ma récompense' : 'Présenter mon code' }}
    </button>

    <p class="vc-note">
      {{ complete
        ? 'Faites scanner cette carte de fidélité par le restaurant pour recevoir votre récompense.'
        : 'Un tampon est ajouté par le restaurant à chaque visite.' }}
    </p>
  </article>
</template>

<style scoped>
.voucher {
  width: 100%;
  max-width: 430px;
  background: #fffaf2;
  border-radius: 18px;
  box-shadow: 0 22px 50px rgba(20, 0, 8, 0.26);
  overflow: hidden;
  padding-bottom: 22px;
}
.voucher.done { box-shadow: 0 22px 54px color-mix(in srgb, var(--burgundy) 40%, transparent); }

/* Header band */
.vc-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 22px 24px;
  background: linear-gradient(135deg, var(--burgundy), var(--burgundy-dark));
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
.vc-title strong { font-family: 'Rufina', serif; font-size: 1.3rem; display: block; line-height: 1.12; }
.vc-title small {
  font-size: 0.62rem;
  letter-spacing: 0.2em;
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
  background: color-mix(in srgb, var(--burgundy) 7%, transparent);
  color: var(--burgundy);
  transform: rotate(var(--tilt));
  opacity: 0.94;
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--burgundy) 12%, transparent);
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
  background: linear-gradient(90deg, var(--burgundy-dark), var(--burgundy));
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

/* ---- Present-code button ---- */
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
.qr-btn-ico { font-size: 1.05rem; }
.qr-btn--reward {
  background: linear-gradient(135deg, #b8902f, #936f1c);
}
.qr-btn--reward:hover { background: linear-gradient(135deg, #c79c33, #a37c20); }
</style>
