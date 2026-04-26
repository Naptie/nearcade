<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import {
    aggregateGames,
    formatHourLiteral,
    formatShopAddress,
    getGameName,
    adaptiveNewTab
  } from '$lib/utils';
  import { resolve } from '$app/paths';
  import { GAMES } from '$lib/constants';
  import type { Shop, ShopWithExtras } from '$lib/types';

  let {
    shop,
    interactive = false,
    onclick
  }: {
    shop: ShopWithExtras;
    interactive?: boolean;
    onclick?: () => void;
  } = $props();

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

  const getGameInfo = (titleId: number) => GAMES.find((g) => g.id === titleId);

  const getTotalMachines = (s: Pick<Shop, 'games'>) =>
    s.games.reduce((total, game) => total + game.quantity, 0);

  const aggregatedGames = $derived(aggregateGames(shop));
  const openingHours = $derived(shop.openingHoursParsed);
  const offsetLocal = $derived.by(() => {
    if (!openingHours) return '';
    const hours = openingHours.offsetHours;
    const sign = hours >= 0 ? '+' : '-';
    return `${sign}${formatHourLiteral(Math.abs(hours))}`;
  });

  const shopPageUrl = resolve('/(main)/shops/[source]/[id]', {
    source: shop.source,
    id: shop.id.toString()
  });
  const nearbyUrl = `${resolve('/(main)/discover')}?longitude=${encodeURIComponent(
    shop.location.coordinates[0]
  )}&latitude=${encodeURIComponent(shop.location.coordinates[1])}&name=${encodeURIComponent(shop.name)}&radius=10`;
  const mapUrl =
    shop.source === 'ziv'
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${shop.name} ${formatShopAddress(shop)}`
        )}`
      : `https://uri.amap.com/marker?position=${shop.location.coordinates[0]},${shop.location.coordinates[1]}&name=${encodeURIComponent(shop.name)}&src=nearcade&callnative=1`;
  const mapLinkLabel = shop.source === 'ziv' ? m.view_in_google_maps() : m.view_in_amap();
</script>

{#snippet cardContent()}
  <!-- Shop Header -->
  <div class="mb-2 flex flex-col">
    {#if interactive}
      <a
        href={shopPageUrl}
        target={adaptiveNewTab()}
        class="hover:text-primary truncate text-lg font-semibold transition-colors"
        title={shop.name}
        onclick={(e) => e.stopPropagation()}
      >
        {shop.name}
      </a>
    {:else}
      <h3 class="truncate text-lg font-semibold" title={shop.name}>
        {shop.name}
      </h3>
    {/if}

    {#if openingHours}
      <div class="text-base-content/80 flex items-center gap-2 text-sm">
        <i class="fa-solid fa-clock text-primary shrink-0"></i>
        <span class="line-clamp-2">
          <div class="flex items-center justify-between gap-1">
            <span class="text-base-content/60 truncate" title={m.local_time()}>
              (UTC{offsetLocal})
            </span>
            <span class="text-right">{openingHours.openLocal} – {openingHours.closeLocal}</span>
          </div>
        </span>
      </div>
    {/if}

    <div class="text-base-content/80 flex items-center gap-2 text-sm">
      <i class="fa-solid fa-location-dot text-primary shrink-0"></i>
      <span class="line-clamp-2">{formatShopAddress(shop)}</span>
    </div>
  </div>

  <!-- Games Info -->
  <div class="mb-1">
    <div class="flex flex-wrap gap-2">
      {#each aggregatedGames.slice(0, 6) as game (game.titleId)}
        {@const gameInfo = getGameInfo(game.titleId)}
        {#if gameInfo}
          <div class="badge badge-soft badge-sm">
            <span class="max-w-16 truncate">{getGameName(gameInfo.key) || game.name}</span>
            <span class="text-xs opacity-70">×{game.quantity}</span>
          </div>
        {/if}
      {/each}
      {#if aggregatedGames.length > 6}
        <div class="badge badge-soft badge-sm">+{aggregatedGames.length - 6}</div>
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

  {#if interactive}
    <!-- Action buttons -->
    <div
      class="border-base-content/10 mt-3 flex flex-wrap gap-2 border-t pt-3"
      role="none"
      onclick={(e) => e.stopPropagation()}
    >
      <a href={shopPageUrl} target={adaptiveNewTab()} class="btn btn-primary btn-soft btn-xs">
        <i class="fa-solid fa-circle-info"></i>
        {m.shop_details()}
      </a>
      <a href={nearbyUrl} target={adaptiveNewTab()} class="btn btn-accent btn-soft btn-xs">
        <i class="fa-solid fa-map-location-dot"></i>
        {m.explore_nearby()}
      </a>
      <a href={mapUrl} target="_blank" rel="noopener noreferrer" class="btn btn-soft btn-xs">
        <i class="fa-solid fa-map"></i>
        {mapLinkLabel}
      </a>
    </div>
  {/if}
{/snippet}

{#if interactive}
  <div
    class="card bg-base-200 min-w-0 cursor-pointer border-2 shadow-md transition border-{getDensityTailwindColor(
      shop.density
    )}/30 hover:border-primary"
    role="button"
    tabindex="0"
    {onclick}
    onkeydown={(e) => e.key === 'Enter' && onclick?.()}
  >
    <div class="card-body p-5">
      {@render cardContent()}
    </div>
  </div>
{:else}
  <a
    href={shopPageUrl}
    target={adaptiveNewTab()}
    class="card bg-base-200 min-w-0 border-2 shadow-md transition border-{getDensityTailwindColor(
      shop.density
    )}/30 hover:border-primary"
  >
    <div class="card-body p-5">
      {@render cardContent()}
    </div>
  </a>
{/if}

<!-- Tailwind safelist for dynamic colour classes -->
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
