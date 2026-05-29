<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useScope } from '../composables/useScope'
import { useDialog } from '../composables/useDialog'
import { supabase } from '../lib/supabase'
import {
  getEvent, createEvent, updateEvent, cancelEvent, deleteEvent, IMAGE_OPTIONS,
  uploadEventImage, listUploadedImages, deleteEventImage,
  materializeSeries, pushEventNow, rephraseText
} from '../lib/events'
import BackBar from '../components/BackBar.vue'

const route = useRoute()
const router = useRouter()
const { activeRestaurantId } = useScope()
const { confirm, alert } = useDialog()
const { t } = useI18n()

const editingId = computed(() => (route.name === 'event-edit' ? route.params.id : null))

// Local today as YYYY-MM-DD (the <input type="date"> format) — offset-corrected
// so it doesn't roll to yesterday/tomorrow in non-UTC timezones.
function todayStr() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

const form = ref({
  title: '', description: '', event_date: todayStr(),
  event_time: '', event_end_time: '',
  location: '', price: '', image_url: '/assets/photo1.jpg',
  age_min: null, age_max: null, points_min: null, points_max: null,
  announce_now: true,
  notify_days_before: 1,
  rebate_value: null, rebate_unit: 'percent', rebate_first_n: null,
  max_participants: null,
  recurrence: 'none',
  recurrence_pattern: 'date',
  recurrence_duration_n: 1,
  recurrence_duration_unit: 'mois',     // 'semaines' or 'mois'
  published: true, status: 'active'
})
const ageTargeted = ref(false)
const pointsTargeted = ref(false)
const rebateOn = ref(false)
const paidOn = ref(false)
const capacityOn = ref(false)
const fileInput = ref(null)
const uploadedImages = ref([])
const uploading = ref(false)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const aiBusy = ref(false)

function fillFrom(ev) {
  form.value = {
    title: ev.title || '', description: ev.description || '',
    event_date: ev.event_date || '',
    event_time: ev.event_time || '', event_end_time: ev.event_end_time || '',
    location: ev.location || '', price: ev.price || '',
    image_url: ev.image_url || '/assets/photo1.jpg',
    age_min: ev.age_min, age_max: ev.age_max,
    points_min: ev.points_min, points_max: ev.points_max,
    announce_now: ev.announce_now ?? false,
    notify_days_before: ev.notify_days_before ?? null,
    rebate_value: ev.rebate_value, rebate_unit: ev.rebate_unit || 'percent',
    rebate_first_n: ev.rebate_first_n,
    max_participants: ev.max_participants,
    recurrence: ev.recurrence || 'none',
    recurrence_pattern: ev.recurrence_pattern || 'date',
    published: ev.published, status: ev.status || 'active'
  }
  ageTargeted.value = !!(ev.age_min || ev.age_max)
  pointsTargeted.value = !!(ev.points_min || ev.points_max)
  rebateOn.value = ev.rebate_value != null
  paidOn.value = !!ev.price
  capacityOn.value = ev.max_participants != null
}

async function loadUploaded() {
  if (activeRestaurantId.value) {
    uploadedImages.value = await listUploadedImages(activeRestaurantId.value)
  }
}

// Tenant-specific image presets — pulled from vautcher_restaurants.config.gallery
// for whatever tenant is currently active. Falls back to the bundled
// La-Gioconda presets when the tenant has no gallery yet (older rows
// or scaffolds that ran before the gallery field was added).
const tenantGallery = ref([])
async function loadTenantGallery(id) {
  if (!id) { tenantGallery.value = []; return }
  const { data } = await supabase.from('vautcher_restaurants').select('config').eq('id', id).single()
  const raw = Array.isArray(data?.config?.gallery) ? data.config.gallery : []
  // Normalize both shapes the codebase already uses:
  //   diner shape  { src, caption }
  //   picker shape { url, label }
  tenantGallery.value = raw
    .map((g) => ({ url: g.url || g.src, label: g.label || g.caption || '' }))
    .filter((g) => g.url)
}
const galleryOptions = computed(() =>
  tenantGallery.value.length ? tenantGallery.value : IMAGE_OPTIONS
)
watch(activeRestaurantId, (id) => { loadTenantGallery(id) }, { immediate: true })

async function onPickFile(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file || !activeRestaurantId.value) return
  uploading.value = true
  error.value = ''
  try {
    const { url, path, error: e2 } = await uploadEventImage(activeRestaurantId.value, file)
    if (e2) { error.value = t('editor.uploadFailed'); return }
    uploadedImages.value.unshift({ url, path })
    form.value.image_url = url
  } catch (err) {
    error.value = t('editor.uploadFailed')
  } finally {
    uploading.value = false
  }
}

