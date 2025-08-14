/// <reference lib="webworker" />
// Custom Service Worker (injectManifest) for nearcade with FCM support
import { getNotificationLink, getNotificationTitle } from '$lib/notifications/index.client';
import type { Notification, WindowMessage } from '$lib/types';
// import { initializeApp } from 'firebase/app';
// import { getMessaging, onMessage } from 'firebase/messaging';
// import { onBackgroundMessage } from 'firebase/messaging/sw';
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute, setDefaultHandler } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string }>;
};

type RouteContext = { url: URL; request: Request };

const base = import.meta.env.PATH_BASE || '';

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

// Firebase messaging configuration
// const firebaseConfig = {
//   apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
//   authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
//   projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
//   storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
//   messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
//   appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
//   measurementId: import.meta.env.PUBLIC_FIREBASE_MEASUREMENT_ID
// };

// try {
//   // Only initialize if serviceWorker is available
//   if ('serviceWorker' in navigator) {
//     const firebaseApp = initializeApp(firebaseConfig);

//     // Handle background messages
//     const messaging = getMessaging(firebaseApp);

//     onMessage(messaging, (payload: unknown) => {
//       console.log('Received foreground message:', payload);
//     });

//     onBackgroundMessage(messaging, (payload: unknown) => {
//       console.log('Received background message:', payload);

//       // Type assertion for payload structure
//       const notificationPayload = payload as {
//         notification?: { title?: string; body?: string };
//         data?: { tag?: string };
//       };

//       const notificationTitle = notificationPayload.notification?.title || 'nearcade';
//       const notificationOptions = {
//         body: notificationPayload.notification?.body || '',
//         icon: `${base}/logo-192.webp`,
//         badge: `${base}/logo-192.webp`,
//         data: notificationPayload.data || {},
//         tag: notificationPayload.data?.tag || `notification-${Date.now()}`
//       };

//       return self.registration.showNotification(notificationTitle, notificationOptions);
//     });
//     console.log('Firebase messaging initialized successfully');
//   } else {
//     console.log('serviceWorker not available, skipping initialization');
//   }
// } catch (error) {
//   console.log('Firebase initialization skipped:', error);
// }

// Push notification handling
const postMessage = async (message: WindowMessage, focus = false) => {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    if (client.url.includes(self.location.origin)) {
      client.postMessage(message);
      if (focus && 'focus' in client) {
        await client.focus();
      }
      return true;
    }
  }
  return false;
};

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data: {
    data: Notification;
    fcmMessageId: string;
    from: string;
    notification: {
      icon: string;
      badge: string;
      title: string;
      body: string;
      tag: string;
    };
    priority: 'high' | 'normal' | 'low';
  };
  try {
    data = event.data.json();
  } catch (error) {
    console.error('Failed to parse push notification data:', error);
    return;
  }

  event.waitUntil(
    (async () => {
      await postMessage({ type: 'INVALIDATE' });

      const title = getNotificationTitle(data.data);
      const options: NotificationOptions = {
        body: data.data.content || data.notification.body,
        icon: data.notification.icon || `${base}//logo-192.webp`,
        badge: data.notification.badge || `${base}//logo-192.webp`,
        data: data.data || {},
        tag: data.notification.tag || `notification-${Date.now()}`,
        requireInteraction: false,
        silent: false
      };

      await self.registration.showNotification(title, options);
    })()
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data;
  const url = getNotificationLink(data, base, `${base}/notifications`);

  event.waitUntil(
    (async () => {
      const found = await postMessage({ type: 'NAVIGATE', payload: url }, true);
      if (!found && self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })()
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

self.skipWaiting();
clientsClaim();
