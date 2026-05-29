<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const props = defineProps({
  event: { type: Object, required: true },
  attendees: { type: Number, default: 0 },
  /** Override the navigation target — Dashboard uses "edit existing",
   *  History uses "duplicate from this". */
  to: { type: [Object, String], default: null }
})
const { t, locale } = useI18n()

const target = computed(() =>
  props.to || { name: 'event-detail', params: { id: props.event.id } }
)

const dateText = computed(() => {
  if (!props.event.event_date) return ''
  return new Intl.DateTimeFormat(locale.value, {
    day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(props.event.event_date + 'T00:00:00'))
})

const ageText = computed(() => {
  const { age_min, age_max } = props.event
  if (age_min && age_max) return t('event.ageRange', { min: age_min, max: age_max })
  if (age_min) return t('event.ageMinOnly', { min: age_min })
  if (age_max) return t('event.ageMaxOnly', { max: age_max })
  return ''
})

const rebateBadge = computed(() => {
  const v = props.event.rebate_value
  if (!v) return ''
  return props.event.rebate_unit === 'chf' ? `−${v} CHF` : `−${v}%`
})

const pointsBadge = computed(() => {
  const { points_min, points_max } = props.event
  if (points_min && points_max) return `${points_min}–${points_max} pts`
  if (points_min) return `≥${points_min} pts`
  if (points_max) return `≤${points_max} pts`
  return ''
})

const recurrenceBadge = computed(() => {
  const r = props.event.recurrence
  if (!r || r === 'none') return ''
  return t('event.recur.' + r)
})
</script>

<template>
  <RouterLink :to="target" class="ev-row-link">
    <div class="ev-row card">
      <div class="ev-thumb">
        <img
          v-if="event.image_url"
          :src="event.image_url"
          :alt="event.title"
          loading="lazy"
          decoding="async"
          class="ev-thumb-img"
        />
      </div>

      <div class="ev-info">
        <div class="ev-titleline">
          <h3>{{ event.title }}</h3>
          <span v-if="event.status === 'cancelled'" class="badge badge--cancel">{{ t('event.cancelled') }}</span>
          <span v-else-if="event.moderation_status === 'refused'" class="badge badge--cancel">{{ t('event.refused') }}</span>
          <span v-else-if="event.moderation_status === 'pending'" class="badge badge--pending">{{ t('event.pending') }}</span>
          <span v-else-if="event.published" class="badge badge--ok">{{ t('event.published') }}</span>
          <span v-else class="badge badge--off">{{ t('event.draft') }}</span>
          <span v-if="ageText" class="badge badge--age">{{ ageText }}</span>
          <span v-if="rebateBadge" class="badge badge--rebate">{{ rebateBadge }}</span>
          <span v-if="pointsBadge" class="badge badge--age">{{ pointsBadge }}</span>
          <span v-if="recurrenceBadge" class="badge badge--rebate">🔁 {{ recurrenceBadge }}</span>
        </div>
        <p class="ev-meta">
          {{ dateText }}<template v-if="event.event_time"> · {{ event.event_time }}</template><template v-if="event.location"> · {{ event.location }}</template>
        </p>
        <p class="ev-attendees">
          <strong>{{ attendees }}</strong>
          {{ attendees === 1 ? t('event.attendeesOne') : t('event.attendeesMany') }}
        </p>
        <p
          v-if="event.moderation_status === 'refused' && event.refusal_reason"
          class="ev-refused"
        >{{ t('event.refusedReason', { reason: event.refusal_reason }) }}</p>
      </div>

      <svg
        class="ev-chev"
        viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </div>
  </RouterLink>
</template>

<style scoped>
/* The whole row is a single click target — opens the event editor. */
.ev-row-link { display: block; color: inherit; text-decoration: none; }
.ev-row {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 12px;
  transition: box-shadow 0.15s, transform 0.1s;
}
.ev-row-link:hover .ev-row {
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.10);
}
.ev-row-link:active .ev-row { transform: scale(0.997); }

.ev-thumb {
  width: 78px;
  height: 78px;
  flex: 0 0 auto;
  border-radius: 11px;
  background: #ece4d5;
  overflow: hidden;
}
.ev-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ev-info { flex: 1; min-width: 0; }
.ev-titleline { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.ev-titleline h3 { font-size: 1.02rem; color: var(--ink); }
.ev-meta { color: var(--mut); font-size: 0.8rem; margin-top: 3px; }
.ev-attendees {
  margin-top: 4px;
  font-size: 0.8rem;
  color: var(--mut);
}
.ev-attendees strong {
  font-family: 'Rufina', serif;
  font-size: 0.96rem;
  color: var(--accent);
  margin-right: 4px;
}
.ev-refused {
  margin-top: 5px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--danger);
  line-height: 1.4;
}
.ev-chev {
  width: 20px; height: 20px;
  flex: 0 0 auto;
  color: var(--mut);
}
</style>
