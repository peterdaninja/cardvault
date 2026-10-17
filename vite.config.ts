import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  server: { host: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'SLOWTCG',
        short_name: 'SLOWTCG',
        description: 'Scan and organize your Pokémon cards',
        theme_color: '#0a0c11',
        background_color: '#0f1114',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/images\.pokemontcg\.io\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'card-images', expiration: { maxEntries: 600 } },
          },
          {
            // Cached after the first load so each card image is only requested from their server once.
            urlPattern: /^https:\/\/images\.ygoprodeck\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ygo-images',
              expiration: { maxEntries: 1500 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
