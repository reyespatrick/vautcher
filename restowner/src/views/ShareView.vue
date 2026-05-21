<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import QRCode from 'qrcode'

// The customer-facing diner app (La Gioconda PWA). Scanning the QR
// opens this URL in the visitor's browser.
const APP_URL = 'https://la-gioconda.pages.dev'

const { restaurant } = useAuth()
const { t } = useI18n()

const qrUrl = ref('')      // on-screen QR (data URL)
const downloading = ref(false)
const error = ref('')

onMounted(async () => {
  try {
    qrUrl.value = await QRCode.toDataURL(APP_URL, {
      width: 720,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#6f032b', light: '#ffffff' }
    })
  } catch (e) {
    error.value = String(e)
  }
})

// Compose a clean, printable PNG: restaurant name + QR + caption.
async function download() {
  if (!qrUrl.value || downloading.value) return
  downloading.value = true
  try {
    const W = 760, H = 980
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)

    ctx.textAlign = 'center'
    ctx.fillStyle = '#6f032b'
    ctx.font = '700 48px Georgia, "Times New Roman", serif'
    ctx.fillText(restaurant.value?.name || 'La Gioconda', W / 2, 112)

    const img = new Image()
    img.src = qrUrl.value
    await img.decode()
    const size = 560
    ctx.drawImage(img, (W - size) / 2, 168, size, size)

    ctx.fillStyle = '#2a211d'
    ctx.font = '600 32px system-ui, -apple-system, Arial, sans-serif'
    ctx.fillText(t('share.caption'), W / 2, 808)

    ctx.fillStyle = '#9e053d'
    ctx.font = '700 26px system-ui, -apple-system, Arial, sans-serif'
    ctx.fillText(t('share.scanLine'), W / 2, 858)

    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `qr-${restaurant.value?.slug || 'la-gioconda'}.png`
    a.click()
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('share.title') }}</h1>
    </div>

    <p class="share-sub">{{ t('share.subtitle') }}</p>

    <div class="qr-card card">
      <div class="qr-resto">{{ restaurant ? restaurant.name : '' }}</div>
      <div class="qr-frame">
        <img v-if="qrUrl" :src="qrUrl" :alt="t('share.title')" />
        <div v-else class="qr-loading">{{ error ? '⚠' : '…' }}</div>
      </div>
      <p class="qr-caption">{{ t('share.caption') }}</p>
      <p class="qr-scan">{{ t('share.scanLine') }}</p>
    </div>

    <button class="btn btn--full" :disabled="!qrUrl || downloading" @click="download">
      {{ downloading ? t('share.preparing') : t('share.download') }}
    </button>

    <p class="share-hint">{{ t('share.hint') }}</p>
  </div>
</template>

<style scoped>
.share-sub {
  color: var(--mut);
  font-size: 0.9rem;
  line-height: 1.5;
  margin-bottom: 18px;
}
.qr-card {
  padding: 26px 22px;
  text-align: center;
  margin-bottom: 16px;
}
.qr-resto {
  font-family: 'Rufina', serif;
  font-size: 1.4rem;
  color: var(--accent-dark);
  margin-bottom: 16px;
}
.qr-frame {
  display: inline-block;
  padding: 14px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 8px 26px rgba(158, 5, 61, 0.14);
}
.qr-frame img {
  display: block;
  width: 240px;
  height: 240px;
}
.qr-loading {
  width: 240px;
  height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.6rem;
  color: var(--mut);
}
.qr-caption {
  margin-top: 16px;
  color: var(--ink);
  font-size: 0.94rem;
  font-weight: 600;
}
.qr-scan {
  margin-top: 4px;
  color: var(--accent);
  font-size: 0.82rem;
  font-weight: 700;
}
.share-hint {
  margin-top: 14px;
  text-align: center;
  color: var(--mut);
  font-size: 0.78rem;
  line-height: 1.5;
}
</style>
