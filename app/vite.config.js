import { readFileSync } from 'fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['assets/logo.jpg'],
      workbox: { importScripts: ['notif-sw.js'] },
      manifest: {
        name: 'La Gioconda — Restaurant Pizzeria',
        short_name: 'La Gioconda',
        description: 'Restaurant napolitain à Cointrin, Genève.',
        lang: 'fr',
        theme_color: '#9e053d',
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
