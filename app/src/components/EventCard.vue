<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { formatPrice } from '../lib/format'

const props = defineProps({
  event: { type: Object, required: true },
  busy: { type: Boolean, default: false }
})
const emit = defineEmits(['join', 'leave'])

const MONTHS = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN',
                'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC']
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                     'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

const d = computed(() => new Date(props.event.event_date + 'T00:00:00'))
const day = computed(() => String(d.value.getDate()).padStart(2, '0'))
const monthShort = computed(() => MONTHS[d.value.getMonth()])
const fullDate = computed(() =>
  `${WEEKDAYS[d.value.getDay()]} ${d.value.getDate()} ${MONTHS_LONG[d.value.getMonth()]}`
)
const attendees = computed(() => props.event.attendees || 0)
const max = computed(() => props.event.max_participants ?? null)
const full = computed(() => max.value != null && attendees.value >= max.value)
const rebateText = computed(() => {
  const v = props.event.rebate_value
  if (!v) return ''
  const amount = props.event.rebate_unit === 'chf' ? `${v} CHF` : `${v} %`
  const n = props.event.rebate_first_n
  return n
    ? `Rabais de ${amount} pour les ${n} premiers inscrits`
    : `Rabais de ${amount}`
})
</script>

<template>
  <RouterLink
    :to="{ name: 'event-detail', params: { id: event.id } }"
    class="event-link"
  >
    <article class="event featured" :class="{ joined: event.joined }">
      <!-- Hero image with overlaid title + bottom info strip. -->
      <div class="ev-hero">
        <img
          v-if="event.image_url"
          :src="event.image_url"
          :alt="event.title"
          loading="lazy"
          decoding="async"
          class="ev-hero-img"
        />
        <div class="ev-hero-date">
          <strong>{{ day }}</strong>
          <small>{{ monthShort }}</small>
        </div>
        <div v-if="event.joined" class="ev-stamp" aria-label="Inscrit">
          <span>Inscrit</span>
        </div>
        <span v-if="full && !event.joined" class="ev-full">Complet</span>

        <h3 class="ev-hero-title">{{ event.title }}</h3>

        <div class="ev-hero-strip">
          <ul class="ev-meta">
            <li v-if="event.event_time">🕖 {{ event.event_time }}<template v-if="event.event_end_time">–{{ event.event_end_time }}</template></li>
            <li v-if="event.location">📍 {{ event.location }}</li>
            <li v-if="event.price">🪙 {{ formatPrice(event.price) }}</li>
          </ul>
          <button
            v-if="event.joined"
            class="ev-cta leave"
            type="button"
            :disabled="busy"
            @click.stop.prevent="emit('leave', event)"
          >Annuler</button>
          <button
            v-else-if="full"
            class="ev-cta full"
            type="button"
            disabled
            @click.stop.prevent
          >Complet</button>
          <button
            v-else
            class="ev-cta join"
            type="button"
            :disabled="busy"
            @click.stop.prevent="emit('join', event)"
          >Je participe</button>
        </div>
      </div>

      <!-- Description + rebate below the hero. Empty when the event
           has none — the card is then just the visual hero. -->
      <div v-if="event.description || rebateText" class="ev-foot">
        <p v-if="rebateText" class="ev-rebate">🎁 {{ rebateText }}</p>
        <p v-if="event.description" class="ev-desc">{{ event.description }}</p>
      </div>
    </article>
  </RouterLink>
</template>

<style scoped>
/* RouterLink reset — let the .event styling do all the visual work. */
.event-link { display: block; color: inherit; text-decoration: none; }

/* Featured-hero layout (option ④):
   - Full-bleed image at 5:3 with bottom gradient
   - Date pill top-left, Joined / Complet badges over the image
   - Title overlaid on the image above a bottom info strip
   - Bottom info strip carries time/location/price + the brand CTA
   - Description (if any) appears in a thin footer below the hero */
.event {
  position: relative;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.10);
  transition: box-shadow 0.2s, transform 0.15s;
}
.event:hover { box-shadow: 0 18px 38px rgba(0, 0, 0, 0.14); transform: translateY(-3px); }
.event.joined { border-color: var(--burgundy); }

