<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  event: { type: Object, required: true },
  attendees: { type: Number, default: 0 }
})
const { t, locale } = useI18n()

const expanded = ref(false)

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

const rebateText = computed(() => {
  if (!rebateBadge.value) return ''
  return props.event.rebate_first_n
    ? t('event.rebateFirstN', { badge: rebateBadge.value, n: props.event.rebate_first_n })
    : rebateBadge.value
})

const pointsBadge = computed(() => {
  const { points_min, points_max } = props.event
  if (points_min && points_max) return `${points_min}–${points_max} pts`
  if (points_min) return `≥${points_min} pts`
  if (points_max) return `≤${points_max} pts`
  return ''
})
</script>

<template>
  <div class="ev-row card" :class="{ 'ev-row--open': expanded }">
    <div
      class="ev-head"
      role="button"
      tabindex="0"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
      @keydown.enter.prevent="expanded = !expanded"
      @keydown.space.prevent="expanded = !expanded"
    >
      <div
        class="ev-thumb"
        :style="event.image_url ? { backgroundImage: `url(${event.image_url})` } : null"
      ></div>

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
        </div>
        <p class="ev-meta">
          {{ dateText }}<template v-if="event.event_time"> · {{ event.event_time }}</template><template v-if="event.location"> · {{ event.location }}</template>
        </p>
        <p
          v-if="event.moderation_status === 'refused' && event.refusal_reason"
          class="ev-refused"
        >{{ t('event.refusedReason', { reason: event.refusal_reason }) }}</p>
      </div>

      <svg
        class="ev-chev" :class="{ 'ev-chev--up': expanded }"
        viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>

    <div v-if="expanded" class="ev-detail">
      <p v-if="event.description" class="ev-desc">{{ event.description }}</p>
      <dl class="ev-facts">
        <div v-if="event.price"><dt>{{ t('editor.price') }}</dt><dd>{{ event.price }}</dd></div>
        <div v-if="ageText"><dt>{{ t('event.age') }}</dt><dd>{{ ageText }}</dd></div>
        <div v-if="pointsBadge"><dt>{{ t('event.loyaltyPoints') }}</dt><dd>{{ pointsBadge }}</dd></div>
        <div v-if="rebateText"><dt>{{ t('event.rebate') }}</dt><dd>{{ rebateText }}</dd></div>
        <div><dt>{{ t('event.attendees') }}</dt><dd>{{ attendees }}</dd></div>
      </dl>
    </div>

    <div class="ev-actions"><slot /></div>
  </div>
</template>

<style scoped>
.ev-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.ev-head {
  display: flex;
  align-items: center;
  gap: 13px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ev-head:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 8px;
}
.ev-thumb {
  width: 78px;
  height: 78px;
  flex: 0 0 auto;
  border-radius: 11px;
  background: #ece4d5 center/cover no-repeat;
}
.ev-info { flex: 1; min-width: 0; }
.ev-titleline { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.ev-titleline h3 { font-size: 1.02rem; color: var(--ink); }
.ev-meta { color: var(--mut); font-size: 0.8rem; margin-top: 3px; }
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
  transition: transform 0.2s;
}
.ev-chev--up { transform: rotate(180deg); }

/* ---- Expanded detail ---- */
.ev-detail {
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.ev-desc {
  font-size: 0.86rem;
  color: var(--ink);
  line-height: 1.5;
  white-space: pre-wrap;
  margin-bottom: 10px;
}
.ev-facts { display: flex; flex-direction: column; gap: 7px; }
.ev-facts > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.84rem;
}
.ev-facts dt {
  color: var(--mut);
  font-weight: 600;
}
.ev-facts dd { color: var(--ink); font-weight: 600; text-align: right; }

.ev-actions { display: flex; gap: 8px; }
.ev-actions:empty { display: none; }
.ev-actions :deep(.btn) { flex: 1; }
</style>
