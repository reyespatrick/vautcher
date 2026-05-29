// Minimal service worker — its ONLY job is to make the console installable
// (Chrome requires a SW with a fetch handler for the install prompt).
// It deliberately caches NOTHING: every request goes straight to the
// network, so a new deploy is picked up immediately (no stale-asset bug).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {
  // No event.respondWith() → the browser performs its normal network fetch.
})

// ---- Web Push: notify the admin (e.g. when a scaffold finishes) ----
self.addEventListener('push', (event) => {
  let p = {}
  try { p = event.data ? event.data.json() : {} } catch (e) { p = {} }
  event.waitUntil(
    self.registration.showNotification(p.title || 'restowner', {
      body: p.body || '',
      icon: p.icon || '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: p.url || '/admin' },
      tag: p.tag || ('restowner-' + Date.now()),
      renotify: p.renotify === true
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/admin'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus() } }
      return self.clients.openWindow(url)
    })
  )
})
