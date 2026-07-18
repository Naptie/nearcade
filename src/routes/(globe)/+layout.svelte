<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Globe from '$lib/components/Globe.svelte';
  import { onMount } from 'svelte';
  import { HAS_DISCRETE_GPU, IS_LOW_DATA } from '$lib/utils/index.client';

  let { children }: { children: import('svelte').Snippet } = $props();

  let showGlobe = $state(false);

  onMount(() => {
    showGlobe = HAS_DISCRETE_GPU && !IS_LOW_DATA;
  });

  const isLandingPage = $derived(page.url.pathname === resolve('/'));
  const isGlobePage = $derived(page.url.pathname === resolve('/globe'));
  const globeMode = $derived<'landing' | 'fullscreen'>(isGlobePage ? 'fullscreen' : 'landing');
</script>

<!-- Globe is always mounted while navigating between / and /globe.
     It is positioned fixed behind all page content and controls its own overlay UI. -->
{#if (isLandingPage && showGlobe) || isGlobePage}
  <Globe mode={globeMode} />
{/if}

{@render children()}
