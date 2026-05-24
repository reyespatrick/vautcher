<script setup>
// Shared diner-list rendering. Both the Admin tab's "Clients" segment
// and the dedicated /clients page mount this component — they only
// differ in which RPC populates the list. Keeps card layout, search
// box, age/last-visit formatting, and lock toggle in one place.
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  /** Rows: { id, name, birth_date?, locked, stamps, last_visit? } */
  clients: { type: Array, default: () => [] },
  /** Show a per-row lock/unlock chip (moderator action). */
  showLock: { type: Boolean, default: false },
  /** Disable the lock button while a parent-managed request is in flight. */
  busy: { type: Boolean, default: false },
  /** Optional empty-state copy when `clients` is empty. */
  emptyText: { type: String, default: '' }
})
const emit = defineEmits(['toggleLock'])

const { t, locale } = useI18n()
const query = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.clients
  return props.clients.filter((c) => (c.name || '').toLowerCase().includes(q))
})

function fmtDate(d) {
  if (!d) return ''
  return new Intl.DateTimeFormat(locale.value, {
    day: 'numeric', month: 'short', year: 'numeric'
  }).format(new Date(d + 'T00:00:00'))
}
function age(d) {
  if (!d) return null
  const t = new Date()
  const b = new Date(d + 'T00:00:00')
  let a = t.getFullYear() - b.getFullYear()
  const m = t.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--
  return a
}
</script>

<template>
  <div class="cl-wrap">
    <input
      v-model="query"
      type="search"
      class="cl-search"
      :placeholder="t('clients.searchPlaceholder')"
      autocomplete="off"
      autocorrect="off"
      spellcheck="false"
    />

    <p v-if="!clients.length" class="empty">
      {{ emptyText || t('clients.empty') }}
    </p>
    <p v-else-if="!filtered.length" class="empty">{{ t('clients.noMatch') }}</p>

    <div v-else class="cl-list">
      <div
        v-for="c in filtered"
        :key="c.id"
        class="card cl"
        :class="{ locked: c.locked }"
      >
        <div class="cl-id">
          <strong>{{ c.name || '—' }}</strong>
          <div class="cl-meta">
            <span v-if="age(c.birth_date) != null">
              {{ t('clients.ageYears', { n: age(c.birth_date) }) }}
            </span>
            <span v-if="c.locked" class="cl-locked">{{ t('clients.locked') }}</span>
          </div>
        </div>

        <div class="cl-stats">
          <span class="cl-stat">
            <b>{{ c.stamps }}</b>
            <small>{{ t('clients.stamps') }}</small>
          </span>
          <span v-if="c.last_visit !== undefined" class="cl-stat">
            <b>{{ fmtDate(c.last_visit) || '—' }}</b>
            <small>{{ t('clients.lastVisit') }}</small>
          </span>
        </div>

        <button
          v-if="showLock"
          type="button"
          class="chip chip--lock"
          :class="{ on: c.locked }"
          :disabled="busy"
          @click="emit('toggleLock', c)"
        >{{ c.locked ? t('admin.locked') : t('admin.lock') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cl-search {
  display: block;
  width: 100%;
  font-family: inherit;
  font-size: 0.94rem;
  padding: 11px 14px;
  margin: 0 0 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
}
.cl-search:focus { outline: none; border-color: var(--accent); }

.cl-list { display: flex; flex-direction: column; gap: 10px; }
.cl {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  flex-wrap: wrap;
}
.cl.locked { opacity: 0.55; }

.cl-id { flex: 1; min-width: 0; }
.cl-id strong {
  font-family: 'Rufina', serif;
  font-size: 1.02rem;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cl-meta { display: flex; gap: 8px; align-items: center; margin-top: 2px; }
.cl-meta span { font-size: 0.72rem; color: var(--mut); }
.cl-locked {
  background: var(--danger);
  color: #fff !important;
  border-radius: 6px;
  padding: 1px 7px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 700;
}

.cl-stats { display: flex; gap: 14px; flex: 0 0 auto; }
.cl-stat {
  display: flex; flex-direction: column;
  align-items: center; text-align: center;
}
.cl-stat b {
  font-family: 'Rufina', serif;
  font-size: 1.1rem;
  color: var(--accent);
  line-height: 1;
}
.cl-stat small {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mut);
  margin-top: 4px;
}

.chip {
  border: 1px solid var(--line);
  border-radius: 20px;
  background: var(--surface);
  color: var(--mut);
  font-family: inherit;
  font-weight: 700;
  font-size: 0.68rem;
  letter-spacing: 0.03em;
  padding: 6px 12px;
  cursor: pointer;
}
.chip.on { background: var(--danger); border-color: var(--danger); color: #fff; }
.chip:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
