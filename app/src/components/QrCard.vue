<script setup>
import { ref, onMounted, watch } from 'vue'
import QRCodeStyling from 'qr-code-styling'

const props = defineProps({
  data: { type: String, required: true }
})

const holder = ref(null)
let qr = null

function build() {
  return new QRCodeStyling({
    width: 248,
    height: 248,
    type: 'svg',
    data: props.data,
    image: '/assets/logo.jpg',
    // High error correction so the centred logo never breaks scanning.
    qrOptions: { errorCorrectionLevel: 'H' },
    imageOptions: { crop: true, margin: 6, imageSize: 0.4 },
    dotsOptions: { color: '#9e053d', type: 'rounded' },
    cornersSquareOptions: { color: '#870024', type: 'extra-rounded' },
    cornersDotOptions: { color: '#9e053d', type: 'dot' },
    backgroundOptions: { color: '#ffffff' }
  })
}

onMounted(() => {
  qr = build()
  qr.append(holder.value)
})

watch(() => props.data, (v) => {
  if (qr) qr.update({ data: v })
})
</script>

<template>
  <div ref="holder" class="qr"></div>
</template>

<style scoped>
.qr {
  display: flex;
  justify-content: center;
}
.qr :deep(svg) {
  border-radius: 12px;
  display: block;
}
</style>
