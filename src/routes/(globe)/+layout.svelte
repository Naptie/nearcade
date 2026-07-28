<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { HAS_DISCRETE_GPU, IS_LOW_DATA } from '$lib/utils/index.client';

  let { children }: { children: import('svelte').Snippet } = $props();

  let showGlobe = $state(false);
  let GlobeComponent = $state<typeof import('$lib/components/Globe.svelte').default | null>(null);

  onMount(() => {
    showGlobe = HAS_DISCRETE_GPU && !IS_LOW_DATA;
  });

  const isLandingPage = $derived(page.url.pathname === resolve('/'));
  const isGlobePage = $derived(page.url.pathname === resolve('/globe'));
  const globeMode = $derived<'landing' | 'fullscreen'>(isGlobePage ? 'fullscreen' : 'landing');
  const shouldShowGlobe = $derived((isLandingPage && showGlobe) || isGlobePage);

  // Dynamically import Globe component only when needed to split maplibre-gl
  // (~764KB) out of the initial page bundle.
  $effect(() => {
    if (shouldShowGlobe && !GlobeComponent) {
      import('$lib/components/Globe.svelte').then((mod) => {
        GlobeComponent = mod.default;
      });
    }
  });
</script>

<!-- Globe is always mounted while navigating between / and /globe.
     It is positioned fixed behind all page content and controls its own overlay UI. -->
{#if shouldShowGlobe && GlobeComponent}
  {@const Globe = GlobeComponent}
  <Globe mode={globeMode} />
{/if}

{@render children()}
