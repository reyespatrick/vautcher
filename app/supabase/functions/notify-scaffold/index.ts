// ============================================================
//  notify-scaffold — push the admin who scaffolded a site when it
//  finishes OR fails
//
//  POST /notify-scaffold?restaurant_id=<uuid>
//  Called by the vautcher_scaffold_done_trg DB trigger (scaffolding →
//  success, or scaffolding/pending → scaffold_failed/failed) with the
//  X-Cron-Secret header. Looks up who scaffolded the restaurant
//  (config.scaffolded_by) and Web-Pushes that admin's restowner devices —
//  "Site en ligne" on success, or the error detail (config.deploy_error)
//  on failure.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:info@dpcsolutions.com'
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

Deno.serve(async (req) => {
  if ((req.headers.get('x-cron-secret') ?? '') !== CRON_SECRET || !CRON_SECRET) {
    return json({ error: 'forbidden' }, 403)
  }
  const id = new URL(req.url).searchParams.get('restaurant_id')
  if (!id) return json({ error: 'restaurant_id required' }, 400)

  const { data: rest } = await admin
    .from('vautcher_restaurants').select('id, name, config, deploy_status').eq('id', id).maybeSingle()
  if (!rest) return json({ error: 'restaurant not found' }, 404)

  const email = String((rest.config as any)?.scaffolded_by ?? '').toLowerCase()
  if (!email) return json({ ok: true, sent: 0, note: 'no scaffolded_by' })

  const { data: subs } = await admin
    .from('vautcher_admin_push').select('endpoint, p256dh, auth').eq('email', email)
  if (!subs?.length) return json({ ok: true, sent: 0 })

  const name = rest.name ?? 'Le restaurant'
  const failed = rest.deploy_status === 'scaffold_failed' || rest.deploy_status === 'failed'
  const errDetail = String((rest.config as any)?.deploy_error ?? '').trim()

  const payload = JSON.stringify(
    failed
      ? {
          title: `Échec — ${name}`,
          body: errDetail ? errDetail.slice(0, 240) : 'Le déploiement a échoué. Voir les logs.',
          url: '/admin',
          icon: '/icon-192.png',
          tag: 'scaffold-fail-' + id
        }
      : {
          title: 'Site en ligne',
          body: `${name} est en ligne.`,
          url: '/admin',
          icon: '/icon-192.png',
          tag: 'scaffold-' + id
        }
  )

  let sent = 0
  for (const s of subs as any[]) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      sent++
    } catch (e: any) {
      const code = e?.statusCode ?? 0
      if (code === 404 || code === 410) {
        await admin.from('vautcher_admin_push').delete().eq('endpoint', s.endpoint)
      }
    }
  }
  return json({ ok: true, sent })
})
