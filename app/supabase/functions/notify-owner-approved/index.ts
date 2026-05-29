// ============================================================
//  notify-owner-approved — push an owner when root approves their access
//
//  POST /notify-owner-approved?email=<owner email>
//  Called by the vautcher_owner_approved DB trigger (approved false→true)
//  with the X-Cron-Secret header. Web-Pushes every device the owner
//  registered (vautcher_admin_push rows for that e-mail).
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
  const email = (new URL(req.url).searchParams.get('email') ?? '').trim().toLowerCase()
  if (!email) return json({ error: 'email required' }, 400)

  const { data: subs } = await admin
    .from('vautcher_admin_push').select('endpoint, p256dh, auth').eq('email', email)
  if (!subs?.length) return json({ ok: true, sent: 0 })

  const payload = JSON.stringify({
    title: 'Accès autorisé',
    body: 'Votre accès a été autorisé. Vous pouvez maintenant gérer votre restaurant.',
    url: '/',
    icon: '/icon-192.png',
    tag: 'owner-approved'
  })

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
