<script setup>
// Owner / moderator read-only event view. Mirrors the diner's
// EventDetailView visually but adds the inscrits count (owner-only)
// and two action buttons at the bottom: Modifier (→ editor) and
// Annuler l'événement/offre.
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getEvent, listEventStats, cancelEvent } from '../lib/events'
import { useDialog } from '../composables/useDialog'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const { confirm } = useDialog()

const event = ref(null)
const attendees = ref(0)
const loading = ref(true)
const loadError = ref(false)
const busy = ref(false)

const fullDate = computed(() => {
  if (!event.value?.event_date) return ''
  return new Intl.DateTimeFormat(locale.value, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(event.value.event_date + 'T00:00:00'))
})

const rebateText = computed(() => {
  const ev = event.value
  if (!ev?.rebate_value) return ''
  const amount = ev.rebate_unit === 'chf' ? `${ev.rebate_value} CHF` : `${ev.rebate_value} %`
  return `Rabais de ${amount}`
})

const ageText = computed(() => {
  const ev = event.value
  if (!ev) return ''
  if (ev.age_min && ev.age_max) return t('event.ageRange', { min: ev.age_min, max: ev.age_max })
  if (ev.age_min) return t('event.ageMinOnly', { min: ev.age_min })
  if (ev.age_max) return t('event.ageMaxOnly', { max: ev.age_max })
  return ''
})

const pointsText = computed(() => {
  const ev = event.value
  if (!ev) return ''
  if (ev.points_min && ev.points_max) return `${ev.points_min}–${ev.points_max} pts`
  if (ev.points_min) return `≥${ev.points_min} pts`
  if (ev.points_max) return `≤${ev.points_max} pts`
  return ''
})

const recurLabel = computed(() => {
  const r = event.value?.recurrence
  if (!r || r === 'none') return ''
  return t('event.recur.' + r)
})

const statusBadge = computed(() => {
  const ev = event.value
  if (!ev) return null
  if (ev.status === 'cancelled') return { label: t('event.cancelled'), cls: 'badge--cancel' }
  if (ev.moderation_status === 'refused') return { label: t('event.refused'), cls: 'badge--cancel' }
  if (ev.moderation_status === 'pending') return { label: t('event.pending'), cls: 'badge--pending' }
  if (ev.published) return { label: t('event.published'), cls: 'badge--ok' }
  return { label: t('event.draft'), cls: 'badge--off' }
})

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const [{ data, error }, stats] = await Promise.all([
      getEvent(route.params.id),
      listEventStats()
    ])
    if (error || !data) { loadError.value = true; return }
    event.value = data
    attendees.value = stats?.[data.id] || 0
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => route.params.id, load)

function goEdit() {
  router.push({ name: 'event-edit', params: { id: event.value.id } })
}

