<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import '../app.css';
  import '@fortawesome/fontawesome-free/css/all.min.css';
  import { browser } from '$app/environment';
  import { PUBLIC_AMAP_KEY } from '$env/static/public';
  import type { AMapContext } from '$lib/types';
  import '@amap/amap-jsapi-types';
  import NavigationTracker from '$lib/components/NavigationTracker.svelte';
  import { toPath } from '$lib/utils';

  let { children } = $props();
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

  onMount(async () => {
    if (browser) {
      (window as Window & { _AMapSecurityConfig?: { serviceHost: string } })._AMapSecurityConfig = {
        serviceHost: toPath('/_AMapService')
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
            window.dispatchEvent(new CustomEvent('amap-loaded', { detail: a }));
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
