import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  server: { host: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CardVault',
        short_name: 'CardVault',
        description: 'Scan and organize your Pokémon cards',
        theme_color: '#e3350d',
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
        ],
      },
    }),
  ],
})