.ev-hero {
  position: relative;
  aspect-ratio: 5 / 3;
  overflow: hidden;
  background-color: color-mix(in srgb, var(--burgundy) 12%, #eee);
}
.ev-hero-img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  z-index: 0;
}
.ev-hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 30%, rgba(0, 0, 0, 0.78) 100%);
  pointer-events: none;
  z-index: 1;
}
/* Overlay items (date, title, strip…) need to sit above the image. */
.ev-hero > :not(.ev-hero-img) { position: relative; z-index: 2; }

.ev-hero-date {
  position: absolute;
  z-index: 2;
  top: 14px;
  left: 14px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 4px;
  padding: 7px 11px;
  text-align: center;
  line-height: 1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
}
.ev-hero-date strong {
  display: block;
  font-family: 'Rufina', serif;
  font-size: 1.45rem;
  color: var(--burgundy);
}
.ev-hero-date small {
  display: block;
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--grey);
  margin-top: 3px;
}

.ev-hero-title {
  position: absolute;
  z-index: 2;
  left: 18px;
  right: 18px;
  bottom: 62px;
  margin: 0;
  color: #fff;
  font-family: 'Rufina', serif;
  font-size: 1.4rem;
  font-weight: 700;
  line-height: 1.18;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
}

.ev-hero-strip {
  position: absolute;
  z-index: 2;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px 14px;
  color: #fff;
}
.ev-meta {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 0.78rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.94);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  min-width: 0;
}
.ev-meta li { white-space: nowrap; }

.ev-cta {
  flex: 0 0 auto;
  border: 0;
  border-radius: 18px;
  padding: 8px 14px;
  font-weight: 700;
  font-size: 0.76rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s, transform 0.1s;
}
.ev-cta.join {
  background: var(--burgundy);
  color: #fff;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.ev-cta.join:hover { background: var(--burgundy-dark); }
.ev-cta.leave {
  background: rgba(255, 255, 255, 0.94);
  color: var(--burgundy);
}
.ev-cta.leave:hover { background: #fff; }
.ev-cta.full {
  background: rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.85);
  cursor: not-allowed;
}
.ev-cta:disabled { opacity: 0.65; cursor: not-allowed; }

/* Inscrit stamp — kept distinctive, just nudged so it sits above the title strip. */
.ev-stamp {
  position: absolute;
  z-index: 3;
  top: 42%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-12deg);
  border: 3px double var(--burgundy);
  background: rgba(255, 255, 255, 0.82);
  color: var(--burgundy);
  font-family: 'Rufina', serif;
  font-weight: 800;
  font-size: 1.45rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 6px 18px;
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  animation: stamp-in 0.32s cubic-bezier(0.18, 1.2, 0.4, 1) both;
}
.ev-stamp::before,
.ev-stamp::after {
  content: '';
  position: absolute;
  inset: 4px;
  border: 1px solid color-mix(in srgb, var(--burgundy) 35%, transparent);
  border-radius: 2px;
  pointer-events: none;
}
@keyframes stamp-in {
  from { opacity: 0; transform: translate(-50%, -50%) rotate(-12deg) scale(1.45); }
  to { opacity: 0.94; transform: translate(-50%, -50%) rotate(-12deg) scale(1); }
}

.ev-full {
  position: absolute;
  z-index: 2;
  top: 14px;
  right: 14px;
  background: var(--burgundy);
  color: #fff;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 5px 11px;
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
}

.ev-foot {
  padding: 14px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ev-desc {
  color: var(--grey);
  font-size: 0.92rem;
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ev-rebate {
  align-self: flex-start;
  background: linear-gradient(135deg, #fbeec4, #f3d98c);
  color: #6e5414;
  font-size: 0.82rem;
  font-weight: 700;
  padding: 6px 12px;
  border-radius: 9px;
  margin: 0;
}

@media (max-width: 420px) {
  .ev-hero-title { font-size: 1.2rem; bottom: 58px; }
  .ev-meta { font-size: 0.72rem; gap: 3px 9px; }
  .ev-cta { padding: 7px 11px; font-size: 0.72rem; }
}
</style>
