/// <reference lib="webworker" />
// Custom Service Worker (injectManifest) for nearcade
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute, setDefaultHandler } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string }>;
};

type RouteContext = { url: URL; request: Request };

precacheAndRoute(self.__WB_MANIFEST || []);

registerRoute(
  ({ request }: RouteContext) => request.mode === 'navigate',
  new NetworkFirst({ cacheName: 'pages', networkTimeoutSeconds: 5 })
);

registerRoute(
  ({ url }: RouteContext) => url.pathname.startsWith('/api/'),
  new NetworkFirst({ cacheName: 'api-cache', networkTimeoutSeconds: 10 })
);

registerRoute(
  ({ request }: RouteContext) => ['script', 'style', 'worker'].includes(request.destination),
  new StaleWhileRevalidate({ cacheName: 'static-resources' })
);

registerRoute(
  ({ request }: RouteContext) => request.destination === 'image',
  new StaleWhileRevalidate({ cacheName: 'image-cache' })
);

registerRoute(
  ({ url }: RouteContext) => /\.(?:woff2?|ttf|otf)$/.test(url.pathname),
  new CacheFirst({ cacheName: 'font-cache' })
);

setDefaultHandler(new NetworkFirst());

self.skipWaiting();
clientsClaim();