async function onDeleteImage(img) {
  const ok = await confirm({
    title: t('editor.confirmDeleteImageTitle'),
    body: t('editor.confirmDeleteImage'),
    confirmLabel: t('common.delete'),
    danger: true
  })
  if (!ok) return
  await deleteEventImage(img.path)
  uploadedImages.value = uploadedImages.value.filter((i) => i.path !== img.path)
  if (form.value.image_url === img.url) form.value.image_url = galleryOptions.value[0]?.url || IMAGE_OPTIONS[0].url
}

onMounted(async () => {
  loadUploaded()

  const sourceId = editingId.value || route.query.from
  if (!sourceId) { loading.value = false; return } // brand-new event

  // Watchdog — never leave the screen stuck on "loading".
  const watchdog = setTimeout(() => {
    if (loading.value) {
      loading.value = false
      if (!form.value.title) error.value = t('editor.loadFailed')
    }
  }, 8000)

  try {
    const { data, error: e } = await getEvent(sourceId)
    if (e) throw e
    if (data) {
      fillFrom(data)
      if (!editingId.value) {
        // Duplicating from history — default to today; owner can still change it.
        form.value.event_date = todayStr()
        form.value.status = 'active'
      }
    }
  } catch (err) {
    error.value = t('editor.loadError')
  } finally {
    clearTimeout(watchdog)
    loading.value = false
  }
})

const valid = computed(() => form.value.title.trim() && form.value.event_date)

// ---- Recurrence preview + day-of-week / week-of-month controls ----
// The event_date field carries both "first occurrence" and (implicitly)
// the weekday + week-of-month for the series. The controls below let
// the owner change the weekday or the week-of-month directly; we snap
// event_date forward to the next date that matches their pick — so an
// owner planning ahead can say "every Tuesday" without having to count
// out a Tuesday in the calendar themselves.
const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
function nthLabel(n) {
  if (n === 1) return '1ᵉʳ'
  return n + 'ᵉ'
}

