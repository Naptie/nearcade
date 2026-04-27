<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import GlobeNextMap from '$lib/components/GlobeNextMap.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const isLandingPage = $derived(page.url.pathname === resolve('/'));
  const isGlobeNextPage = $derived(page.url.pathname === resolve('/globe-next'));

  const globeMode = $derived<'landing' | 'fullscreen'>(isGlobeNextPage ? 'fullscreen' : 'landing');
</script>

<!-- GlobeNextMap is always mounted while navigating between / and /globe-next.
     It is positioned fixed behind all page content and controls its own overlay UI. -->
{#if isLandingPage || isGlobeNextPage}
  <GlobeNextMap
    mode={globeMode}
    shopData={data.globeShopData}
    attendanceData={data.globeAttendanceData}
  />
{/if}

{@render children()}
