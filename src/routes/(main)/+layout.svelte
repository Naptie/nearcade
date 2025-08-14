<script lang="ts">
  import Header from '$lib/components/NavigationBar.svelte';
  import Footer from '$lib/components/Footer.svelte';

  let { children } = $props();
</script>

<Header />

{@render children()}

<Footer class="mb-6" />