function dateAsLocal(yyyymmdd) {
  return yyyymmdd ? new Date(yyyymmdd + 'T00:00:00') : null
}
function fmtYYYYMMDD(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

const recurDate = computed(() => dateAsLocal(form.value.event_date))
const recurWeekday = computed(() =>
  recurDate.value ? WEEKDAYS_FR[recurDate.value.getDay()] : ''
)
const recurNthOfMonth = computed(() =>
  recurDate.value ? Math.ceil(recurDate.value.getDate() / 7) : 0
)

// Day-of-week picker proxy for weekly / biweekly.
// Reading: getDay() of event_date. Writing: snap event_date to the next
// date (today or later) that lands on the picked weekday.
const selectedDow = computed({
  get() { return recurDate.value ? recurDate.value.getDay() : 0 },
  set(newDow) {
    const base = recurDate.value || new Date()
    const diff = (Number(newDow) - base.getDay() + 7) % 7
    const next = new Date(base)
    // If diff is 0 we keep the same date; otherwise jump forward.
    if (diff !== 0) next.setDate(next.getDate() + diff)
    form.value.event_date = fmtYYYYMMDD(next)
  }
})

// Monthly "Nth weekday" pattern needs two picks: the week of month
// (1..5) and the day of week. Writing either one snaps event_date so
// the Nth-weekday display stays consistent.
function snapToNthWeekday(n, dow) {
  const base = recurDate.value || new Date()
  // Build the candidate within the current month first.
  const first = new Date(base.getFullYear(), base.getMonth(), 1)
  const offset = (Number(dow) - first.getDay() + 7) % 7
  let candidate = new Date(first.getFullYear(), first.getMonth(), 1 + offset + (Number(n) - 1) * 7)
  // If the candidate has passed (in the past), or doesn't exist in this
  // month, roll forward to the next month.
  if (candidate.getMonth() !== first.getMonth() || candidate < base) {
    const nextFirst = new Date(base.getFullYear(), base.getMonth() + 1, 1)
    const nextOffset = (Number(dow) - nextFirst.getDay() + 7) % 7
    candidate = new Date(nextFirst.getFullYear(), nextFirst.getMonth(), 1 + nextOffset + (Number(n) - 1) * 7)
    if (candidate.getMonth() !== nextFirst.getMonth()) {
      // Nth occurrence doesn't exist next month — fall back to the
      // last one (i.e., subtract a week).
      candidate.setDate(candidate.getDate() - 7)
    }
  }
  form.value.event_date = fmtYYYYMMDD(candidate)
}
const monthlyDow = computed({
  get() { return selectedDow.value },
  set(v) { snapToNthWeekday(recurNthOfMonth.value || 1, v) }
})
const monthlyNth = computed({
  get() { return recurNthOfMonth.value || 1 },
  set(v) { snapToNthWeekday(v, selectedDow.value) }
})
// Toggle proxy — themed like the other opt-in sections (Offrir un
// rabais, Limiter participants). On = something other than 'none'.
const recurrenceOn = computed({
  get() { return form.value.recurrence !== 'none' },
  set(on) { form.value.recurrence = on ? 'weekly' : 'none' }
})

// When the recurrence type changes, pick a sensible default duration
// for that frequency so the owner doesn't have to think about it.
watch(() => form.value.recurrence, (r) => {
  if (r === 'weekly') {
    form.value.recurrence_duration_n = 1
    form.value.recurrence_duration_unit = 'mois'
  } else if (r === 'biweekly') {
    form.value.recurrence_duration_n = 3
    form.value.recurrence_duration_unit = 'mois'
  } else if (r === 'monthly') {
    form.value.recurrence_duration_n = 12
    form.value.recurrence_duration_unit = 'mois'
  }
})

// Convert "pendant X (semaines|mois)" → occurrences to materialise.
const recurCount = computed(() => {
  const n = Math.max(1, Number(form.value.recurrence_duration_n) || 1)
  const u = form.value.recurrence_duration_unit
  switch (form.value.recurrence) {
    case 'weekly':
      return u === 'semaines' ? n : n * 4
    case 'biweekly':
      return u === 'semaines' ? Math.max(1, Math.ceil(n / 2)) : n * 2
    case 'monthly':
      return n
    default:
      return 0
  }
})

const recurFirstLabel = computed(() => {
  if (!recurDate.value) return ''
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(recurDate.value)
})

const recurPreview = computed(() => {
  if (!recurDate.value || form.value.recurrence === 'none') return ''
  const wd = recurWeekday.value
  const n = recurCount.value
  const occ = `${n} occurrence${n > 1 ? 's' : ''}`
  switch (form.value.recurrence) {
    case 'weekly':
      return `Tous les ${wd}s — ${occ}.`
    case 'biweekly':
      return `Tous les deux ${wd}s — ${occ}.`
    case 'monthly':
      if (form.value.recurrence_pattern === 'weekday') {
        return `Le ${nthLabel(recurNthOfMonth.value)} ${wd} de chaque mois — ${occ}.`
      }
      return `Le ${recurDate.value.getDate()} de chaque mois — ${occ}.`
    default:
      return ''
  }
})

// "Améliorer avec l'IA" — rephrase the description (<=200 chars) via the
// rephrase-text edge function and drop the result back into the field.
async function improveDescription() {
  const text = form.value.description.trim()
  if (!text) {
    await alert({ title: t('editor.aiTitle'), body: t('editor.aiEmpty') })
    return
  }
  if (aiBusy.value) return
  aiBusy.value = true
  try {
    const { data, error: e } = await rephraseText(text)
    if (e || !data?.text) {
      await alert({ title: t('editor.aiTitle'), body: t('editor.aiFailed') })
      return
    }
    form.value.description = data.text
  } finally {
    aiBusy.value = false
  }
}

async function save() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''

  // Watchdog — never leave the button stuck on "Enregistrement…".
  const watchdog = setTimeout(() => {
    if (saving.value) {
      saving.value = false
      error.value = t('editor.saveFailed')
    }
  }, 12000)

  let savedId = null
  try {
    const payload = {
      restaurant_id: activeRestaurantId.value,
      title: form.value.title.trim(),
      description: form.value.description.trim(),
      event_date: form.value.event_date,
      event_time: form.value.event_time.trim() || null,
      event_end_time: form.value.event_end_time.trim() || null,
      location: form.value.location.trim() || null,
      price: paidOn.value ? (form.value.price.trim() || null) : null,
      image_url: form.value.image_url,
      age_min: ageTargeted.value ? (Number(form.value.age_min) || null) : null,
      age_max: ageTargeted.value ? (Number(form.value.age_max) || null) : null,
      points_min: pointsTargeted.value ? (Number(form.value.points_min) || null) : null,
      points_max: pointsTargeted.value ? (Number(form.value.points_max) || null) : null,
      // Announce + reminder are independent. announce_now broadcasts a
      // "Nouvel événement" push to all subscribers on approval; the
      // reminder fires notify_days_before (>=1) days before the event.
      // Both can be on at once; null reminder = no reminder.
      announce_now: !!form.value.announce_now,
      notify_days_before: (() => {
        const v = form.value.notify_days_before
        if (v === null || v === '' || v === undefined) return null
        const n = Number(v)
        return Number.isFinite(n) && n >= 1 ? n : null
      })(),
      rebate_value: rebateOn.value ? (Number(form.value.rebate_value) || null) : null,
      rebate_unit: form.value.rebate_unit,
      // rebate_first_n was the "rabais pour les N premiers" coupling.
      // The standalone "Limiter aux premiers inscrits" toggle now uses
      // max_participants exclusively, so this column is always cleared.
      rebate_first_n: null,
      max_participants: capacityOn.value
        ? (Number(form.value.max_participants) || null)
        : null,
      recurrence: form.value.recurrence || 'none',
      recurrence_pattern: form.value.recurrence === 'monthly'
        ? (form.value.recurrence_pattern || 'date')
        : 'date',
      published: true,
      status: form.value.status,
      // Creating or editing an event (re-)enters the moderation queue:
      // a refused event the owner has fixed returns to 'pending' for
      // review, and any stale refusal reason is cleared.
      moderation_status: 'pending',
      refusal_reason: null
    }

    const res = editingId.value
      ? await updateEvent(editingId.value, payload)
      : await createEvent(payload)
    if (res.error) { error.value = res.error.message; return }
    savedId = editingId.value || res.data?.id

    // For a brand-new recurring event, materialise the number of
    // occurrences the owner asked for via the duration picker.
    // Editing an existing event never re-materialises (would dupe rows).
    if (!editingId.value && form.value.recurrence !== 'none' && res.data?.id) {
      await materializeSeries(res.data.id, recurCount.value)
    }
  } catch (e) {
    error.value = (e && e.message) || String(e)
  } finally {
    clearTimeout(watchdog)
    saving.value = false
  }

  // Post-save: tell the owner when the push goes out, with the option to
  // send it now. Outside the saving guard so a slow response to the dialog
  // doesn't trip the 12s watchdog.
  if (savedId) {
    await showPushDialog(savedId)
    router.push({ name: 'dashboard' })
  }
}

