<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import NavigationBar from '$lib/components/NavigationBar.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import { pageTitle } from '$lib/utils';
  import { fade } from 'svelte/transition';
  import { isDarkMode } from '$lib/utils/scoped';
</script>

<svelte:head>
  <title>{pageTitle(m.globe())}</title>
</svelte:head>

<!-- NavigationBar sits above the globe map (z-999 in NavigationBar) -->
<div in:fade={{ delay: 500 }} out:fade>
  <NavigationBar showCapsularBackground={!isDarkMode()} />
</div>

<!-- Full-screen spacer so the page takes up the full viewport (the globe fills the background) -->
<div class="h-screen w-full"></div>

<div
  class="pointer-events-none absolute bottom-6 flex w-full justify-center *:pointer-events-auto"
  in:fade={{ delay: 500 }}
  out:fade
>
  <Footer />
</div>