async function onCancel() {
  if (!event.value || busy.value) return
  const ok = await confirm({
    title: t('editor.confirmCancelTitle'),
    body: t('editor.confirmCancel'),
    confirmLabel: t('editor.cancelEvent'),
    cancelLabel: t('common.keep'),
    danger: true
  })
  if (!ok) return
  busy.value = true
  try {
    await cancelEvent(event.value.id)
    router.push({ name: 'dashboard' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page">
    <RouterLink :to="{ name: 'dashboard' }" class="back-link">‹ {{ t('nav.events') }}</RouterLink>

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <div v-else-if="loadError || !event" class="empty">
      {{ t('editor.loadError') }}
      <button class="btn btn--plain btn--sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <article v-else class="evd">
      <div
        class="evd-hero"
        :style="event.image_url ? { backgroundImage: `url(${event.image_url})` } : null"
      >
        <span v-if="statusBadge" class="evd-status" :class="statusBadge.cls">
          {{ statusBadge.label }}
        </span>
      </div>

      <div class="evd-body">
        <h1>{{ event.title }}</h1>

        <ul class="evd-meta">
          <li><span class="ic">📅</span>{{ fullDate }}</li>
          <li v-if="event.event_time">
            <span class="ic">🕖</span>{{ event.event_time }}<template v-if="event.event_end_time"> – {{ event.event_end_time }}</template>
          </li>
          <li v-if="event.location"><span class="ic">📍</span>{{ event.location }}</li>
          <li v-if="event.price"><span class="ic">🎟️</span>{{ event.price }}</li>
          <li v-if="recurLabel"><span class="ic">🔁</span>{{ recurLabel }}</li>
        </ul>

        <p v-if="rebateText" class="evd-rebate">🎁 {{ rebateText }}</p>

        <!-- Owner-only "X inscrit(s)" line. -->
        <p class="evd-count">
          <strong>{{ attendees }}</strong>
          {{ attendees === 1 ? t('event.attendeesOne') : t('event.attendeesMany') }}
        </p>

        <p v-if="event.description" class="evd-desc">{{ event.description }}</p>

        <div v-if="ageText || pointsText" class="evd-target">
          <span v-if="ageText" class="evd-tag">{{ t('event.age') }} : {{ ageText }}</span>
          <span v-if="pointsText" class="evd-tag">{{ t('event.loyaltyPoints') }} : {{ pointsText }}</span>
        </div>

        <p
          v-if="event.moderation_status === 'refused' && event.refusal_reason"
          class="evd-refused"
        >{{ t('event.refusedReason', { reason: event.refusal_reason }) }}</p>

        <div class="evd-actions">
          <button type="button" class="btn btn--full" @click="goEdit">
            {{ t('common.edit') }}
          </button>
          <button
            v-if="event.status !== 'cancelled'"
            type="button"
            class="btn btn--danger btn--full"
            :disabled="busy"
            @click="onCancel"
          >{{ t('editor.cancelEvent') }}</button>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.evd {
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.08);
  margin-top: 8px;
}
.evd-hero {
  position: relative;
  height: 220px;
  background: #ece4d5 center/cover no-repeat;
}
.evd-status {
  position: absolute; top: 14px; right: 14px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 5px 11px;
  border-radius: 20px;
  text-transform: uppercase;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
}

.evd-body { padding: 22px 20px 24px; }
.evd-body h1 {
  font-size: clamp(1.5rem, 5vw, 2rem);
  margin: 0 0 14px;
  line-height: 1.15;
  color: var(--ink);
}

.evd-meta {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  margin: 0 0 14px;
}
.evd-meta li {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 0.92rem;
  color: var(--ink);
}
.evd-meta .ic { font-size: 1rem; flex: 0 0 22px; text-align: center; }

.evd-rebate {
  display: inline-block;
  background: linear-gradient(135deg, #fbeec4, #f3d98c);
  color: #6e5414;
  font-size: 0.88rem;
  font-weight: 700;
  padding: 7px 12px;
  border-radius: 10px;
  margin-bottom: 14px;
}

.evd-count {
  font-size: 0.94rem;
  font-weight: 600;
  color: var(--accent);
  margin: 0 0 14px;
}
.evd-count strong {
  font-family: 'Rufina', serif;
  font-size: 1.15rem;
  margin-right: 4px;
}

.evd-desc {
  font-size: 0.96rem;
  color: var(--ink);
  line-height: 1.6;
  white-space: pre-wrap;
  margin: 0 0 18px;
}
.evd-target {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 18px;
}
.evd-tag {
  font-size: 0.78rem;
  background: #faf4ea;
  color: var(--mut);
  border-radius: 8px;
  padding: 5px 10px;
}
.evd-refused {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--danger);
  margin: 6px 0 18px;
  padding: 9px 11px;
  background: rgba(220, 38, 38, 0.07);
  border-radius: 8px;
}

.evd-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
}

.back-link { display: inline-block; margin-bottom: 6px; }
.retry { display: block; margin: 14px auto 0; }
</style>
