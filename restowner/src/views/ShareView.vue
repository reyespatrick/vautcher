<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import QRCode from 'qrcode'
import { DINER_APP_URL } from '../lib/config'

const { restaurant } = useAuth()
const { t } = useI18n()

const qrUrl = ref('')      // on-screen QR (data URL)
const error = ref('')

onMounted(async () => {
  try {
    qrUrl.value = await QRCode.toDataURL(DINER_APP_URL, {
      width: 720,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#6f032b', light: '#ffffff' }
    })
  } catch (e) {
    error.value = String(e)
  }
})
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
