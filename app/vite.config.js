import { readFileSync } from 'fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

// Per-tenant PWA identity — set by VITE_PWA_* env vars in the deploy
// pipeline. Defaults are La Gioconda's so a local dev build / no-env
// build keeps the current behaviour.
const env = process.env
const PWA_NAME        = env.VITE_PWA_NAME        || 'La Gioconda — Restaurant Pizzeria'
const PWA_SHORT_NAME  = env.VITE_PWA_SHORT_NAME  || 'La Gioconda'
const PWA_DESCRIPTION = env.VITE_PWA_DESCRIPTION || 'Restaurant napolitain à Cointrin, Genève.'
const THEME_COLOR     = env.VITE_THEME_COLOR     || '#9e053d'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['assets/logo.jpg'],
      // skipWaiting + clientsClaim — the new service worker takes
      // control of open tabs as soon as it's downloaded, rather than
      // queuing behind the old SW until every tab of the site is
      // fully closed. Without these, template / design changes
      // shipped via a deploy stayed invisible to anyone who'd loaded
      // the site before (this hid the Modern template entirely).
      workbox: {
        importScripts: ['notif-sw.js'],
        skipWaiting: true,
        clientsClaim: true,
        // Aggressive cache busting so a stale SW can never serve last
        // week's index.html when a new bundle is deployed.
        cleanupOutdatedCaches: true,
        navigationPreload: true,
        // Tell Workbox to treat /assets/* (hashed JS/CSS) as immutable
        // and cache everything else aggressively.
        runtimeCaching: [
          // HTML navigation — race the network for 1.5s, then serve the
          // last cached copy. After one visit the page paints instantly
          // even on flaky/offline networks.
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-pages',
              networkTimeoutSeconds: 1.5,
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          },
          // Images — CacheFirst. First visit fills the cache; every
          // subsequent visit (including offline) paints them
          // instantly. Covers Supabase Storage, scaffolded event
          // images and any remote <img> source.
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          // Supabase REST + RPC GETs (events, restaurants, vouchers,
          // cards…) — StaleWhileRevalidate: home, events list and
          // loyalty card show their last-seen data instantly while a
          // background refresh fetches the latest. Reservations /
          // event participation still need a live network — that's
          // fine, the user message said offline DISPLAY only.
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              url.hostname.endsWith('.supabase.co') &&
              (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/storage/')),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-reads',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          // Google Fonts — CacheFirst, near-permanent.
          {
            urlPattern: ({ url }) =>
              url.hostname === 'fonts.googleapis.com' ||
              url.hostname === 'fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      manifest: {
        name: PWA_NAME,
        short_name: PWA_SHORT_NAME,
        description: PWA_DESCRIPTION,
        lang: 'fr',
        theme_color: THEME_COLOR,
        background_color: '#1b1b1b',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'assets/logo.jpg', sizes: '192x192', type: 'image/jpeg' },
          { src: 'assets/logo.jpg', sizes: '512x512', type: 'image/jpeg' }
        ]
      }
    })
  ],
  server: { host: '127.0.0.1', port: 5173 }
})
