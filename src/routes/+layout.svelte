<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import '../app.css';
  import '@fortawesome/fontawesome-free/css/all.min.css';
  import { PUBLIC_AMAP_KEY, PUBLIC_FIREBASE_VAPID_KEY } from '$env/static/public';
  import type { AMapContext } from '$lib/types';
  import '@amap/amap-jsapi-types';
  import NavigationTracker from '$lib/components/NavigationTracker.svelte';
  import { fromPath } from '$lib/utils';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { browser } from '$app/environment';
  import { initializeApp } from 'firebase/app';
  import {
    PUBLIC_FIREBASE_API_KEY,
    PUBLIC_FIREBASE_APP_ID,
    PUBLIC_FIREBASE_AUTH_DOMAIN,
    PUBLIC_FIREBASE_MEASUREMENT_ID,
    PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    PUBLIC_FIREBASE_PROJECT_ID,
    PUBLIC_FIREBASE_STORAGE_BUCKET
  } from '$env/static/public';
  import { getMessaging, getToken, onMessage } from 'firebase/messaging';

  let { data, children } = $props();
  let amap: typeof AMap | undefined = $state(undefined);
  let amapError = $state<string | null>(null);

  const amapContext: AMapContext = {
    get amap() {
      return amap;
    },
    get error() {
      return amapError;
    }
  };

  setContext('amap', amapContext);

  const setHighlightTheme = () => {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const linkId = 'hljs-theme';
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = isDark
      ? 'https://unpkg.com/highlight.js/styles/github-dark.css'
      : 'https://unpkg.com/highlight.js/styles/github.css';
  };

  onMount(() => {
    setHighlightTheme();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', setHighlightTheme);

    // Initialize push notifications for logged-in users
    if (browser && data.session?.user) {
      const onFirstInteraction = () => {
        initializePushNotifications().catch((error) => {
          console.error('Failed to initialize push notifications:', error);
        });
        window.removeEventListener('pointerdown', onFirstInteraction, true);
        window.removeEventListener('keydown', onFirstInteraction, true);
      };
      window.addEventListener('pointerdown', onFirstInteraction, true);
      window.addEventListener('keydown', onFirstInteraction, true);
    }

    (window as Window & { _AMapSecurityConfig?: { serviceHost: string } })._AMapSecurityConfig = {
      serviceHost: fromPath('/_AMapService')
    };
    try {
      import('@amap/amap-jsapi-loader').then((loader) => {
        loader.default
          .load({
            key: PUBLIC_AMAP_KEY,
            version: '2.0'
          })
          .then((a: typeof AMap) => {
            amap = a;
            window.dispatchEvent(new CustomEvent('amap-loaded', { detail: a }));
          });
      });
    } catch (error) {
      console.error('Failed to load AMap:', error);
      amapError = error instanceof Error ? error.message : 'Failed to load AMap';
    }

    let redirect = page.url.searchParams.get('redirect');
    if (data.session?.user) {
      redirect ??= localStorage.getItem('nearcade-redirect');
      if (redirect) {
        localStorage.removeItem('nearcade-redirect');
        goto(redirect);
      }
    } else if (redirect) {
      localStorage.setItem('nearcade-redirect', redirect);
    }

    return () => {
      media.removeEventListener('change', setHighlightTheme);
    };
  });

  const initializePushNotifications = async () => {
    if (!data.session?.user) return;

    try {
      const firebaseConfig = {
        apiKey: PUBLIC_FIREBASE_API_KEY,
        authDomain: PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: PUBLIC_FIREBASE_APP_ID,
        measurementId: PUBLIC_FIREBASE_MEASUREMENT_ID
      };

      const app = initializeApp(firebaseConfig);
      const messaging = getMessaging(app);

      // Request permission and get token
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        try {
          // Detect service worker file based on environment
          const swPath = import.meta.env.DEV ? `${base}/dev-sw.js?dev-sw` : `${base}/sw.js`;
          await navigator.serviceWorker.register(swPath);
          const registration = await navigator.serviceWorker.ready;
          const token = await getToken(messaging, {
            vapidKey: PUBLIC_FIREBASE_VAPID_KEY,
            serviceWorkerRegistration: registration
          });
          if (token) {
            // Store token on server
            await fetch(`${base}/api/fcm-token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, action: 'store' })
            });
            console.log('FCM token registered:', token);

            // Listen for foreground messages
            onMessage(messaging, (payload) => {
              console.log('Message received in foreground:', payload);

              // Update unread count
              // unreadNotifications = unreadNotifications + 1;

              // Show notification if supported
              if (Notification.permission === 'granted') {
                const notificationTitle = payload.notification?.title || 'nearcade';
                const notificationOptions = {
                  body: payload.notification?.body || '',
                  icon: `${base}/logo-192.webp`,
                  badge: `${base}/logo-192.webp`,
                  tag: payload.data?.tag || `notification-${Date.now()}`
                };

                new Notification(notificationTitle, notificationOptions);
              }
            });
          }
        } catch (error) {
          console.error('Failed to get FCM token:', error);
        }
      }
    } catch (error) {
      console.error('Failed to initialize Firebase:', error);
    }
  };
</script>

<svelte:head>
  <link rel="manifest" href="{base}/manifest.webmanifest" crossorigin="use-credentials" />
  <meta name="theme-color" content="#1B1717" />
</svelte:head>

{@render children()}

<NavigationTracker />
