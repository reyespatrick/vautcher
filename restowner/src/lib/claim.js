// Owner sign-in by access code — calls the claim-owner edge function.
// The e-mail is optional: pass it only to bind a real address (one-shot).
// With code alone it is a durable code-only login. Returns
// { data: { email, otp } } so the caller can sign in immediately, or { error }.
import { supabase } from './supabase'

export async function claimOwner(code, email) {
  const payload = { code: (code || '').trim() }
  const e = (email || '').trim()
  if (e) payload.email = e
  const { data, error } = await supabase.functions.invoke('claim-owner', {
    body: payload
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
