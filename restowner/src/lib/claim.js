// Public owner activation — calls the claim-owner edge function with the
// durable code + the restaurateur's e-mail. Returns { data: { email, otp } }
// on success so the caller can sign in immediately, or { error }.
import { supabase } from './supabase'

export async function claimOwner(code, email) {
  const { data, error } = await supabase.functions.invoke('claim-owner', {
    body: { code: (code || '').trim(), email: (email || '').trim() }
  })
  if (error) {
    let msg = 'Activation impossible.'
    try {
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json()
        if (body && body.error) msg = body.error
      }
    } catch (e) { /* ignore */ }
    return { error: { message: msg } }
  }
  if (data && data.error) return { error: { message: data.error } }
  return { data }
}
