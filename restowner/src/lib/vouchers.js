// Vautcher (loyalty voucher) data access.
// Owners have full RLS access to their own restaurant's vautchers,
// so plain table queries are enough — stats go through a function.
import { supabase } from './supabase'

const TABLE = 'vautcher_vouchers'

/** A restaurant's active vautchers, in sequence order. */
export async function listVouchers(restaurantId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('archived', false)
    .order('sequence', { ascending: true })
    .order('created_at', { ascending: true })
  return { data: data || [], error }
}

export async function getVoucher(id) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return { data, error }
}

/** Creates a vautcher at the end of the restaurant's sequence. */
export async function createVoucher(payload) {
  const { data: last } = await supabase
    .from(TABLE)
    .select('sequence')
    .eq('restaurant_id', payload.restaurant_id)
    .order('sequence', { ascending: false })
    .limit(1)
  const sequence = (last && last[0] ? last[0].sequence : 0) + 1
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...payload, sequence })
    .select('id')
    .single()
  return { data, error }
}

export async function updateVoucher(id, payload) {
  const { error } = await supabase.from(TABLE).update(payload).eq('id', id)
  return { error }
}

/** Archives a vautcher — diners stop receiving it; history is kept. */
export async function archiveVoucher(id) {
  const { error } = await supabase.from(TABLE).update({ archived: true }).eq('id', id)
  return { error }
}

/**
 * Vautcher usage stats for the owner's own restaurant:
 * { completed, redeemed, active_cards, stamps_total, per_voucher:[...] }.
 * Returns { data:null } if the stats function isn't deployed yet —
 * callers treat that as all-zero.
 */
export async function voucherStats() {
  const { data, error } = await supabase.rpc('vautcher_voucher_stats')
  return { data: data || null, error }
}