// Reads back the saved row and explains the notification schedule. When a
// reminder is scheduled, offers "send now" — which broadcasts immediately
// and cancels the scheduled reminder (vautcher_event_push_now).
async function showPushDialog(id) {
  const { data: ev } = await getEvent(id)
  if (!ev) return

  const approved = ev.moderation_status === 'approved'
  const n = ev.notify_days_before
  const hasReminder = approved && typeof n === 'number' && n >= 1 && !ev.reminded_at

  const lines = []
  if (!approved) {
    lines.push(t('editor.savedPending'))
  } else {
    if (ev.announce_now) lines.push(t('editor.savedAnnounced'))
    if (hasReminder) {
      const d = new Date(ev.event_date + 'T00:00:00')
      d.setDate(d.getDate() - n)
      const date = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
      lines.push(t('editor.savedReminder', { date }))
    }
    if (!ev.announce_now && !hasReminder) lines.push(t('editor.savedNone'))
  }

  if (hasReminder) {
    const sendNow = await confirm({
      title: t('editor.savedTitle'),
      body: lines.join('\n') + '\n\n' + t('editor.savedPushNowQ'),
      confirmLabel: t('editor.pushNow'),
      cancelLabel: t('editor.keepSchedule')
    })
    if (sendNow) {
      const { error: e } = await pushEventNow(id)
      await alert({
        title: e ? t('editor.pushFailedTitle') : t('editor.pushSentTitle'),
        body: e ? t('editor.pushFailed') : t('editor.pushSentBody')
      })
    }
  } else {
    await alert({ title: t('editor.savedTitle'), body: lines.join('\n') })
  }
}

async function onCancelEvent() {
  const ok = await confirm({
    title: t('editor.confirmCancelTitle'),
    body: t('editor.confirmCancel'),
    confirmLabel: t('editor.cancelEvent'),
    cancelLabel: t('common.keep'),
    danger: true
  })
  if (!ok) return
  await cancelEvent(editingId.value)
  router.push({ name: 'dashboard' })
}

// Hard delete — removes the event (RSVPs cascade). Irreversible, so it's a
// danger confirm. Distinct from cancel (which keeps the row, status=cancelled).
async function onDeleteEvent() {
  const ok = await confirm({
    title: t('editor.confirmDeleteTitle'),
    body: t('editor.confirmDelete'),
    confirmLabel: t('editor.deleteBtn'),
    danger: true
  })
  if (!ok) return
  const { error: e } = await deleteEvent(editingId.value)
  if (e) { error.value = e.message; return }
  router.push({ name: 'dashboard' })
}
</script>

