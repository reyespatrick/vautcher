// Supabase client.
// Reads credentials from environment variables (see .env.example).
// If they are not set, `supabase` is null and the app falls back to
// local mock data — so the project still runs without a backend.
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && anonKey ? createClient(url, anonKey) : null

export const isSupabaseConfigured = !!supabase

if (!isSupabaseConfigured) {
  console.info(
    '[La Gioconda] Supabase non configuré — données locales utilisées. ' +
    'Renseignez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans app/.env'
  )
}
