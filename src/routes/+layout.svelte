<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import '../app.css';
  import '@fortawesome/fontawesome-free/css/all.min.css';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { PUBLIC_AMAP_KEY } from '$env/static/public';
  import type { AMapContext } from '$lib/types';
  import '@amap/amap-jsapi-types';
  import NavigationTracker from '$lib/components/NavigationTracker.svelte';

  let { children } = $props();
  let amap: typeof AMap | undefined = $state(undefined);
  let amapReady = $state(false);
  let amapError = $state<string | null>(null);

  const amapContext: AMapContext = {
    get amap() {
      return amap;
    },
    get ready() {
      return amapReady;
    },
    get error() {
      return amapError;
    }
  };

  setContext('amap', amapContext);

  onMount(async () => {
    if (browser) {
      (window as Window & { _AMapSecurityConfig?: { serviceHost: string } })._AMapSecurityConfig = {
        serviceHost: `${page.url.origin}/_AMapService`
      };
      try {
        const AMapLoader = await import('@amap/amap-jsapi-loader');
        AMapLoader.default
          .load({
            key: PUBLIC_AMAP_KEY,
            version: '2.0'
          })
          .then((a: typeof AMap) => {
            amap = a;
            amapReady = true;
          });
      } catch (error) {
        console.error('Failed to load AMap:', error);
        amapError = error instanceof Error ? error.message : 'Failed to load AMap';
      }
    }
  });
</script>

{@render children()}

<NavigationTracker />
