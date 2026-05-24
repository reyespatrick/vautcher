<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getRestaurant, updateRestaurant, uploadRestaurantLogo } from '../lib/admin'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const restaurantId = computed(() => route.params.id)

// Empty config skeleton — the diner-app fallback shape.
function emptyConfig() {
  return {
    tagline: '',
    address: '', phone: '', phone_href: '', email: '', maps_href: '',
    logo_url: '/assets/logo.jpg',
    brand_primary: '#9e053d', brand_dark: '#6f032b', theme_color: '#9e053d',
    heading_font: '', google_fonts_families: [],
    pwa_name: '', pwa_short_name: '', pwa_description: '',
    hours: [],
    hero: { eyebrow: '', title: '', lead: '' },
    about: { kicker: '', title: '', image_url: '', paragraphs: [] },
    specialties: [],
    gallery: []
  }
}

const form = ref({ name: '', slug: '', config: emptyConfig() })
const paragraphsText = ref('')   // about.paragraphs editor uses a textarea
const loading = ref(true)
const saving = ref(false)
const uploading = ref(false)
const error = ref('')
const fileInput = ref(null)
const importJson = ref('')
const importMsg = ref('')
const importErr = ref(false)

// Accepts the JSON produced by scripts/extract-restaurant.js
// ({ name, slug?, config: {...} }) and merges it into the form.
// Slug isn't overwritten when null/empty.
function doImport() {
  importMsg.value = ''
  importErr.value = false
  try {
    const parsed = JSON.parse(importJson.value)
    if (parsed.name) form.value.name = String(parsed.name)
    if (parsed.slug) form.value.slug = String(parsed.slug)
    if (parsed.config && typeof parsed.config === 'object') {
      form.value.config = { ...emptyConfig(), ...parsed.config }
      paragraphsText.value = (form.value.config.about?.paragraphs || []).join('\n\n')
    }
    importMsg.value = t('config.importOk')
  } catch (e) {
    importMsg.value = t('config.importErr')
    importErr.value = true
  }
}

onMounted(async () => {
  const watchdog = setTimeout(() => {
    if (loading.value) { loading.value = false; error.value = t('admin.error') }
  }, 8000)
  try {
    const { data, error: e } = await getRestaurant(restaurantId.value)
    if (e) throw e
    if (data) {
      form.value = {
        name: data.name || '',
        slug: data.slug || '',
        config: { ...emptyConfig(), ...(data.config || {}) }
      }
      paragraphsText.value = (form.value.config.about?.paragraphs || []).join('\n\n')
    }
  } catch (e) {
    error.value = t('admin.error')
  } finally {
    clearTimeout(watchdog)
    loading.value = false
  }
})

async function save() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  const watchdog = setTimeout(() => {
    if (saving.value) { saving.value = false; error.value = t('admin.error') }
  }, 12000)
  try {
    // Re-pack the paragraphs textarea before saving.
    form.value.config.about = {
      ...form.value.config.about,
      paragraphs: paragraphsText.value
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
    }
    const { error: e } = await updateRestaurant(restaurantId.value, {
      name: form.value.name.trim(),
      slug: form.value.slug.trim(),
      config: form.value.config
    })
    if (e) { error.value = e.message; return }
    router.push({ name: 'admin' })
  } finally {
    clearTimeout(watchdog)
    saving.value = false
  }
}

async function onPickLogo(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  uploading.value = true
  error.value = ''
  try {
    const { url, error: e2 } = await uploadRestaurantLogo(restaurantId.value, file)
    if (e2) { error.value = e2.message || t('admin.error'); return }
    form.value.config.logo_url = url
  } finally {
    uploading.value = false
  }
}

// Dynamic-list helpers for specialties / hours / gallery.
function addItem(list, blank) { list.push({ ...blank }) }
function removeItem(list, i) { list.splice(i, 1) }
</script>

