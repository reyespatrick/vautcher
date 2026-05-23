/* Extra service-worker logic, imported by the generated PWA service worker.
   Handles incoming push messages and taps on notifications. */

// Tap a notification -> focus the app and navigate to the target page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ('focus' in client) {
            client.navigate(url)
            return client.focus()
          }
        }
        return self.clients.openWindow(url)
      })
  )
})

// Real server push (used once the VAPID pipeline is wired).
self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch (e) { payload = {} }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'La Gioconda', {
      body: payload.body || '',
      icon: payload.icon || '/assets/logo.jpg',
      badge: '/assets/logo.jpg',
      image: payload.image,
      data: { url: payload.url || '/evenements' },
      // Per-event tag so successive pushes don't silently overwrite
      // each other in the iOS notification center; renotify lets a
      // tag-update still raise a fresh banner.
      tag: payload.tag || ('vautcher-' + Date.now()),
      renotify: payload.renotify === true
    })
  )
})