<template>
  <div class="page">
    <BackBar to="/" :label="editingId ? t('editor.editTitle') : t('editor.newTitle')" />

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <form v-else class="card editor" @submit.prevent="save">
      <div class="field">
        <label>{{ t('editor.title') }} *</label>
        <input v-model="form.title" type="text" :placeholder="t('editor.titlePlaceholder')" required />
      </div>

      <div class="field">
        <label>{{ t('editor.description') }}</label>
        <textarea v-model="form.description" rows="4"
          :placeholder="t('editor.descriptionPlaceholder')"></textarea>
        <button type="button" class="ai-btn" :disabled="aiBusy" @click="improveDescription">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
            <path d="M18 14l.7 2L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-1z" />
          </svg>
          <span>{{ aiBusy ? t('editor.aiBusy') : t('editor.aiRephrase') }}</span>
        </button>
        <span class="ai-hint">{{ t('editor.aiHint') }}</span>
      </div>

      <div class="field">
        <label>{{ t('editor.date') }} *</label>
        <input
          v-model="form.event_date"
          type="date"
          :min="todayStr()"
          class="date-input"
          required
        />
      </div>

      <div class="row2">
        <div class="field">
          <label>{{ t('editor.time') }}</label>
          <input v-model="form.event_time" type="text" :placeholder="t('editor.timePlaceholder')" />
        </div>
        <div class="field">
          <label>{{ t('editor.endTime') }}</label>
          <input
            v-model="form.event_end_time" type="text"
            :placeholder="t('editor.endTimePlaceholder')"
          />
        </div>
      </div>
      <p class="field-hint">{{ t('editor.endTimeHint') }}</p>

      <div class="field">
        <label>{{ t('editor.place') }}</label>
        <input v-model="form.location" type="text" :placeholder="t('editor.placePlaceholder')" />
      </div>

      <!-- Paid event toggle — by default the event is free (entrée libre). -->
      <div class="opt">
        <label class="toggle">
          <input type="checkbox" v-model="paidOn" />
          <span class="track"></span>
          <span class="tg-text">{{ t('editor.paid') }}</span>
        </label>
        <div v-if="paidOn" class="opt-body rebate-body">
          <label class="sub-label">{{ t('editor.priceLabel') }}</label>
          <p class="sub-hint">{{ t('editor.priceHint') }}</p>
          <input
            v-model="form.price"
            type="text"
            class="opt-select"
            :placeholder="t('editor.pricePlaceholder')"
          />
        </div>
        <span v-else class="opt-help">{{ t('editor.paidOpen') }}</span>
      </div>

      <!-- Rebate — sits next to the price so the "regular price"
           and the "discount on it" controls live together. -->
      <div class="opt">
        <label class="toggle">
          <input type="checkbox" v-model="rebateOn" />
          <span class="track"></span>
          <span class="tg-text">{{ t('editor.rebate') }}</span>
        </label>
        <div v-if="rebateOn" class="opt-body rebate-body">
          <div class="rebate-line">
            <span>{{ t('editor.rebateOf') }}</span>
            <input v-model="form.rebate_value" type="number" min="0" step="any"
              class="rb-val" placeholder="20" />
            <div class="rb-unit-seg">
              <button type="button" :class="{ on: form.rebate_unit === 'percent' }"
                @click="form.rebate_unit = 'percent'">%</button>
              <button type="button" :class="{ on: form.rebate_unit === 'chf' }"
                @click="form.rebate_unit = 'chf'">CHF</button>
            </div>
          </div>
        </div>
        <span class="opt-help">{{ t('editor.rebateHint') }}</span>
      </div>

      <!-- Limit registration to the first N — independent of the rebate. -->
      <div class="opt">
        <label class="toggle">
          <input type="checkbox" v-model="capacityOn" />
          <span class="track"></span>
          <span class="tg-text">{{ t('editor.capacity') }}</span>
        </label>
        <div v-if="capacityOn" class="opt-body rebate-line">
          <input v-model="form.max_participants" type="number" min="1"
            class="rb-val" placeholder="30" />
          <span>{{ t('editor.capacitySuffix') }}</span>
        </div>
        <span v-else class="opt-help">{{ t('editor.capacityOpen') }}</span>
      </div>

      <div class="field">
        <label>{{ t('editor.visual') }}</label>
        <div class="img-preview" :style="{ backgroundImage: `url(${form.image_url})` }">
          <span class="img-preview-tag">{{ t('editor.preview') }}</span>
        </div>
        <div class="img-picker">
          <button type="button" class="img-add" :disabled="uploading"
            @click="fileInput.click()">
            <template v-if="uploading">…</template>
            <template v-else>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <small>{{ t('editor.addImage') }}</small>
            </template>
          </button>
          <input ref="fileInput" type="file" accept="image/*" hidden @change="onPickFile" />

          <div v-for="img in uploadedImages" :key="img.path" class="img-cell">
            <button
              type="button"
              class="img-opt"
              :class="{ on: form.image_url === img.url }"
              :style="{ backgroundImage: `url(${img.url})` }"
              @click="form.image_url = img.url"
            ></button>
            <button type="button" class="img-del" aria-label="×"
              @click="onDeleteImage(img)">×</button>
          </div>

          <button
            v-for="img in galleryOptions"
            :key="img.url"
            type="button"
            class="img-opt"
            :class="{ on: form.image_url === img.url }"
            :style="{ backgroundImage: `url(${img.url})` }"
            @click="form.image_url = img.url"
          ></button>
        </div>
        <span class="opt-help" style="margin-left:0">{{ t('editor.imageHint') }}</span>
      </div>

      <!-- Recurrence — themed as an opt-in toggle, like "Offrir un rabais". -->
      <div class="opt">
        <label class="toggle">
          <input
            type="checkbox"
            v-model="recurrenceOn"
            :disabled="!!editingId"
          />
          <span class="track"></span>
          <span class="tg-text">{{ t('editor.recur') }}</span>
        </label>

        <div v-if="recurrenceOn && !editingId" class="opt-body recur-body">
          <!-- Frequency -->
          <select v-model="form.recurrence" class="opt-select">
            <option value="weekly">{{ t('editor.recurWeekly') }}</option>
            <option value="biweekly">{{ t('editor.recurBiweekly') }}</option>
            <option value="monthly">{{ t('editor.recurMonthly') }}</option>
          </select>

          <!-- Day-of-week picker for weekly / biweekly. -->
          <div
            v-if="form.recurrence === 'weekly' || form.recurrence === 'biweekly'"
            class="opt-sub"
          >
            <label class="sub-label">{{ t('editor.recurDow') }}</label>
            <select v-model.number="selectedDow" class="opt-select">
              <option :value="1">lundi</option>
              <option :value="2">mardi</option>
              <option :value="3">mercredi</option>
              <option :value="4">jeudi</option>
              <option :value="5">vendredi</option>
              <option :value="6">samedi</option>
              <option :value="0">dimanche</option>
            </select>
          </div>

          <!-- Monthly sub-mode: same date vs same Nth weekday -->
          <div v-if="form.recurrence === 'monthly'" class="opt-sub">
            <label class="rad">
              <input type="radio" v-model="form.recurrence_pattern" value="date" />
              <span>Le {{ recurDate ? recurDate.getDate() : '?' }} de chaque mois</span>
            </label>
            <label class="rad">
              <input type="radio" v-model="form.recurrence_pattern" value="weekday" />
              <span>Le {{ nthLabel(recurNthOfMonth) }} {{ recurWeekday }} de chaque mois</span>
            </label>

            <div v-if="form.recurrence_pattern === 'weekday'" class="monthly-pickers">
              <select v-model.number="monthlyNth" class="opt-select">
                <option :value="1">1ᵉʳ</option>
                <option :value="2">2ᵉ</option>
                <option :value="3">3ᵉ</option>
                <option :value="4">4ᵉ</option>
                <option :value="5">5ᵉ (ou dernier)</option>
              </select>
              <select v-model.number="monthlyDow" class="opt-select">
                <option :value="1">lundi</option>
                <option :value="2">mardi</option>
                <option :value="3">mercredi</option>
                <option :value="4">jeudi</option>
                <option :value="5">vendredi</option>
                <option :value="6">samedi</option>
                <option :value="0">dimanche</option>
              </select>
            </div>
          </div>

          <!-- Duration: "Pendant X semaine(s) / mois" -->
          <div class="opt-sub">
            <label class="sub-label">{{ t('editor.recurDuration') }}</label>
            <div class="duration-row">
              <input
                v-model.number="form.recurrence_duration_n"
                type="number" min="1" max="52"
                class="dur-n"
              />
              <select v-model="form.recurrence_duration_unit" class="opt-select">
                <option
                  v-if="form.recurrence !== 'monthly'"
                  value="semaines"
                >{{ form.recurrence_duration_n > 1 ? 'semaines' : 'semaine' }}</option>
                <option value="mois">mois</option>
              </select>
            </div>
          </div>

          <p v-if="recurPreview" class="recur-preview">{{ recurPreview }}</p>
          <p v-if="recurPreview" class="recur-first">
            {{ t('editor.recurFirst') }} <strong>{{ recurFirstLabel }}</strong>.
          </p>
        </div>

        <span v-if="editingId" class="opt-help">{{ t('editor.recurLocked') }}</span>
        <span v-else-if="!recurrenceOn" class="opt-help">{{ t('editor.recurOff') }}</span>
        <span v-else class="opt-help">{{ t('editor.recurHint') }}</span>
      </div>

      <!-- Informer le client — when to notify + who to target -->
      <div class="opt">
        <span class="tg-text">{{ t('editor.notify') }}</span>
        <label class="toggle" style="margin-top:8px">
          <input type="checkbox" v-model="form.announce_now" />
          <span class="track"></span>
          <span class="tg-text">{{ t('editor.announceNow') }}</span>
        </label>
        <div class="opt-body">
          <span class="opt-sublabel">{{ t('editor.remindLabel') }}</span>
          <select v-model="form.notify_days_before" class="opt-select">
            <option :value="null">{{ t('editor.remindNone') }}</option>
            <option :value="1">{{ t('editor.notifyDays', { n: 1 }) }}</option>
            <option :value="2">{{ t('editor.notifyDays', { n: 2 }) }}</option>
            <option :value="3">{{ t('editor.notifyDays', { n: 3 }) }}</option>
            <option :value="4">{{ t('editor.notifyDays', { n: 4 }) }}</option>
            <option :value="5">{{ t('editor.notifyDays', { n: 5 }) }}</option>
          </select>
        </div>
        <span class="opt-help">{{ t('editor.notifyHint') }}</span>

        <!-- Audience targeting: nested sub-toggles. Same controls as
             before, just moved inside Informer le client because they
             only matter for the notification audience. -->
        <div class="opt-children">
          <!-- Age targeting -->
          <div class="opt opt--nested">
            <label class="toggle">
              <input type="checkbox" v-model="ageTargeted" />
              <span class="track"></span>
              <span class="tg-text">{{ t('editor.ageTarget') }}</span>
            </label>
            <div v-if="ageTargeted" class="row2 opt-body">
              <input v-model="form.age_min" type="number" min="0" max="120" :placeholder="t('editor.ageMin')" />
              <input v-model="form.age_max" type="number" min="0" max="120" :placeholder="t('editor.ageMax')" />
            </div>
            <span v-else class="opt-help">{{ t('editor.ageOpen') }}</span>
          </div>

          <!-- Loyalty-points targeting -->
          <div class="opt opt--nested">
            <label class="toggle">
              <input type="checkbox" v-model="pointsTargeted" />
              <span class="track"></span>
              <span class="tg-text">{{ t('editor.pointsTarget') }}</span>
            </label>
            <div v-if="pointsTargeted">
              <div class="row2 opt-body">
                <input v-model="form.points_min" type="number" min="0" :placeholder="t('editor.pointsMin')" />
                <input v-model="form.points_max" type="number" min="0" :placeholder="t('editor.pointsMax')" />
              </div>
              <span class="opt-help" style="margin-left:0">{{ t('editor.pointsHint') }}</span>
            </div>
            <span v-else class="opt-help">{{ t('editor.pointsOpen') }}</span>
          </div>
        </div>
      </div>

      <p v-if="editingId" class="resubmit-note">{{ t('editor.resubmitNote') }}</p>

      <p v-if="error" class="err">{{ error }}</p>

      <div class="editor-actions">
        <button class="btn btn--full" type="submit" :disabled="!valid || saving">
          {{ saving ? t('editor.saving') : (editingId ? t('editor.save') : t('editor.createBtn')) }}
        </button>
        <button
          v-if="editingId && form.status !== 'cancelled'"
          type="button"
          class="btn btn--danger btn--full"
          @click="onCancelEvent"
        >{{ t('editor.cancelEvent') }}</button>
        <button
          v-if="editingId"
          type="button"
          class="btn btn--plain btn--full editor-delete"
          @click="onDeleteEvent"
        >{{ t('editor.deleteBtn') }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.editor { padding: 20px 18px; }

/* ---- Image preview + picker ---- */
.img-preview {
  width: 100%;
  height: 150px;
  border-radius: 11px;
  background: #ece4d5 center/cover no-repeat;
  margin-bottom: 10px;
  position: relative;
}
.img-preview-tag {
  position: absolute;
  bottom: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 6px;
}
.img-picker { display: flex; gap: 8px; flex-wrap: wrap; }
.img-opt {
  width: 78px;
  height: 58px;
  border-radius: 9px;
  border: 0;
  outline: 3px solid transparent;
  outline-offset: -3px;
  background: #ece4d5 center/cover no-repeat;
  cursor: pointer;
  padding: 0;
}
.img-opt.on { outline-color: var(--accent); }
.img-cell { position: relative; }
.img-del {
  position: absolute; top: -6px; right: -6px;
  width: 22px; height: 22px;
  border: 0; border-radius: 50%;
  background: var(--danger); color: #fff;
  font-size: 1rem; line-height: 1; font-weight: 700;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.32);
}
.img-add {
  width: 78px; height: 58px;
  border-radius: 9px;
  border: 2px dashed var(--line);
  background: #faf4ea;
  color: var(--accent);
  cursor: pointer;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 2px;
}
.img-add svg { width: 20px; height: 20px; }
.img-add small { font-size: 0.62rem; font-weight: 700; }
.img-add:disabled { opacity: 0.55; }

