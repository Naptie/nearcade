import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { ip2region } from './plugins/ip2region';
import { firebaseProxy } from './plugins/firebase-proxy';

export default defineConfig({
  plugins: [
    ip2region(),
    tailwindcss(),
    sveltekit(),
    devtoolsJson(),
    firebaseProxy(),
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
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-192.webp', sizes: '192x192', type: 'image/webp' },
          { src: 'icon-256.png', sizes: '256x256', type: 'image/png' },
          { src: 'icon-256.webp', sizes: '256x256', type: 'image/webp' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.webp', sizes: '512x512', type: 'image/webp' }
        ]
      }
    })
  ],
  resolve: {
    dedupe: ['@better-auth/core', 'better-auth']
  },
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
