<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({ event: { type: Object, required: true } })
const { t, locale } = useI18n()

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
</script>

<template>
  <div class="ev-row card">
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

    <div class="ev-actions"><slot /></div>
  </div>
</template>

<style scoped>
.ev-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 13px;
  padding: 12px;
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
.ev-actions {
  display: flex;
  gap: 8px;
  width: 100%;
}
.ev-actions:empty { display: none; }
.ev-actions :deep(.btn) { flex: 1; }
</style>
