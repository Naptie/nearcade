<script lang="ts">
  import { browser } from '$app/environment';
  import { beforeNavigate, afterNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Globe from '$lib/components/Globe.svelte';
  import { onDestroy } from 'svelte';
  import type { LayoutData } from './$types';
  import { IS_ANDROID_OR_IOS, IS_LOW_DATA } from '$lib/utils/index.client';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const showGlobe = !IS_ANDROID_OR_IOS && !IS_LOW_DATA;

  const isLandingPage = $derived(page.url.pathname === resolve('/'));
  const isGlobePage = $derived(page.url.pathname === resolve('/globe'));
  const globeMode = $derived<'landing' | 'fullscreen'>(isGlobePage ? 'fullscreen' : 'landing');

  const TRANSITION_SCROLLBAR_HIDE_MS = 1000;
  let transitionScrollbarTimer: ReturnType<typeof setTimeout> | undefined;

  const setTransitionScrollbarHidden = (hidden: boolean) => {
    if (!browser) return;
    document.documentElement.classList.toggle('transition-scrollbar-hidden', hidden);
  };

  const scheduleTransitionScrollbarRestore = () => {
    clearTimeout(transitionScrollbarTimer);
    transitionScrollbarTimer = setTimeout(() => {
      setTransitionScrollbarHidden(false);
    }, TRANSITION_SCROLLBAR_HIDE_MS);
  };

  // Keep scrolling enabled on the landing page, but visually suppress the
  // transient root scrollbar while route transition animations settle.
  beforeNavigate(({ to }) => {
    const nextPath = to?.url.pathname;
    const navigatingWithinGlobeRoutes =
      showGlobe &&
      ((isLandingPage && nextPath === resolve('/globe')) ||
        (isGlobePage && nextPath === resolve('/')));

    if (navigatingWithinGlobeRoutes) {
      setTransitionScrollbarHidden(true);
      scheduleTransitionScrollbarRestore();
    }
  });

  afterNavigate(() => {
    if (browser && document.documentElement.classList.contains('transition-scrollbar-hidden')) {
      scheduleTransitionScrollbarRestore();
    }
  });

  onDestroy(() => {
    clearTimeout(transitionScrollbarTimer);
    setTransitionScrollbarHidden(false);
  });
</script>

<svelte:head>
  <style>
    html.transition-scrollbar-hidden {
      scrollbar-width: none;
    }

    html.transition-scrollbar-hidden::-webkit-scrollbar {
      width: 0;
      height: 0;
    }
  </style>
</svelte:head>

<!-- Globe is always mounted while navigating between / and /globe.
     It is positioned fixed behind all page content and controls its own overlay UI. -->
{#if (isLandingPage && showGlobe) || isGlobePage}
  <Globe mode={globeMode} shopData={data.globeShopData} />
{/if}

{@render children()}
