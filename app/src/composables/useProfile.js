// Visitor profile.
// Asked once on first launch, then never again.
// Stored offline in localStorage AND persisted to Supabase (vautcher_profiles).
import { ref } from 'vue'
import { saveProfile } from '../lib/api'

// Tenant-agnostic storage key. localStorage is already scoped per-
// origin (each tenant has its own <slug>.pages.dev), so no risk of
// bleed between restaurants. The neutral prefix just keeps the key
// honest when reading devtools across multiple tenants.
const STORAGE_KEY = 'vautcher.profile'

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// Shared singleton state
const profile = ref(load())
// Dialog is open on first launch (no stored profile yet)
const dialogOpen = ref(!profile.value)

export function useProfile() {
  function save(data) {
    // Reuse the existing id on edit; mint one on first save.
    const id = profile.value?.id || crypto.randomUUID()
    const clean = { id, name: data.name.trim(), birthDate: data.birthDate }

    profile.value = clean
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
    } catch {
      /* storage unavailable — keep it in memory for this session */
    }
    dialogOpen.value = false

    // Persist to the database — best effort, never blocks the UI.
    saveProfile(clean).catch(() => {})
  }

  function openDialog() {
    dialogOpen.value = true
  }

  function logout() {
    profile.value = null
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    dialogOpen.value = true
  }

  function closeDialog() {
    // Only allowed to close without saving if a profile already exists
    if (profile.value) dialogOpen.value = false
  }

  return { profile, dialogOpen, save, openDialog, closeDialog, logout }
}
