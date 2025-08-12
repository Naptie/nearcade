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

// Push notification handling
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (error) {
    console.error('Failed to parse push notification data:', error);
    return;
  }

  const title = data.title || 'nearcade';
  const options: NotificationOptions = {
    body: data.body || '',
    icon: '/logo-192.webp',
    badge: '/logo-192.webp',
    data: data.data || {},
    tag: data.tag || `notification-${Date.now()}`,
    requireInteraction: false,
    silent: false
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data;
  let url = '/';

  // Generate URL based on notification data
  if (data.postId) {
    if (data.universityId) {
      url = `/universities/${data.universityId}/posts/${data.postId}`;
      if (data.commentId) {
        url += `?comment=${data.commentId}`;
      }
    } else if (data.clubId) {
      url = `/clubs/${data.clubId}/posts/${data.postId}`;
      if (data.commentId) {
        url += `?comment=${data.commentId}`;
      }
    }
  } else if (data.universityId) {
    url = `/universities/${data.universityId}`;
  } else if (data.clubId) {
    url = `/clubs/${data.clubId}`;
  } else if (data.url) {
    url = data.url;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Check if there's already a window/tab open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE', url });
          return;
        }
      }

      // No existing window, open a new one
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

// Handle background sync for notifications
// Add minimal SyncEvent type declaration if not present
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}

self.addEventListener('sync', (event) => {
  const syncEvent = event as SyncEvent;
  if (syncEvent.tag === 'background-sync-notifications') {
    syncEvent.waitUntil(
      // This could be used for offline notification queuing
      Promise.resolve()
    );
  }
});