<template>
  <div class="page">
    <RouterLink :to="{ name: 'admin' }" class="back-link">‹ {{ t('nav.admin') }}</RouterLink>
    <div class="page-head">
      <h1>{{ t('config.title') }}</h1>
      <p>{{ t('config.subtitle') }}</p>
    </div>

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <form v-else class="card editor" @submit.prevent="save">
      <!-- JSON import (from scripts/extract-restaurant.js) -->
      <details class="import-block">
        <summary>{{ t('config.importJson') }}</summary>
        <textarea v-model="importJson" rows="4"
                  :placeholder="t('config.importHint')"></textarea>
        <div class="import-row">
          <button type="button" class="btn btn--plain btn--sm" @click="doImport">
            {{ t('config.importBtn') }}
          </button>
          <span v-if="importMsg" class="import-msg" :class="{ bad: importErr }">
            {{ importMsg }}
          </span>
        </div>
      </details>

      <!-- Identity -->
      <h3 class="grp">{{ t('config.identity') }}</h3>
      <div class="row2">
        <div class="field">
          <label>{{ t('config.name') }} *</label>
          <input v-model="form.name" type="text" required />
        </div>
        <div class="field">
          <label>{{ t('config.slug') }} *</label>
          <input v-model="form.slug" type="text" required pattern="[a-z0-9-]+" />
        </div>
      </div>
      <div class="field">
        <label>{{ t('config.tagline') }}</label>
        <input v-model="form.config.tagline" type="text" />
      </div>

      <!-- Branding — root/moderator-only via the route guard. Owners
           never reach this view, so the visual-identity overrides only
           ever go through a moderator. -->
      <h3 class="grp">{{ t('config.branding') }}</h3>
      <div class="row3">
        <div class="field">
          <label>{{ t('config.brandPrimary') }}</label>
          <div class="color-row">
            <input v-model="form.config.brand_primary" type="color" class="color-swatch" />
            <input v-model="form.config.brand_primary" type="text" placeholder="#9e053d" />
          </div>
        </div>
        <div class="field">
          <label>{{ t('config.brandDark') }}</label>
          <div class="color-row">
            <input v-model="form.config.brand_dark" type="color" class="color-swatch" />
            <input v-model="form.config.brand_dark" type="text" placeholder="#6f032b" />
          </div>
        </div>
        <div class="field">
          <label>{{ t('config.themeColor') }}</label>
          <div class="color-row">
            <input v-model="form.config.theme_color" type="color" class="color-swatch" />
            <input v-model="form.config.theme_color" type="text" placeholder="#9e053d" />
          </div>
        </div>
      </div>

      <!-- Heading font — Google Fonts family name. Scaffolder fills this
           when it spots fonts.googleapis.com links in the source HTML. -->
      <div class="row2">
        <div class="field">
          <label>{{ t('config.headingFont') }}</label>
          <input v-model="form.config.heading_font" type="text" placeholder="Playfair Display" />
          <p class="hint">{{ t('config.headingFontHint') }}</p>
        </div>
        <div class="field">
          <label>{{ t('config.googleFontsFamilies') }}</label>
          <input
            :value="(form.config.google_fonts_families || []).join(', ')"
            @input="form.config.google_fonts_families = $event.target.value.split(',').map(s => s.trim()).filter(Boolean)"
            type="text"
            placeholder="Playfair Display, Inter"
          />
          <p class="hint">{{ t('config.googleFontsFamiliesHint') }}</p>
        </div>
      </div>

      <!-- Logo -->
      <div class="field">
        <label>{{ t('config.logo') }}</label>
        <div class="logo-row">
          <div class="logo-preview"
               :style="form.config.logo_url ? { backgroundImage: `url(${form.config.logo_url})` } : null"></div>
          <div class="logo-actions">
            <input v-model="form.config.logo_url" type="text"
                   :placeholder="t('config.logoUrlPlaceholder')" />
            <button type="button" class="btn btn--plain btn--sm"
                    :disabled="uploading" @click="fileInput.click()">
              {{ uploading ? t('config.uploading') : t('config.uploadLogo') }}
            </button>
            <input ref="fileInput" type="file" accept="image/*" hidden @change="onPickLogo" />
          </div>
        </div>
      </div>

      <!-- Contact -->
      <h3 class="grp">{{ t('config.contact') }}</h3>
      <div class="field">
        <label>{{ t('config.address') }}</label>
        <input v-model="form.config.address" type="text" />
      </div>
      <div class="row2">
        <div class="field">
          <label>{{ t('config.phone') }}</label>
          <input v-model="form.config.phone" type="text" />
        </div>
        <div class="field">
          <label>{{ t('config.phoneHref') }}</label>
          <input v-model="form.config.phone_href" type="text" placeholder="tel:…" />
        </div>
      </div>
      <div class="field">
        <label>{{ t('config.email') }}</label>
        <input v-model="form.config.email" type="email" />
      </div>
      <div class="field">
        <label>{{ t('config.mapsHref') }}</label>
        <input v-model="form.config.maps_href" type="text" />
      </div>

      <!-- Hero -->
      <h3 class="grp">{{ t('config.hero') }}</h3>
      <div class="field">
        <label>{{ t('config.heroEyebrow') }}</label>
        <input v-model="form.config.hero.eyebrow" type="text" />
      </div>
      <div class="field">
        <label>{{ t('config.heroTitle') }}</label>
        <input v-model="form.config.hero.title" type="text" />
      </div>
      <div class="field">
        <label>{{ t('config.heroLead') }}</label>
        <textarea v-model="form.config.hero.lead" rows="2"></textarea>
      </div>

      <!-- About -->
      <h3 class="grp">{{ t('config.about') }}</h3>
      <div class="row2">
        <div class="field">
          <label>{{ t('config.aboutKicker') }}</label>
          <input v-model="form.config.about.kicker" type="text" />
        </div>
        <div class="field">
          <label>{{ t('config.aboutTitle') }}</label>
          <input v-model="form.config.about.title" type="text" />
        </div>
      </div>
      <div class="field">
        <label>{{ t('config.aboutImage') }}</label>
        <input v-model="form.config.about.image_url" type="text" />
      </div>
      <div class="field">
        <label>{{ t('config.aboutParagraphs') }}</label>
        <textarea v-model="paragraphsText" rows="5"
                  :placeholder="t('config.aboutParagraphsHint')"></textarea>
        <span class="help">{{ t('config.aboutParagraphsHelp') }}</span>
      </div>

      <!-- Specialties -->
      <h3 class="grp">{{ t('config.specialties') }}</h3>
      <div v-for="(s, i) in form.config.specialties" :key="'sp'+i" class="list-row">
        <input v-model="s.icon" type="text" class="w-icon" placeholder="🍝" />
        <input v-model="s.title" type="text" :placeholder="t('config.specialtyTitle')" />
        <input v-model="s.text" type="text" :placeholder="t('config.specialtyText')" />
        <button type="button" class="rm" @click="removeItem(form.config.specialties, i)">×</button>
      </div>
      <button type="button" class="btn btn--ghost btn--sm"
              @click="addItem(form.config.specialties, { icon: '✨', title: '', text: '' })">
        + {{ t('config.add') }}
      </button>

      <!-- Hours -->
      <h3 class="grp">{{ t('config.hours') }}</h3>
      <div v-for="(h, i) in form.config.hours" :key="'h'+i" class="list-row">
        <input v-model="h.days" type="text" :placeholder="t('config.hoursDays')" />
        <input v-model="h.service" type="text" :placeholder="t('config.hoursService')" />
        <input v-model="h.time" type="text" :placeholder="t('config.hoursTime')" />
        <button type="button" class="rm" @click="removeItem(form.config.hours, i)">×</button>
      </div>
      <button type="button" class="btn btn--ghost btn--sm"
              @click="addItem(form.config.hours, { days: '', service: '', time: '' })">
        + {{ t('config.add') }}
      </button>

      <!-- Gallery -->
      <h3 class="grp">{{ t('config.gallery') }}</h3>
      <div v-for="(g, i) in form.config.gallery" :key="'g'+i" class="list-row">
        <input v-model="g.src" type="text" :placeholder="t('config.galleryUrl')" />
        <input v-model="g.caption" type="text" :placeholder="t('config.galleryCaption')" />
        <button type="button" class="rm" @click="removeItem(form.config.gallery, i)">×</button>
      </div>
      <button type="button" class="btn btn--ghost btn--sm"
              @click="addItem(form.config.gallery, { src: '', caption: '' })">
        + {{ t('config.add') }}
      </button>

      <!-- PWA -->
      <h3 class="grp">{{ t('config.pwa') }}</h3>
      <div class="row2">
        <div class="field">
          <label>{{ t('config.pwaName') }}</label>
          <input v-model="form.config.pwa_name" type="text" />
        </div>
        <div class="field">
          <label>{{ t('config.pwaShortName') }}</label>
          <input v-model="form.config.pwa_short_name" type="text" />
        </div>
      </div>
      <div class="field">
        <label>{{ t('config.pwaDescription') }}</label>
        <input v-model="form.config.pwa_description" type="text" />
      </div>

      <p v-if="error" class="err">{{ error }}</p>

      <div class="editor-actions">
        <button class="btn btn--full" type="submit" :disabled="saving">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.editor { padding: 18px; }
