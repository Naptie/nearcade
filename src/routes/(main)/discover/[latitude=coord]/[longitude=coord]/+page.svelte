<script lang="ts">
  import type { Game, AMapContext } from '$lib/types';
  import { m } from '$lib/paraglide/messages';
  import { onMount, onDestroy, getContext, untrack } from 'svelte';

  let { data } = $props();

  let screenWidth = $state(0);
  let machineCount = $derived.by(() => {
    return data.shops.reduce(
      (total, shop) =>
        total + shop.games.reduce((total: number, game: Game) => total + game.quantity, 0),
      0
    );
  });

  const amapContext = getContext<AMapContext>('amap');
  let amap = $derived(amapContext?.amap);
  let amapReady = $derived(amapContext?.ready ?? false);
  let amapError = $derived(amapContext?.error ?? null);
  let amapContainer: HTMLDivElement | undefined = $state(undefined);
  let map: AMap.Map | undefined = $state(undefined);
  let highlightedShopId: number | null = $state(null);
  let highlightedShopIdTimeout: number | null = $state(null);
  let isDarkMode = $state(false);

  const formatDistance = (distance: number): string => {
    if (distance === Infinity) return m.unknown();
    return `${distance.toFixed(2)} km`;
  };

  const findGame = (games: Game[], gameId: number): Game | null => {
    return games?.find((game) => game.id === gameId) || null;
  };

  const allGames = [
    { id: 1, name: m.maimai_dx() },
    { id: 3, name: m.chunithm() },
    { id: 31, name: m.taiko_no_tatsujin() },
    { id: 4, name: m.sound_voltex() },
    { id: 17, name: m.wacca() }
  ];

  const visibleGames = $derived.by(() => {
    if (screenWidth < 480) return []; // 2xs: no games
    if (screenWidth < 640) return allGames.slice(0, 1); // xs: 1 game
    if (screenWidth < 768) return allGames.slice(0, 2); // sm: 2 games
    if (screenWidth < 1024) return allGames.slice(0, 3); // md: 3 games
    if (screenWidth < 1280) return allGames.slice(0, 4); // lg: 4 games
    return allGames; // xl: all 5 games
  });
  const handleResize = () => {
    screenWidth = window.innerWidth;
  };

  const updateTheme = () => {
    isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  onMount(() => {
    screenWidth = window.innerWidth;
    updateTheme();
    window.addEventListener('resize', handleResize);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', updateTheme);

    return () => {
      mediaQuery.removeEventListener('change', updateTheme);
    };
  });
  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', handleResize);
    }
  });
  $effect(() => {
    if (!amap || !amapReady || !data || !amapContainer) return;
    untrack(() => {
      map = new amap.Map(amapContainer!.id, {
        zoom: 10,
        center: [data.coordinates.longitude, data.coordinates.latitude],
        mapStyle: isDarkMode ? 'amap://styles/dark' : 'amap://styles/whitesmoke',
        viewMode: '2D'
      });

      const origin = new amap.Marker({
        position: [data.coordinates.longitude, data.coordinates.latitude],
        title: m.origin(),
        content: '<i class="text-success fa-solid fa-location-crosshairs fa-lg"></i>',
        offset: new amap.Pixel(-9.375, -10),
        label: {
          content: m.origin(),
          offset: new amap.Pixel(2, -5),
          direction: 'right'
        }
      });
      origin.setMap(map);

      data.shops.forEach((shop) => {
        const marker = new amap.Marker({
          position: [shop.location.longitude, shop.location.latitude],
          title: shop.name,
          content: '<i class="text-success fa-solid fa-location-dot fa-lg"></i>',
          offset: new amap.Pixel(-7.03, -20),
          label: {
            content: shop.name,
            offset: new amap.Pixel(2, -5),
            direction: 'right'
          }
        });
        marker.on('click', () => {
          highlightedShopId = shop.id;
          if (highlightedShopIdTimeout) {
            clearTimeout(highlightedShopIdTimeout);
          }
          highlightedShopIdTimeout = setTimeout(() => {
            highlightedShopId = null;
          }, 3000);
          const shopElement = document.getElementById(`shop-${shop.id}`);
          if (shopElement) {
            shopElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
        marker.setMap(map);
      });
      map.setFitView();
    });
  });

  $effect(() => {
    if (!map) return;
    map.setMapStyle(isDarkMode ? 'amap://styles/dark' : 'amap://styles/fresh');
  });
</script>

<svelte:head>
  <title>{m.nearby_arcades()} - nearcade</title>
</svelte:head>

<div class="container mx-auto p-4 py-20">
  <div class="mb-6">
    <h1 class="mb-2 text-3xl font-bold">{m.nearby_arcades()}</h1>
    <p class="text-base-content/70">
      {m.found_shops_near({
        count: data.shops.length,
        lat: data.coordinates.latitude.toFixed(4),
        lng: data.coordinates.longitude.toFixed(4)
      })}
    </p>
  </div>
  {#if data.shops.length === 0}
    <div class="alert alert-soft alert-info not-dark:hidden">
      <i class="fa-solid fa-circle-info fa-lg"></i>
      <span>{m.no_shops_found()}</span>
    </div>
    <div class="alert alert-info dark:hidden">
      <i class="fa-solid fa-circle-info fa-lg"></i>
      <span>{m.no_shops_found()}</span>
    </div>
  {:else}
    {#if amapError}
      <div class="alert alert-error mb-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6 shrink-0 stroke-current"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>
          {m.map_failure({
            error: amapError
          })}
        </span>
      </div>
    {/if}
    <div
      id="amap-container"
      class="mb-4 h-[60vh] w-full rounded-xl {!amapReady
        ? 'bg-base-200 animate-pulse opacity-50'
        : ''}"
      bind:this={amapContainer}
    ></div>
    <div class="overflow-x-auto">
      <table class="bg-base-200/30 dark:bg-base-200 table w-full">
        <thead>
          <tr>
            <th class="text-left">{m.shop()}</th>
            <th class="text-center">{m.distance()}</th>
            {#each visibleGames as game (game.id)}
              <th id="game-{game.id}" class="text-center">{game.name}</th>
            {/each}
            <th class="text-right">{m.actions()}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.shops as shop (shop.id)}
            <tr
              id="shop-{shop.id}"
              class="transition-all {highlightedShopId === shop.id ? 'bg-accent/12' : ''}"
            >
              <td>
                <div class="flex items-center space-x-3">
                  <div>
                    <div class="text-lg font-bold">{shop.name}</div>
                    <div class="hidden text-sm opacity-50 sm:block">ID: {shop.id}</div>
                  </div>
                </div>
              </td>
              <td class="text-center">
                <div
                  class="badge badge-soft badge-sm sm:badge-md lg:badge-lg whitespace-nowrap {shop.distance <
                  data.radius / 3
                    ? 'badge-success'
                    : shop.distance < (data.radius * 2) / 3
                      ? 'badge-warning'
                      : 'badge-error'}"
                >
                  {formatDistance(shop.distance)}
                </div>
              </td>
              {#each visibleGames as gameInfo (gameInfo.id)}
                {@const game = findGame(shop.games, gameInfo.id)}
                <td class="text-center">
                  {#if game}
                    <div class="flex items-center justify-center gap-3">
                      <div class="text-accent flex items-center gap-1 text-sm">
                        <i class="fas fa-desktop"></i>
                        {game.quantity}
                      </div>
                      <div class="text-warning flex items-center gap-1 text-sm">
                        <i class="fa-solid fa-coins"></i>
                        {game.coin}
                      </div>
                    </div>
                  {:else}
                    <div class="text-base-content/40 text-xl">—</div>
                  {/if}
                </td>
              {/each}
              <td class="text-right">
                <div class="flex justify-end space-x-2">
                  <a
                    class="btn btn-ghost btn-sm"
                    href={`https://map.bemanicn.com/shop/${shop.id}`}
                    target="_blank"
                  >
                    <i class="fas fa-info-circle"></i>
                    {m.details()}
                  </a>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
      <div class="stat bg-base-200/30 dark:bg-base-200 rounded-xl" style="--border: 0">
        <div class="stat-figure text-primary">
          <i class="fas fa-store text-3xl"></i>
        </div>
        <div class="stat-title">{m.total_shops()}</div>
        <div class="stat-value text-primary">{data.shops.length}</div>
        <div class="stat-desc">{m.in_this_area()}</div>
      </div>

      <div class="stat bg-base-200/30 dark:bg-base-200 rounded-xl" style="--border: 0">
        <div class="stat-figure text-secondary">
          <i class="fas fa-desktop text-3xl"></i>
        </div>
        <div class="stat-title">{m.total_machines()}</div>
        <div class="stat-value text-secondary">
          {machineCount}
        </div>
        <div class="stat-desc">{m.arcade_machines()}</div>
      </div>

      <div class="stat bg-base-200/30 dark:bg-base-200 rounded-xl" style="--border: 0">
        <div class="stat-figure text-accent">
          <i class="fas fa-bullseye text-3xl"></i>
        </div>
        <div class="stat-title">{m.area_density()}</div>
        <div class="stat-value text-accent">
          {(machineCount / (Math.PI * Math.pow(data.radius, 2))).toFixed(3)}
        </div>
        <div class="stat-desc">{m.machines_per_km2()}</div>
      </div>
    </div>
  {/if}
</div>

<style lang="postcss">
  @reference "tailwindcss";

  :global(.amap-marker-label) {
    @apply rounded-full border-0 bg-emerald-500/12 px-2 backdrop-blur-lg;
  }
</style>
