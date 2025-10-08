import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    devtoolsJson(),
    // i18n
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      strategy: ['cookie', 'localStorage', 'preferredLanguage', 'baseLocale']
    }),
    // Progressive Web App integration
    VitePWA({
      registerType: 'autoUpdate',
      // allow PWA features during dev
      devOptions: {
        enabled: true,
        suppressWarnings: true,
        type: 'module'
      },
      srcDir: 'src',
      filename: 'sw.ts',
      strategies: 'injectManifest',
      useCredentials: true,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,avif,jpg,jpeg,gif,woff,woff2}'],
        runtimeCaching: [
          {
            // API calls
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 }
            }
          },
          // fonts (local hashed & external)
          {
            urlPattern: /.*\.(?:woff2?|ttf|otf)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'font-cache',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          // static assets (scripts, styles)
          {
            urlPattern: ({ request }) =>
              ['script', 'style', 'worker'].includes(request.destination),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'static-resources' }
          },
          // images
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ]
      },
      // auto-generate manifest
      manifest: {
        name: 'nearcade',
        short_name: 'nearcade',
        description: 'A website that helps players find arcades and connect with the community.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#1B1618',
        theme_color: '#1B1618',
        lang: 'en',
        icons: [
          { src: 'logo-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'logo-192.webp', sizes: '192x192', type: 'image/webp' },
          { src: 'logo-256.webp', sizes: '256x256', type: 'image/webp' },
          { src: 'logo-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'logo-512.webp', sizes: '512x512', type: 'image/webp' }
        ]
      }
    })
  ],
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        passes: 2
      },
      mangle: true,
      format: {
        comments: false
      }
    },
    sourcemap: true
  },
  envPrefix: 'PUBLIC_'
});
