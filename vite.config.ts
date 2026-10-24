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
        enabled: false,
        suppressWarnings: true,
        type: 'module'
      },
      srcDir: 'src',
      filename: 'sw.ts',
      strategies: 'injectManifest',
      useCredentials: true,
      // `injectManifest` — not `workbox` — is the block workbox-build reads:
      // under the injectManifest strategy vite-plugin-pwa forwards only this
      // object, and the service worker source (`src/sw.ts`) owns the runtime
      // routes and the precache manifest.
      //
      // There is deliberately no `workbox` key here, because it would be dead
      // config: vite-plugin-pwa reads `workbox` only under the `generateSW`
      // strategy (v1.3.0, `dist/index.js:354`), so a `globPatterns` or
      // `runtimeCaching` entry added there would silently never take effect.
      // The runtime caching now lives in `src/sw.ts`.
      injectManifest: {
        // The API reference bundle is a multi-megabyte developer tool. Precaching
        // it would tax every visitor's service-worker install for no benefit.
        // It is still picked up at runtime by the script rule in `src/sw.ts`, so
        // the reference keeps working offline once it has been opened.
        globIgnores: ['**/api-reference.js']
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
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-192.webp', sizes: '192x192', type: 'image/webp', purpose: 'any maskable' },
          { src: 'icon-256.png', sizes: '256x256', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-256.webp', sizes: '256x256', type: 'image/webp', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.webp', sizes: '512x512', type: 'image/webp', purpose: 'any maskable' }
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
