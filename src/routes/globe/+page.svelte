<script>
  import Header from '$lib/components/NavigationBar.svelte';
  import { getShopOpeningHours, pageTitle } from '$lib/utils';
  import Globe from '$lib/components/Globe.svelte';
  import { onMount } from 'svelte';
  import Footer from '$lib/components/Footer.svelte';
  import { m } from '$lib/paraglide/messages.js';

  let { data } = $props();

  let now = $state(new Date());

  onMount(() => {
    const interval = setInterval(() => {
      now = new Date();
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  });
</script>

<svelte:head>
  <title>{pageTitle(m.globe())}</title>
</svelte:head>

<Header />

<Globe
  data={data.shops.map((shop) => {
    const openingHours = getShopOpeningHours(shop);
    return {
      location: {
        latitude: shop.location.coordinates[1],
        longitude: shop.location.coordinates[0]
      },
      amount: shop.games ? shop.games.reduce((acc, game) => acc + game.quantity, 0) : 0,
      color: openingHours && now >= openingHours.open && now <= openingHours.close ? 'green' : 'red'
    };
  })}
/>

<div class="absolute bottom-6 mx-auto w-full">
  <Footer />
</div>
