<script setup>
// Owner / moderator event preview. The top half intentionally mirrors
// what the diner sees pixel-for-pixel (hero + meta list + rebate +
// description + a Je-participe button that's disabled here) so the
// owner can vet exactly what's published. The bottom half is the
// owner-only zone: inscrits count + Modifier + Annuler actions.
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getEvent, listEventStats, cancelEvent } from '../lib/events'
import { useDialog } from '../composables/useDialog'
import BackBar from '../components/BackBar.vue'

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
    <BackBar :to="{ name: 'dashboard' }" :label="event ? event.title : t('nav.events')" />

    <div class="preview-flag">
      <span class="dot"></span>
      {{ t('detail.previewBanner') }}
    </div>

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <div v-else-if="loadError || !event" class="empty">
      {{ t('editor.loadError') }}
      <button class="btn btn--plain btn--sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <template v-else>
      <!-- ============================================
           Client-facing preview — visually mirrors the
           diner app's EventDetailView.
           ============================================ -->
      <article class="client-preview">
        <div
          class="cp-hero"
          :style="event.image_url ? { backgroundImage: `url(${event.image_url})` } : null"
        >
          <span v-if="statusBadge" class="cp-status" :class="statusBadge.cls">
            {{ statusBadge.label }}
          </span>
        </div>

        <div class="cp-body">
          <h1>{{ event.title }}</h1>

          <ul class="cp-meta">
            <li><span class="ic">📅</span>{{ fullDate }}</li>
            <li v-if="event.event_time">
              <span class="ic">🕖</span>{{ event.event_time }}<template v-if="event.event_end_time"> – {{ event.event_end_time }}</template>
            </li>
            <li v-if="event.location"><span class="ic">📍</span>{{ event.location }}</li>
            <li v-if="event.price"><span class="ic">🎟️</span>{{ event.price }}</li>
            <li v-if="recurLabel"><span class="ic">🔁</span>{{ recurLabel }}</li>
          </ul>

          <p v-if="rebateText" class="cp-rebate">🎁 {{ rebateText }}</p>

          <p v-if="event.description" class="cp-desc">{{ event.description }}</p>

          <!-- The diner's call-to-action, rendered disabled so the
               owner sees exactly the button their customer will see. -->
          <button type="button" class="cp-btn" disabled>
            {{ event.max_participants && attendees >= event.max_participants
              ? 'Complet'
              : 'Je participe' }}
          </button>
        </div>
      </article>

      <!-- ============================================
           Owner-only zone — only restowner shows this.
           ============================================ -->
      <section class="owner-zone">
        <h2 class="owner-zone-title">{{ t('detail.ownerZoneTitle') }}</h2>

        <RouterLink
          :to="{ name: 'event-attendees', params: { id: event.id } }"
          class="owner-stat owner-stat--link"
        >
          <span class="os-text">
            <strong>{{ attendees }}</strong>
            {{ attendees === 1 ? t('event.attendeesOne') : t('event.attendeesMany') }}
          </span>
          <svg class="os-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </RouterLink>

        <div v-if="ageText || pointsText" class="owner-targets">
          <span v-if="ageText" class="owner-tag">{{ t('event.age') }} : {{ ageText }}</span>
          <span v-if="pointsText" class="owner-tag">{{ t('event.loyaltyPoints') }} : {{ pointsText }}</span>
        </div>

        <p
          v-if="event.moderation_status === 'refused' && event.refusal_reason"
          class="owner-refused"
        >{{ t('event.refusedReason', { reason: event.refusal_reason }) }}</p>

        <div class="owner-actions">
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
      </section>
    </template>
  </div>
</template>

<style scoped>
.retry { display: block; margin: 14px auto 0; }

/* ---- Preview banner ---- */
.preview-flag {
  display: flex;
  align-items: center;
  gap: 9px;
  background: #fdf3f6;
  border: 1px solid #f3d3df;
  color: var(--accent-dark);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 9px 13px;
  border-radius: 10px;
  margin-bottom: 14px;
}
.preview-flag .dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--accent);
  flex: 0 0 auto;
  animation: pulse 1.6s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.8); }
}

/* ---- Client-facing preview ----
   Class prefix .cp- + neutral burgundy tones so the look reads as
   the diner-side, not as a restowner form. */
.client-preview {
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.08);
}
.cp-hero {
  position: relative;
  height: 220px;
  background: #ece4d5 center/cover no-repeat;
}
.cp-status {
  position: absolute; top: 14px; right: 14px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 5px 11px;
  border-radius: 20px;
  text-transform: uppercase;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
}

.cp-body { padding: 22px 20px 24px; }
.cp-body h1 {
  font-family: 'Rufina', Georgia, serif;
  font-size: clamp(1.5rem, 5vw, 2rem);
  margin: 0 0 14px;
  line-height: 1.15;
  color: var(--ink);
}

.cp-meta {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  margin: 0 0 14px;
}
.cp-meta li {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 0.92rem;
  color: var(--mut);
}
.cp-meta .ic { font-size: 1rem; flex: 0 0 22px; text-align: center; }

.cp-rebate {
  display: inline-block;
  background: linear-gradient(135deg, #fbeec4, #f3d98c);
  color: #6e5414;
  font-size: 0.88rem;
  font-weight: 700;
  padding: 7px 12px;
  border-radius: 10px;
  margin-bottom: 14px;
}
.cp-desc {
  font-size: 0.96rem;
  color: var(--ink);
  line-height: 1.6;
  white-space: pre-wrap;
  margin: 0 0 18px;
}
.cp-btn {
  display: block;
  width: 100%;
  border: 0;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font-family: inherit;
  font-weight: 700;
  font-size: 0.92rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 14px 22px;
  opacity: 0.85;
  cursor: not-allowed;
}

/* ---- Owner-only zone ---- */
.owner-zone {
  margin-top: 22px;
  background: #faf4ea;
  border: 1px dashed var(--line);
  border-radius: 12px;
  padding: 16px 18px 20px;
}
.owner-zone-title {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mut);
  margin: 0 0 10px;
}
.owner-stat {
  font-size: 0.96rem;
  font-weight: 600;
  color: var(--accent);
  margin: 0 0 12px;
}
.owner-stat strong {
  font-family: 'Rufina', serif;
  font-size: 1.2rem;
  margin-right: 4px;
}
/* Tap-target variant when the count links to the inscrits list. */
.owner-stat--link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
}
.owner-stat--link:hover {
  border-color: var(--accent);
  background: #fdf3f6;
}
.os-text { display: flex; align-items: center; }
.os-chev { width: 18px; height: 18px; color: var(--mut); flex: 0 0 auto; }
.owner-targets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}
.owner-tag {
  font-size: 0.78rem;
  background: #fff;
  color: var(--mut);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 5px 10px;
}
.owner-refused {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--danger);
  margin: 0 0 14px;
  padding: 9px 11px;
  background: rgba(220, 38, 38, 0.07);
  border-radius: 8px;
}
.owner-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
