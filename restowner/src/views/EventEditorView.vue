<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import {
  getEvent, createEvent, updateEvent, cancelEvent, IMAGE_OPTIONS,
  uploadEventImage, listUploadedImages, deleteEventImage
} from '../lib/events'

const route = useRoute()
const router = useRouter()
const { restaurant } = useAuth()
const { t } = useI18n()

const editingId = computed(() => (route.name === 'event-edit' ? route.params.id : null))

const form = ref({
  title: '', description: '', event_date: '', event_time: '',
  location: '', price: '', image_url: '/assets/photo1.jpg',
  age_min: null, age_max: null, notify_days_before: 3,
  rebate_value: null, rebate_unit: 'percent', rebate_first_n: null,
  published: true, status: 'active'
})
const ageTargeted = ref(false)
const rebateOn = ref(false)
const rebateLimited = ref(false)
const fileInput = ref(null)
const uploadedImages = ref([])
const uploading = ref(false)
const loading = ref(true)
const saving = ref(false)
const error = ref('')

function fillFrom(ev) {
  form.value = {
    title: ev.title || '', description: ev.description || '',
    event_date: ev.event_date || '', event_time: ev.event_time || '',
    location: ev.location || '', price: ev.price || '',
    image_url: ev.image_url || '/assets/photo1.jpg',
    age_min: ev.age_min, age_max: ev.age_max,
    notify_days_before: ev.notify_days_before ?? 3,
    rebate_value: ev.rebate_value, rebate_unit: ev.rebate_unit || 'percent',
    rebate_first_n: ev.rebate_first_n,
    published: ev.published, status: ev.status || 'active'
  }
  ageTargeted.value = !!(ev.age_min || ev.age_max)
  rebateOn.value = ev.rebate_value != null
  rebateLimited.value = ev.rebate_first_n != null
}

async function loadUploaded() {
  if (restaurant.value) {
    uploadedImages.value = await listUploadedImages(restaurant.value.id)
  }
}

async function onPickFile(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file || !restaurant.value) return
  uploading.value = true
  error.value = ''
  const { url, path, error: e2 } = await uploadEventImage(restaurant.value.id, file)
  uploading.value = false
  if (e2) { error.value = t('editor.uploadFailed'); return }
  uploadedImages.value.unshift({ url, path })
  form.value.image_url = url
}

async function onDeleteImage(img) {
  if (!confirm(t('editor.confirmDeleteImage'))) return
  await deleteEventImage(img.path)
  uploadedImages.value = uploadedImages.value.filter((i) => i.path !== img.path)
  if (form.value.image_url === img.url) form.value.image_url = IMAGE_OPTIONS[0].url
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
        // Duplicating from history — owner picks a fresh date.
        form.value.event_date = ''
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

async function save() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''

  const payload = {
    restaurant_id: restaurant.value.id,
    title: form.value.title.trim(),
    description: form.value.description.trim(),
    event_date: form.value.event_date,
    event_time: form.value.event_time.trim() || null,
    location: form.value.location.trim() || null,
    price: form.value.price.trim() || null,
    image_url: form.value.image_url,
    age_min: ageTargeted.value ? (Number(form.value.age_min) || null) : null,
    age_max: ageTargeted.value ? (Number(form.value.age_max) || null) : null,
    notify_days_before: null,
    rebate_value: rebateOn.value ? (Number(form.value.rebate_value) || null) : null,
    rebate_unit: form.value.rebate_unit,
    rebate_first_n: (rebateOn.value && rebateLimited.value)
      ? (Number(form.value.rebate_first_n) || null)
      : null,
    published: true,
    status: form.value.status
  }

  let err
  if (editingId.value) {
    err = (await updateEvent(editingId.value, payload)).error
  } else {
    err = (await createEvent(payload)).error
  }
  saving.value = false
  if (err) { error.value = err.message; return }
  router.push({ name: 'dashboard' })
}

async function onCancelEvent() {
  if (!confirm(t('editor.confirmCancel'))) return
  await cancelEvent(editingId.value)
  router.push({ name: 'dashboard' })
}
</script>

<template>
  <div class="page">
    <RouterLink to="/" class="back-link">‹ {{ t('nav.events') }}</RouterLink>
    <div class="page-head">
      <h1>{{ editingId ? t('editor.editTitle') : t('editor.newTitle') }}</h1>
    </div>

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
      </div>

      <div class="row2">
        <div class="field">
          <label>{{ t('editor.date') }} *</label>
          <input v-model="form.event_date" type="date" required />
        </div>
        <div class="field">
          <label>{{ t('editor.time') }}</label>
          <input v-model="form.event_time" type="text" :placeholder="t('editor.timePlaceholder')" />
        </div>
      </div>

      <div class="row2">
        <div class="field">
          <label>{{ t('editor.place') }}</label>
          <input v-model="form.location" type="text" :placeholder="t('editor.placePlaceholder')" />
        </div>
        <div class="field">
          <label>{{ t('editor.price') }}</label>
          <input v-model="form.price" type="text" :placeholder="t('editor.pricePlaceholder')" />
        </div>
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
            v-for="img in IMAGE_OPTIONS"
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

      <!-- Age targeting -->
      <div class="opt">
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

      <!-- Rebate -->
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
            <select v-model="form.rebate_unit" class="rb-unit">
              <option value="percent">%</option>
              <option value="chf">CHF</option>
            </select>
          </div>

          <label class="toggle sub">
            <input type="checkbox" v-model="rebateLimited" />
            <span class="track"></span>
            <span class="tg-text">{{ t('editor.rebateLimit') }}</span>
          </label>
          <div v-if="rebateLimited" class="rebate-line">
            <span>{{ t('editor.rebateForFirst') }}</span>
            <input v-model="form.rebate_first_n" type="number" min="1"
              class="rb-val" placeholder="30" />
            <span>{{ t('editor.rebateFirstSuffix') }}</span>
          </div>
          <span v-else class="rebate-note">{{ t('editor.rebateNoLimit') }}</span>
        </div>
        <span class="opt-help">{{ t('editor.rebateHint') }}</span>
      </div>

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
  padding: 14px 0 4px;
  margin-top: 4px;
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
.opt-help {
  display: block;
  font-size: 0.74rem;
  color: var(--mut);
  margin: 7px 0 0 56px;
  line-height: 1.45;
}

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
.rb-unit { width: 80px; padding: 8px 6px; }
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
.editor-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 20px;
}
</style>
