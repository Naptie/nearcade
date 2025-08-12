<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import '../app.css';
  import '@fortawesome/fontawesome-free/css/all.min.css';
  import { PUBLIC_AMAP_KEY } from '$env/static/public';
  import type { AMapContext } from '$lib/types';
  import '@amap/amap-jsapi-types';
  import NavigationTracker from '$lib/components/NavigationTracker.svelte';
  import { fromPath } from '$lib/utils';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';

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
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((registration) => {
            console.log('SW registered: ', registration);
          })
          .catch((registrationError) => {
            console.log('SW registration failed: ', registrationError);
          });
      });
    }

    setHighlightTheme();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', setHighlightTheme);

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
</script>

{@render children()}

<NavigationTracker />