/* ---- Toggle option rows ---- */
.opt {
  border-top: 1px solid var(--line);
  padding: 18px 0 18px;
  margin-top: 4px;
}
/* Extra breathing room when an .opt is immediately followed by a
   plain .field (e.g. Visuel right after the last opt-toggle). */
.opt + .field { margin-top: 8px; }

/* Nested toggle group (audience targeting inside "Informer le client").
   Sits indented under the parent's main content, with thinner top
   borders so the children read as subordinate to the section. */
.opt-children {
  margin: 14px 0 0 24px;
  padding-left: 14px;
  border-left: 2px solid var(--line);
}
.opt-children .opt--nested {
  border-top-style: dashed;
  border-top-color: rgba(0, 0, 0, 0.08);
  padding: 12px 0;
  margin-top: 0;
}
.opt-children .opt--nested:first-child {
  border-top: 0;
  padding-top: 0;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}
.toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.toggle .track {
  flex: 0 0 auto;
  width: 44px; height: 26px;
  border-radius: 999px;
  background: #d8cdba;
  position: relative;
  transition: background 0.18s;
}
.toggle .track::after {
  content: '';
  position: absolute; top: 3px; left: 3px;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.32);
  transition: transform 0.18s;
}
.toggle input:checked + .track { background: var(--accent); }
.toggle input:checked + .track::after { transform: translateX(18px); }
.toggle input:focus-visible + .track { box-shadow: 0 0 0 3px rgba(158, 5, 61, 0.25); }
.tg-text { font-weight: 600; font-size: 0.9rem; }