.grp {
  font-family: 'Rufina', serif;
  font-size: 1.05rem;
  color: var(--accent-dark);
  margin: 22px 0 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.grp:first-of-type { margin-top: 4px; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.help {
  display: block; font-size: 0.74rem; color: var(--mut);
  font-weight: 400; margin-top: 6px;
}
.hint {
  font-size: 0.74rem; color: var(--mut);
  margin-top: 6px;
}
.color-row {
  display: flex; gap: 8px; align-items: center;
}
.color-row input[type="text"] {
  flex: 1; min-width: 0;
}
.color-swatch {
  flex: 0 0 38px;
  width: 38px; height: 38px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
.color-swatch::-webkit-color-swatch-wrapper { padding: 4px; }
.color-swatch::-webkit-color-swatch { border: none; border-radius: 5px; }

.logo-row { display: flex; gap: 12px; align-items: flex-start; }
.logo-preview {
  width: 70px; height: 70px;
  border-radius: 12px;
  background: var(--cream, #faf4ea) center/cover no-repeat;
  border: 1px solid var(--line);
  flex: 0 0 auto;
}
.logo-actions { flex: 1; display: flex; flex-direction: column; gap: 8px; }

.list-row {
  display: grid;
  grid-template-columns: auto 1fr 1fr auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.list-row .w-icon { width: 56px; text-align: center; }
.rm {
  width: 30px; height: 30px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--danger);
  font-size: 1.1rem; line-height: 1;
  cursor: pointer;
}
.rm:active { transform: scale(0.92); }

.err {
  color: var(--danger);
  font-weight: 600;
  font-size: 0.85rem;
  margin: 14px 0 0;
}
.editor-actions { margin-top: 20px; }

.import-block {
  background: var(--cream, #faf4ea);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 18px;
}
.import-block summary {
  cursor: pointer;
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--accent-dark);
}
.import-block textarea {
  width: 100%;
  font-family: 'SFMono-Regular', Menlo, monospace;
  font-size: 0.74rem;
  margin-top: 10px;
  resize: vertical;
}
.import-row { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.import-msg { font-size: 0.78rem; color: var(--ok); }
.import-msg.bad { color: var(--danger); }
</style>
