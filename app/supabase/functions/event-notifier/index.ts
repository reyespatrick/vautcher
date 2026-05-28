// ============================================================
//  event-notifier — sends Web-Push notifications for restaurant events
//
//  Two kinds:
//   - ?kind=announce&event_id=<uuid>  → push every subscriber of that
//     event's restaurant. Fired by a DB trigger after an event is
//     approved AND announce_now is set (see push-vault-schema.sql).
//   - ?kind=remind                    → for each event due today
//     (event_date − notify_days_before = today), push EVERY subscriber
//     of that event's restaurant (broadcast — not RSVP-only). Fired
//     daily via pg_cron.
//
//  Authentication: this function runs with verify_jwt=false so pg_cron
//  / DB triggers can call it without a user JWT. Instead it checks the
//  X-Cron-Secret header against the CRON_SECRET env var.
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string }

async function send(sub: Sub, payload: string): Promise<{ ok: boolean; status?: number }> {
  try {
    const res = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload
    )
    return { ok: true, status: res.statusCode }
  } catch (e: any) {
    const code = e?.statusCode ?? 0
    // 404 / 410 → subscription is gone. Clean it up.
    if (code === 404 || code === 410) {
      await admin.from('vautcher_push_subscriptions').delete().eq('endpoint', sub.endpoint)
    }
    return { ok: false, status: code }
  }
}

async function loadRestaurant(restaurantId: string) {
  const { data } = await admin
    .from('vautcher_restaurants')
    .select('id, name, slug, config')
    .eq('id', restaurantId)
    .maybeSingle()
  return data
}

function buildPayload(opts: {
  title: string; body: string; icon?: string | null; url?: string; tag?: string
}): string {
  return JSON.stringify({
    title: opts.title,
    body: opts.body,
    icon: opts.icon || '/assets/logo.jpg',
    badge: opts.icon || '/assets/logo.jpg',
    url: opts.url || '/evenements',
    // Per-event tag so successive announces/reminders don't silently
    // collapse onto a single notification slot. renotify lets iOS show
    // a fresh banner even when the tag matches an existing one.
    tag: opts.tag || ('vautcher-' + Date.now()),
    renotify: true
  })
}

function relativeDays(eventDate: string, days: number) {
  if (days === 1) return "C'est demain"
  if (days === 0) return "C'est aujourd'hui"
  return `Dans ${days} jours`
}

async function doAnnounce(eventId: string) {
  const { data: ev } = await admin
    .from('vautcher_events')
    .select('id, restaurant_id, title, description, event_date, event_time')
    .eq('id', eventId)
    .maybeSingle()
  if (!ev) return { kind: 'announce', error: 'event not found' }

  const rest = await loadRestaurant(ev.restaurant_id)
  const restName = rest?.name ?? 'Le restaurant'
  const restLogo = (rest?.config as any)?.logo_url ?? '/assets/logo.jpg'

  const { data: subs } = await admin
    .from('vautcher_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('restaurant_id', ev.restaurant_id)
  if (!subs?.length) {
    await admin.from('vautcher_events').update({ announced_at: new Date().toISOString() }).eq('id', ev.id)
    return { kind: 'announce', event: ev.id, subscribers: 0, sent: 0 }
  }

  const dateLabel = new Date(ev.event_date + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long'
  })
  const payload = buildPayload({
    title: `${restName} — Nouvel événement`,
    body: `${ev.title} · ${dateLabel}${ev.event_time ? ' à ' + ev.event_time : ''}`,
    icon: restLogo,
    // Deep-link to the event detail page so a tap goes straight there.
    url: `/evenements/${ev.id}`,
    tag: 'announce-' + ev.id
  })

  let sent = 0, failed = 0
  for (const s of subs as Sub[]) {
    const r = await send(s, payload)
    r.ok ? sent++ : failed++
  }
  await admin.from('vautcher_events').update({ announced_at: new Date().toISOString() }).eq('id', ev.id)
  return { kind: 'announce', event: ev.id, subscribers: subs.length, sent, failed }
}

async function doRemind() {
  const { data: events } = await admin.rpc('vautcher_events_due_for_reminder')
  if (!events?.length) return { kind: 'remind', events: 0, sent: 0 }

  let totalSent = 0, totalFailed = 0
  for (const ev of events as any[]) {
    const rest = await loadRestaurant(ev.restaurant_id)
    const restName = rest?.name ?? 'Le restaurant'
    const restLogo = (rest?.config as any)?.logo_url ?? '/assets/logo.jpg'

    // Broadcast to every subscriber of the restaurant (Option A), the
    // same audience as the announce push — not only RSVPed profiles.
    const { data: subs } = await admin
      .from('vautcher_push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('restaurant_id', ev.restaurant_id)
    if (!subs?.length) {
      await admin.from('vautcher_events').update({ reminded_at: new Date().toISOString() }).eq('id', ev.id)
      continue
    }

    const payload = buildPayload({
      title: `${restName} — ${ev.title}`,
      body: `${relativeDays(ev.event_date, ev.notify_days_before)}${ev.event_time ? ' à ' + ev.event_time : ''}`,
      icon: restLogo,
      url: `/evenements/${ev.id}`,
      tag: 'remind-' + ev.id
    })
    for (const s of subs as Sub[]) {
      const r = await send(s, payload)
      r.ok ? totalSent++ : totalFailed++
    }
    await admin.from('vautcher_events').update({ reminded_at: new Date().toISOString() }).eq('id', ev.id)
  }
  return { kind: 'remind', events: events.length, sent: totalSent, failed: totalFailed }
}

Deno.serve(async (req) => {
  // pg_cron / DB triggers / Supabase scheduler send the shared secret.
  // verify_jwt is off so this header is the only gate; without it the
  // function refuses to run.
  const givenSecret = req.headers.get('x-cron-secret') ?? ''
  if (!CRON_SECRET || givenSecret !== CRON_SECRET) {
    return json({ error: 'forbidden' }, 403)
  }

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') ?? 'remind'
  try {
    if (kind === 'announce') {
      const eventId = url.searchParams.get('event_id')
      if (!eventId) return json({ error: 'event_id required for announce' }, 400)
      return json(await doAnnounce(eventId))
    }
    if (kind === 'remind') return json(await doRemind())
    return json({ error: `unknown kind: ${kind}` }, 400)
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})