.toggle.sub .track { width: 38px; height: 22px; }
.toggle.sub .track::after { width: 16px; height: 16px; }
.toggle.sub input:checked + .track::after { transform: translateX(16px); }
.toggle.sub .tg-text { font-size: 0.84rem; }

.opt-body { margin: 12px 0 4px; }
.opt-select {
  width: 100%;
  font-family: inherit;
  font-size: 0.95rem;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
}
.opt-select:disabled { opacity: 0.55; cursor: not-allowed; }
.field-hint {
  margin: -8px 0 16px;
  font-size: 0.74rem;
  color: var(--mut);
  line-height: 1.45;
}
/* iOS Safari centers a type=date input by default. Pull the value
   text back left so it reads consistently with the other fields. */
.date-input {
  text-align: left;
  -webkit-appearance: none;
  appearance: none;
}
.recur-body {
  margin-left: 56px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.opt-sub { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.sub-label {
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mut);
}
.sub-hint {
  font-size: 0.78rem;
  color: var(--mut);
  line-height: 1.45;
  margin: 4px 0 8px;
}
.rad { display: flex; align-items: center; gap: 9px; font-size: 0.9rem; cursor: pointer; }
.rad input { accent-color: var(--accent); }
.monthly-pickers {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.monthly-pickers .opt-select { flex: 1; }
.duration-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dur-n {
  flex: 0 0 90px;
  width: 90px;
  text-align: center;
  font-family: inherit;
  font-size: 0.95rem;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
}
.duration-row .opt-select { flex: 1; }
.recur-preview {
  margin: 10px 0 0;
  padding: 8px 11px;
  background: #fdf3f6;
  border: 1px solid #f3d3df;
  border-radius: 8px;
  font-size: 0.84rem;
  color: var(--accent-dark);
}
.recur-first {
  margin: 6px 0 0;
  font-size: 0.8rem;
  color: var(--mut);
}
.recur-first strong { color: var(--ink); }
.opt-help {
  display: block;
  font-size: 0.74rem;
  color: var(--mut);
  margin: 7px 0 0 56px;
  line-height: 1.45;
}
.opt-sublabel {
  display: block;
  font-size: 0.78rem;
  color: var(--mut);
  margin-bottom: 5px;
}
.ai-btn {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 9px;
  font-family: inherit; font-weight: 700; font-size: 0.8rem;
  color: var(--accent);
  background: #fff; border: 1.5px solid var(--line); border-radius: 999px;
  padding: 8px 14px; cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}
.ai-btn:hover { background: #faf4ea; border-color: var(--accent); }
.ai-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ai-btn svg { width: 16px; height: 16px; }
.ai-hint { display: block; font-size: 0.72rem; color: var(--mut); margin-top: 6px; }

.rebate-body { margin-left: 56px; }
.rebate-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  margin: 10px 0;
  flex-wrap: wrap;
}
.rb-val { width: 76px; text-align: center; padding: 8px 6px; }
.rb-unit-seg {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 9px;
  overflow: hidden;
}
.rb-unit-seg button {
  border: 0;
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-weight: 700;
  font-size: 0.85rem;
  padding: 9px 15px;
  cursor: pointer;
}
.rb-unit-seg button + button { border-left: 1px solid var(--line); }
.rb-unit-seg button.on { background: var(--accent); color: #fff; }
.rebate-note {
  display: block;
  font-size: 0.8rem;
  color: var(--mut);
  margin-top: 8px;
}

.err {
  color: var(--danger);
  font-weight: 600;
  font-size: 0.85rem;
  margin: 14px 0 0;
}
.resubmit-note {
  font-size: 0.78rem;
  color: var(--mut);
  line-height: 1.45;
  margin: 16px 0 0;
}
.editor-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}
</style>
