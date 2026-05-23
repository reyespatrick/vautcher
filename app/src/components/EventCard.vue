<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

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
    <article class="event" :class="{ joined: event.joined }">
      <div class="ev-media" :style="{ backgroundImage: `url(${event.image_url})` }">
        <div class="ev-date">
          <strong>{{ day }}</strong>
          <small>{{ monthShort }}</small>
        </div>
        <span v-if="event.joined" class="ev-flag">✓ Inscrit</span>
        <span v-if="full" class="ev-full">Complet</span>
      </div>

      <div class="ev-body">
        <h3>{{ event.title }}</h3>

        <ul class="ev-meta">
          <li><span class="ic">📅</span>{{ fullDate }}</li>
          <li v-if="event.event_time"><span class="ic">🕖</span>{{ event.event_time }}</li>
          <li v-if="event.location"><span class="ic">📍</span>{{ event.location }}</li>
          <li v-if="event.price"><span class="ic">🎟️</span>{{ event.price }}</li>
        </ul>

        <p v-if="rebateText" class="ev-rebate">🎁 {{ rebateText }}</p>

        <p class="ev-desc">{{ event.description }}</p>

        <div class="ev-foot">
          <span class="ev-count">
            <template v-if="max != null">{{ attendees }} / {{ max }} participants</template>
            <template v-else>
              {{ attendees }} {{ attendees > 1 ? 'personnes intéressées' : 'personne intéressée' }}
            </template>
          </span>
          <!-- .stop / .prevent so tapping the action button doesn't also
               navigate to the detail page (the whole card is a link). -->
          <button
            v-if="event.joined"
            class="ev-act leave"
            type="button"
            :disabled="busy"
            @click.stop.prevent="emit('leave', event)"
          >Annuler ma participation</button>
          <button
            v-else-if="full"
            class="ev-act join"
            type="button"
            disabled
            @click.stop.prevent
          >Complet</button>
          <button
            v-else
            class="ev-act join"
            type="button"
            :disabled="busy"
            @click.stop.prevent="emit('join', event)"
          >Je participe</button>
        </div>
      </div>
    </article>
  </RouterLink>
</template>

<style scoped>
/* RouterLink reset — let the .event styling do all the visual work. */
.event-link { display: block; color: inherit; text-decoration: none; }

.event {
  display: flex;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.08);
  transition: box-shadow 0.2s, transform 0.15s;
}
.event:hover { box-shadow: 0 14px 34px rgba(0, 0, 0, 0.13); transform: translateY(-3px); }
.event.joined { border-color: var(--burgundy); }

.ev-media {
  position: relative;
  flex: 0 0 38%;
  min-height: 210px;
  background-size: cover;
  background-position: center;
}
.ev-date {
  position: absolute;
  top: 14px;
  left: 14px;
  background: #fff;
  border-radius: 10px;
  padding: 8px 12px;
  text-align: center;
  line-height: 1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
}
.ev-date strong {
  display: block;
  font-family: 'Rufina', serif;
  font-size: 1.5rem;
  color: var(--burgundy);
}
.ev-date small {
  display: block;
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--grey);
  margin-top: 3px;
}
.ev-flag {
  position: absolute;
  bottom: 12px;
  left: 14px;
  background: var(--burgundy);
  color: #fff;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 5px 11px;
  border-radius: 20px;
}
.ev-full {
  position: absolute;
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

.ev-body { flex: 1; padding: 20px 22px; display: flex; flex-direction: column; }
.ev-body h3 { font-size: 1.3rem; margin-bottom: 10px; }

.ev-meta {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-bottom: 12px;
}
.ev-meta li {
  font-size: 0.84rem;
  color: var(--grey);
  display: flex;
  align-items: center;
  gap: 6px;
}
.ev-meta .ic { font-size: 0.9rem; }

.ev-desc { color: var(--grey); font-size: 0.92rem; flex: 1; margin-bottom: 16px; }
.ev-rebate {
  align-self: flex-start;
  background: linear-gradient(135deg, #fbeec4, #f3d98c);
  color: #6e5414;
  font-size: 0.82rem;
  font-weight: 700;
  padding: 7px 12px;
  border-radius: 9px;
  margin-bottom: 14px;
}

.ev-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.ev-count { font-size: 0.8rem; font-weight: 600; color: var(--burgundy); }
.ev-act {
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 700;
  font-size: 0.76rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  transition: background 0.15s, opacity 0.15s;
}
.ev-act.join { background: var(--burgundy); color: #fff; padding: 11px 18px; }
.ev-act.join:hover { background: var(--burgundy-dark); }
.ev-act.leave {
  background: #fff;
  color: var(--burgundy);
  border: 2px solid var(--burgundy);
  padding: 9px 16px;
}
.ev-act.leave:hover { background: rgba(158, 5, 61, 0.07); }
.ev-act:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 620px) {
  .event { flex-direction: column; }
  .ev-media { flex: none; min-height: 168px; }
}
</style>
