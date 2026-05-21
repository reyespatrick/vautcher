<script setup>
import { computed } from 'vue'
import { formatDate, ageLabel } from '../lib/format'

const props = defineProps({ event: { type: Object, required: true } })
const isAgeTargeted = computed(() => props.event.age_min || props.event.age_max)
const rebateBadge = computed(() => {
  const v = props.event.rebate_value
  if (!v) return ''
  return props.event.rebate_unit === 'chf' ? `−${v} CHF` : `−${v}%`
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
        <span v-if="event.status === 'cancelled'" class="badge badge--cancel">Annulé</span>
        <span v-else-if="event.published" class="badge badge--ok">Publié</span>
        <span v-else class="badge badge--off">Brouillon</span>
        <span v-if="isAgeTargeted" class="badge badge--age">{{ ageLabel(event) }}</span>
        <span v-if="rebateBadge" class="badge badge--rebate">{{ rebateBadge }}</span>
      </div>
      <p class="ev-meta">
        {{ formatDate(event.event_date) }}<template v-if="event.event_time"> · {{ event.event_time }}</template><template v-if="event.location"> · {{ event.location }}</template>
      </p>
      <p v-if="event.notify_days_before" class="ev-notify">
        🔔 Notification programmée {{ event.notify_days_before }} j avant
      </p>
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
.ev-notify { color: var(--accent); font-size: 0.74rem; font-weight: 700; margin-top: 5px; }
.ev-actions {
  display: flex;
  gap: 8px;
  width: 100%;
}
.ev-actions:empty { display: none; }
.ev-actions :deep(.btn) { flex: 1; }
</style>
