<script setup>
import { ref, onMounted, watch } from 'vue'
import QRCodeStyling from 'qr-code-styling'

const props = defineProps({
  data: { type: String, required: true }
})

const holder = ref(null)
let qr = null

// No centred logo image: loading it could make qr-code-styling fail to
// render the whole code (the QR then "disappears"). The branded burgundy
// dots keep it recognisable, and the code always renders.
function build() {
  return new QRCodeStyling({
    width: 248,
    height: 248,
    type: 'svg',
    data: props.data,
    qrOptions: { errorCorrectionLevel: 'M' },
    dotsOptions: { color: '#9e053d', type: 'rounded' },
    cornersSquareOptions: { color: '#870024', type: 'extra-rounded' },
    cornersDotOptions: { color: '#9e053d', type: 'dot' },
    backgroundOptions: { color: '#ffffff' }
  })
}

onMounted(() => {
  try {
    qr = build()
    qr.append(holder.value)
  } catch (e) {
    console.error('[qr] render failed', e)
  }
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
