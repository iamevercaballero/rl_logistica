import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',

      // Cache the app shell and static assets
      workbox: {
        // Cache JS/CSS/HTML/images
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],

        // Runtime caching strategies
        runtimeCaching: [
          {
            // API calls: NetworkFirst — show cached data when offline
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 5 * 60 }, // 5 min
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],

        // Don't cache auth endpoints (login, refresh)
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/],
      },

      // Web app manifest
      manifest: {
        name: 'RL Logística',
        short_name: 'RL Log',
        description: 'Sistema de gestión de inventario y pallets AMBEV',
        theme_color: '#2563eb',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'landscape-primary',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        categories: ['business', 'productivity'],
        lang: 'es',
      },

      // Dev mode: enable SW in development for testing
      devOptions: {
        enabled: false, // set to true to test SW locally
        type: 'module',
      },
    }),
  ],
})
