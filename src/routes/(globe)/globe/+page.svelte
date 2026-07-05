<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import NavigationBar from '$lib/components/NavigationBar.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import { pageTitle } from '$lib/utils';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';

  let showUi = $state(false);
  let isExiting = $state(false);

  onMount(() => {
    // Defer the heavy navbar/footer mount until the flyTo animation has
    // largely settled, so the route transition isn't blocked by it.
    const timer = setTimeout(() => {
      showUi = true;
    }, 900);

    // Clean up leftover class from a previous navigation
    isExiting = false;

    return () => clearTimeout(timer);
  });

  // Sync exiting state to <html> class for CSS transition targeting,
  // and fade out navbar/footer immediately on home-link click, before
  // SvelteKit destroys the DOM.
  $effect(() => {
    document.documentElement.classList.toggle('globe-exiting-to-landing', isExiting);

    const homeHref = resolve('/');
    const handleClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('a')?.getAttribute('href') === homeHref) {
        isExiting = true;
      }
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  });
</script>

<svelte:head>
  <title>{pageTitle(m.globe())}</title>
</svelte:head>

{#if showUi}
  <!-- NavigationBar sits above the globe map (z-999 in NavigationBar) -->
  <div class="globe-navbar-wrap" in:fade={{ duration: 300 }} out:fade={{ duration: 300 }}>
    <NavigationBar showCapsularBackground />
  </div>

  <!-- Full-screen spacer so the page takes up the full viewport (the globe fills the background) -->
  <div class="h-screen w-full"></div>

  <div
    class="globe-footer-wrap pointer-events-none absolute bottom-6 flex w-full justify-center *:pointer-events-auto"
    in:fade={{ delay: 100, duration: 300 }}
    out:fade={{ duration: 300 }}
  >
    <Footer />
  </div>
{/if}
