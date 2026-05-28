// Minimal service worker — its ONLY job is to make the console installable
// (Chrome requires a SW with a fetch handler for the install prompt).
// It deliberately caches NOTHING: every request goes straight to the
// network, so a new deploy is picked up immediately (no stale-asset bug).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {
  // No event.respondWith() → the browser performs its normal network fetch.
})
