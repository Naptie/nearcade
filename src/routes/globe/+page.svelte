<script lang="ts">
  import Header from '$lib/components/NavigationBar.svelte';
  import {
    aggregateGames,
    formatHourLiteral,
    formatShopAddress,
    getGameName,
    getShopOpeningHours,
    isTouchscreen,
    pageTitle
  } from '$lib/utils';
  import Globe from '$lib/components/Globe.svelte';
  import { onMount } from 'svelte';
  import Footer from '$lib/components/Footer.svelte';
  import { m } from '$lib/paraglide/messages.js';
  import type { Shop } from '$lib/types/index.js';
  import { resolve } from '$app/paths';
  import { GAMES } from '$lib/constants';

  type ShopWithExtras = (typeof data.shops)[number] & {
    openingHoursParsed: ReturnType<typeof getShopOpeningHours>;
    currentAttendance: number;
    density: number;
  };

  let { data } = $props();

  let shops = $derived.by<ShopWithExtras[]>(() => {
    return data.shops.map((shop) => {
      const shopWithExtras = {
        ...shop,
        openingHoursParsed: getShopOpeningHours(shop),
        currentAttendance: shop.attendances.reduce((sum, att) => sum + att.total, 0),
        density: 0
      };
      return {
        ...shopWithExtras,
        density: getShopDensity(shopWithExtras)
      };
    });
  });
  let now = $state(new Date());
  let hoveredShop: (typeof shops)[number] | null = $state(null);
  let cursorPos = $state({ x: 0, y: 0 });
  let isMobile = $derived(isTouchscreen());

  onMount(() => {
    // const interval = setInterval(() => {
    //   now = new Date();
    // }, 1000);

    const handleMouseMove = (e: MouseEvent) => {
      cursorPos = { x: e.clientX, y: e.clientY };
    };

    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      // clearInterval(interval);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  });

  const getDensityColor = (density: number) => {
    switch (density) {
      case 1:
        return 'green';
      case 2:
        return 'yellow';
      case 3:
        return 'orange';
      case 4:
        return 'red';
      default:
        return 'gray';
    }
  };

  const getDensityTailwindColor = (density: number) => {
    switch (density) {
      case 1:
        return 'green-500';
      case 2:
        return 'yellow-500';
      case 3:
        return 'orange-500';
      case 4:
        return 'red-500';
      default:
        return 'gray-500';
    }
  };

  const getShopDensity = (shop: Omit<ShopWithExtras, 'density'>) => {
    const openingHours = shop.openingHoursParsed;
    if (!openingHours || now < openingHours.open || now > openingHours.close) return 0;
    const density = shop.games
      .reduce((acc, game) => {
        if (acc.has(game.titleId)) {
          acc.get(game.titleId)!.push(game);
        } else {
          acc.set(game.titleId, [game]);
        }
        return acc;
      }, new Map<number, typeof shop.games>())
      .entries()
      .map(([, games]) => {
        const attendances = shop.attendances.reduce((sum, att) => {
          if (games.find((g) => g.gameId === att.gameId)) {
            return sum + att.total;
          }
          return sum;
        }, 0);
        const positions =
          games.reduce((sum, g) => sum + g.quantity, 0) *
          (games[0].titleId === 1 || games[0].titleId === 31 ? 2 : 1);
        return attendances / positions;
      })
      .reduce((max, curr) => (isNaN(curr) ? max : Math.max(max, curr)), 0);
    if (!isFinite(density) || isNaN(density)) return 0;
    switch (true) {
      case density < 0.1:
        return 1;
      case density < 1:
        return 2;
      case density < 2:
        return 3;
      default:
        return 4;
    }
  };

  const getTotalMachines = (shop: Shop): number => {
    return shop.games.reduce((total, game) => total + game.quantity, 0);
  };

  const getGameInfo = (gameId: number) => {
    return GAMES.find((g) => g.id === gameId);
  };
</script>

<svelte:head>
  <title>{pageTitle(m.globe())}</title>
</svelte:head>

<Header />

<Globe
  data={shops.map((shop) => {
    const positions = shop.games.reduce(
      (acc, game) => acc + (game.titleId === 1 || game.titleId === 31 ? 2 : 1) * game.quantity,
      0
    );
    return {
      shop,
      location: {
        latitude: shop.location.coordinates[1],
        longitude: shop.location.coordinates[0]
      },
      amount: positions,
      color: getDensityColor(shop.density)
    };
  })}
  onHover={(point) => {
    if (point !== null) {
      hoveredShop = (point as { shop: ShopWithExtras }).shop;
    } else {
      hoveredShop = null;
    }
  }}
  onClick={(point) => {
    if (point !== null) {
      const shop = (point as { shop: ShopWithExtras }).shop;
      window.open(
        resolve('/(main)/shops/[source]/[id]', { source: shop.source, id: shop.id.toString() }),
        '_blank'
      );
    }
  }}
/>

{#if hoveredShop}
  {@const shop = hoveredShop}
  {@const aggregatedGames = aggregateGames(shop)}
  {@const openingHours = shop.openingHoursParsed!}
  {@const offsetLocal = (() => {
    const hours = openingHours.offsetHours;
    const sign = hours >= 0 ? '+' : '-';
    return `${sign}${formatHourLiteral(Math.abs(hours))}`;
  })()}

  {#snippet card()}
    <div
      class="card bg-base-200 min-w-0 border-2 shadow-md transition border-{getDensityTailwindColor(
        shop.density
      )}/30"
    >
      <div class="card-body p-5">
        <!-- Shop Header -->
        <div class="mb-2 flex flex-col">
          <h3 class="truncate text-lg font-semibold" title={shop.name}>
            {shop.name}
          </h3>

          <div class="text-base-content/80 flex items-center gap-2 text-sm">
            <i class="fa-solid fa-clock text-primary shrink-0"></i>
            <span class="line-clamp-2">
              <div class="group flex items-center justify-between gap-1">
                <span class="text-base-content/60 truncate" title={m.local_time()}>
                  (UTC{offsetLocal})
                </span>
                <span class="text-right">{openingHours.openLocal} – {openingHours.closeLocal}</span>
              </div>
            </span>
          </div>

          <div class="text-base-content/80 flex items-center gap-2 text-sm">
            <i class="fa-solid fa-location-dot text-primary shrink-0"></i>
            <span class="line-clamp-2">
              {formatShopAddress(shop)}
            </span>
          </div>
        </div>

        <!-- Games Info -->
        <div class="mb-1">
          <div class="flex flex-wrap gap-2">
            {#each aggregatedGames.slice(0, 6) as game (game.titleId)}
              {@const gameInfo = getGameInfo(game.titleId)}
              {#if gameInfo}
                <div class="badge badge-soft badge-sm">
                  <span class="max-w-16 truncate">{getGameName(gameInfo.key)}</span>
                  <span class="text-xs opacity-70">×{game.quantity}</span>
                </div>
              {/if}
            {/each}
            {#if aggregatedGames.length > 6}
              <div class="badge badge-soft badge-sm">
                +{aggregatedGames.length - 6}
              </div>
            {/if}
          </div>
        </div>

        <!-- Stats -->
        <div class="mt-auto flex items-center justify-between gap-4 text-sm">
          <div class="text-base-content/60 flex items-center gap-1">
            <i class="fa-solid fa-desktop"></i>
            <span>{m.machines({ count: getTotalMachines(shop) })}</span>
          </div>
          {#if shop.density > 0}
            <div
              class="text-base-content/60 flex items-center gap-1 text-{getDensityTailwindColor(
                shop.density
              )}"
            >
              <i class="fa-solid fa-user"></i>
              <span>{m.in_attendance({ count: shop.currentAttendance || 0 })}</span>
            </div>
          {:else}
            <div class="text-error">
              <span>{m.closed()}</span>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/snippet}

  <div
    class="pointer-events-none fixed z-50"
    class:hidden={isMobile}
    style="left: {cursorPos.x + 5}px; top: {cursorPos.y + 5}px;"
  >
    {@render card()}
  </div>

  <div class="absolute inset-x-0 top-16" class:hidden={!isMobile}>
    {@render card()}
  </div>
{/if}

<div class="absolute bottom-6 mx-auto w-full">
  <Footer />
</div>

<div class="hidden text-green-500"></div>
<div class="hidden text-yellow-500"></div>
<div class="hidden text-orange-500"></div>
<div class="hidden text-red-500"></div>
<div class="hidden text-gray-500"></div>
<div class="hidden border-green-500/30"></div>
<div class="hidden border-yellow-500/30"></div>
<div class="hidden border-orange-500/30"></div>
<div class="hidden border-red-500/30"></div>
<div class="hidden border-gray-500/30"></div>
