<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useScope } from '../composables/useScope'
import { useDialog } from '../composables/useDialog'
import { getVoucher, createVoucher, updateVoucher, archiveVoucher } from '../lib/vouchers'
import BackBar from '../components/BackBar.vue'

const route = useRoute()
const router = useRouter()
const { activeRestaurantId } = useScope()
const { confirm } = useDialog()
const { t } = useI18n()

const editingId = computed(() => (route.name === 'voucher-edit' ? route.params.id : null))

const form = ref({ label: '', stamps_required: 10, reward_text: '' })
const loading = ref(true)
const saving = ref(false)
const error = ref('')

onMounted(async () => {
  if (!editingId.value) { loading.value = false; return } // brand-new vautcher

  // Watchdog — never leave the screen stuck on "loading".
  const watchdog = setTimeout(() => {
    if (loading.value) {
      loading.value = false
      if (!form.value.label) error.value = t('voucherEditor.loadError')
    }
  }, 8000)

  try {
    const { data, error: e } = await getVoucher(editingId.value)
    if (e) throw e
    if (data) {
      form.value = {
        label: data.label || '',
        stamps_required: data.stamps_required || 10,
        reward_text: data.reward_text || ''
      }
    }
  } catch (err) {
    error.value = t('voucherEditor.loadError')
  } finally {
    clearTimeout(watchdog)
    loading.value = false
  }
})

const valid = computed(() => {
  const n = Number(form.value.stamps_required)
  return !!form.value.label.trim() && !!form.value.reward_text.trim()
    && Number.isFinite(n) && n >= 1 && n <= 100
})

async function save() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''

  // Watchdog — never leave the button stuck on "Enregistrement…".
  const watchdog = setTimeout(() => {
    if (saving.value) {
      saving.value = false
      error.value = t('voucherEditor.saveFailed')
    }
  }, 12000)

  try {
    const payload = {
      restaurant_id: activeRestaurantId.value,
      label: form.value.label.trim(),
      stamps_required: Number(form.value.stamps_required),
      reward_text: form.value.reward_text.trim()
    }
    const res = editingId.value
      ? await updateVoucher(editingId.value, payload)
      : await createVoucher(payload)
    if (res.error) { error.value = res.error.message; return }
    router.push({ name: 'vouchers' })
  } catch (e) {
    error.value = (e && e.message) || String(e)
  } finally {
    clearTimeout(watchdog)
    saving.value = false
  }
}

async function onArchive() {
  const ok = await confirm({
    title: t('voucherEditor.confirmArchiveTitle'),
    body: t('voucherEditor.confirmArchive'),
    confirmLabel: t('voucherEditor.archive'),
    cancelLabel: t('common.keep'),
    danger: true
  })
  if (!ok) return
  await archiveVoucher(editingId.value)
  router.push({ name: 'vouchers' })
}
</script>

<template>
  <div class="page">
    <BackBar :to="{ name: 'vouchers' }" :label="editingId ? t('voucherEditor.editTitle') : t('voucherEditor.newTitle')" />

    <p v-if="loading" class="spinner-note">{{ t('common.loading') }}</p>

    <form v-else class="card editor" @submit.prevent="save">
      <div class="field">
        <label>{{ t('voucherEditor.label') }} *</label>
        <input v-model="form.label" type="text"
          :placeholder="t('voucherEditor.labelPlaceholder')" required />
      </div>

      <div class="field">
        <label>{{ t('voucherEditor.stamps') }} *</label>
        <input v-model="form.stamps_required" type="number" min="1" max="100" required />
        <span class="help">{{ t('voucherEditor.stampsHint') }}</span>
      </div>

      <div class="field">
        <label>{{ t('voucherEditor.reward') }} *</label>
        <textarea v-model="form.reward_text" rows="2"
          :placeholder="t('voucherEditor.rewardPlaceholder')"></textarea>
        <span class="help">{{ t('voucherEditor.rewardHint') }}</span>
      </div>

      <p v-if="error" class="err">{{ error }}</p>

      <div class="editor-actions">
        <button class="btn btn--full" type="submit" :disabled="!valid || saving">
          {{ saving ? t('voucherEditor.saving')
                    : (editingId ? t('voucherEditor.save') : t('voucherEditor.createBtn')) }}
        </button>
        <button
          v-if="editingId"
          type="button"
          class="btn btn--danger btn--full"
          @click="onArchive"
        >{{ t('voucherEditor.archive') }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.editor { padding: 20px 18px; }
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
  margin-top: 14px;
}
</style>
