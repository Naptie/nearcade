<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import NavigationBar from '$lib/components/NavigationBar.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import { pageTitle } from '$lib/utils';
  import { fade } from 'svelte/transition';
</script>

<svelte:head>
  <title>{pageTitle(m.globe())}</title>
</svelte:head>

<!-- NavigationBar sits above the globe map (z-999 in NavigationBar) -->
<NavigationBar />

<!-- Full-screen spacer so the page takes up the full viewport (the globe fills the background) -->
<div class="h-screen w-full"></div>

<div class="absolute bottom-6 mx-auto w-full" transition:fade>
  <Footer />
</div>
