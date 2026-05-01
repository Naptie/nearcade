<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Globe from '$lib/components/Globe.svelte';
  import { setContext } from 'svelte';
  import type { LayoutData } from './$types';
  import { IS_ANDROID_OR_IOS, IS_LOW_DATA } from '$lib/utils/index.client';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const showGlobe = !IS_ANDROID_OR_IOS && !IS_LOW_DATA;

  const isLandingPage = $derived(page.url.pathname === resolve('/'));
  const isGlobePage = $derived(page.url.pathname === resolve('/globe'));
  const globeMode = $derived<'landing' | 'fullscreen'>(isGlobePage ? 'fullscreen' : 'landing');

  let isCollapseExpanded = $state(false);

  setContext('collapse', {
    get: () => isCollapseExpanded,
    set: (v: boolean) => (isCollapseExpanded = v)
  });

  // Prevent the page body from scrolling while on globe pages so that
  // Svelte transition animations (slide/fade) don't briefly show a scrollbar.
  $effect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = isCollapseExpanded || !showGlobe ? prev : 'hidden';
    return () => {
      document.documentElement.style.overflow = prev;
    };
  });
</script>

<!-- Globe is always mounted while navigating between / and /globe.
     It is positioned fixed behind all page content and controls its own overlay UI. -->
{#if (isLandingPage && showGlobe) || isGlobePage}
  <Globe mode={globeMode} shopData={data.globeShopData} attendanceData={data.globeAttendanceData} />
{/if}

{@render children()}
