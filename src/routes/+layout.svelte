<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import '../app.css';
  import '@fortawesome/fontawesome-free/css/all.min.css';
  import {
    PUBLIC_AMAP_KEY,
    PUBLIC_FIREBASE_VAPID_KEY,
    PUBLIC_GOOGLE_MAPS_API_KEY,
    PUBLIC_CLARITY_PROJECT_ID,
    PUBLIC_FIREBASE_API_KEY,
    PUBLIC_FIREBASE_APP_ID,
    PUBLIC_FIREBASE_AUTH_DOMAIN,
    PUBLIC_FIREBASE_MEASUREMENT_ID,
    PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    PUBLIC_FIREBASE_PROJECT_ID,
    PUBLIC_FIREBASE_STORAGE_BUCKET,
    PUBLIC_BAIDU_SITE_VERIFICATION
  } from '$env/static/public';
  import type { AMapContext, WindowMessage } from '$lib/types';
  import '@amap/amap-jsapi-types';
  import NavigationTracker from '$lib/components/NavigationTracker.svelte';
  import { fromPath, isDarkMode } from '$lib/utils/scoped';
  import { getDisplayName } from '$lib/utils';
  import { page } from '$app/state';
  import { goto, invalidateAll, afterNavigate } from '$app/navigation';
  import { resolve, base } from '$app/paths';
  import { browser } from '$app/environment';
  import { initializeApp } from 'firebase/app';
  import { getMessaging, getToken, onMessage } from 'firebase/messaging';
  import { getAnalytics, setAnalyticsCollectionEnabled } from 'firebase/analytics';
  import Clarity from '@microsoft/clarity';
  import GlobalSeo from '$lib/components/GlobalSeo.svelte';
  import MetaRobots from '$lib/components/MetaRobots.svelte';

  const noindexPaths = ['/admin', '/settings', '/auth', '/oauth'];
  const shouldNoIndex = $derived(
    noindexPaths.some(
      (p) =>
        page.url.pathname === `${base}${p}` ||
        page.url.pathname.startsWith(`${base}${p}/`) ||
        page.url.pathname === p ||
        page.url.pathname.startsWith(`${p}/`)
    )
  );

  let { data, children } = $props();
  let amap: typeof AMap | undefined = $state(undefined);
  let amapError = $state<string | null>(null);
  let themeColorMeta: HTMLMetaElement;

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

  const handleThemeChange = (event: Event) => {
    setHighlightTheme();
    themeColorMeta.content = (event as CustomEvent).detail === 'dark' ? '#1B1618' : '#FFFFFF';
  };

  const handleWindowMessage = (event: { data: WindowMessage | undefined }) => {
    const msg = event.data;
    if (msg?.type === 'NAVIGATE' && msg.payload) {
      goto(msg.payload);
    } else if (msg?.type === 'INVALIDATE') {
      invalidateAll();
    }
  };

  afterNavigate(() => {
    if (data.session?.user) {
      Clarity.identify(
        data.session.user.id,
        undefined,
        undefined,
        getDisplayName(data.session.user)
      );
    }
  });

  onMount(() => {
    Clarity.init(PUBLIC_CLARITY_PROJECT_ID);

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
    const analytics = getAnalytics(app);
    setAnalyticsCollectionEnabled(analytics, !import.meta.env.DEV);

    setHighlightTheme();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', handleThemeChange);
    window.addEventListener('nearcade-theme-change', handleThemeChange);

    // Initialize push notifications for logged-in users
    if (data.session?.user) {
      const onFirstInteraction = () => {
        initializePushNotifications(app).catch((error) => {
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

    // Load AMap by default
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
    if (data.session?.user && !page.url.searchParams.has('continue')) {
      redirect ??= localStorage.getItem('nearcade-redirect');
      if (redirect) {
        localStorage.removeItem('nearcade-redirect');
        goto(redirect);
      }
    } else if (redirect) {
      localStorage.setItem('nearcade-redirect', redirect);
    }

    return () => {
      media.removeEventListener('change', handleThemeChange);
      window.removeEventListener('nearcade-theme-change', handleThemeChange);
      navigator.serviceWorker.removeEventListener('message', handleWindowMessage);
    };
  });

  const initializePushNotifications = async (app: ReturnType<typeof initializeApp>) => {
    if (!data.session?.user) return;

    try {
      const messaging = getMessaging(app);

      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        try {
          const swPath = import.meta.env.DEV ? `${base}/dev-sw.js?dev-sw` : `${base}/sw.js`;
          const swOptions = import.meta.env.DEV ? { type: 'module' as const } : undefined;
          await navigator.serviceWorker.register(swPath, swOptions);
          const registration = await navigator.serviceWorker.ready;
          navigator.serviceWorker.addEventListener('message', handleWindowMessage);
          const token = await getToken(messaging, {
            vapidKey: PUBLIC_FIREBASE_VAPID_KEY,
            serviceWorkerRegistration: registration
          });
          if (token) {
            await fetch(resolve('/api/notifications/fcm/token'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, action: 'store' })
            });

            onMessage(messaging, (payload) => {
              invalidateAll();

              if (Notification.permission === 'granted') {
                let title = payload.notification?.title || 'nearcade';
                let body = payload.notification?.body || '';

                if (payload.data?.notification) {
                  try {
                    const notification = JSON.parse(payload.data.notification);
                    body = notification.content || body;
                  } catch {
                    // fall back to FCM notification fields
                  }
                }

                new Notification(title, {
                  body,
                  icon: `${base}/icon-192.webp`,
                  badge: `${base}/icon-192.webp`,
                  tag: `notification-${Date.now()}`
                });
              }
            });
          }
        } catch (error) {
          console.error('Failed to get FCM token:', error);
        }
      }
    } catch (error) {
      console.error('Failed to initialize Firebase messaging:', error);
    }
  };
</script>

<svelte:head>
  <link rel="manifest" href="{base}/manifest.webmanifest" crossorigin="use-credentials" />
  <meta
    name="theme-color"
    content={browser && isDarkMode() ? '#1B1618' : '#FFFFFF'}
    bind:this={themeColorMeta}
  />
  {#if shouldNoIndex}
    <MetaRobots />
  {/if}
  {#if PUBLIC_BAIDU_SITE_VERIFICATION}
    <meta name="baidu-site-verification" content={PUBLIC_BAIDU_SITE_VERIFICATION} />
  {/if}
  <script
    type="text/javascript"
    src="https://maps.googleapis.com/maps/api/js?key={PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places&loading=async"
    defer
  ></script>
</svelte:head>

<GlobalSeo />

{@render children()}

<NavigationTracker />
