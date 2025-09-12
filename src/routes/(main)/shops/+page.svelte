<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import { resolve } from '$app/paths';
  import { formatShopAddress, getGameName, getShopSourceUrl, pageTitle } from '$lib/utils';
  import { PAGINATION, GAMES } from '$lib/constants';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import type { Shop } from '$lib/types';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state(data.query);
  let isSearching = $state(false);

  const handleSearch = async (event: Event) => {
    event.preventDefault();
    isSearching = true;
    const params = new SvelteURLSearchParams();
    if (searchQuery.trim()) {
      params.set('q', searchQuery.trim());
    }
    await goto(resolve('/(main)/shops') + `?${params.toString()}`);
    isSearching = false;
  };

  const handlePageChange = (newPage: number) => {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    params.set('page', newPage.toString());
    goto(resolve('/(main)/shops') + `?${params.toString()}`);
  };

  const getShopLink = (shop: Shop): string => {
    return `/shops/${shop.source}/${shop.id}`;
  };

  const getTotalMachines = (shop: Shop): number => {
    return shop.games.reduce((total, game) => total + game.quantity, 0);
  };

  const getGameInfo = (gameId: number) => {
    return GAMES.find((g) => g.id === gameId);
  };
</script>

<svelte:head>
  <title>{pageTitle(m.browse_shops())}</title>
  <meta name="description" content={m.browse_search_shops()} />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-8 sm:px-6 lg:px-8">
  <!-- Header -->
  <h1 class="mb-4 text-3xl font-bold">{m.browse_shops()}</h1>

  <!-- Search Bar -->
  <div class="mb-8">
    <form onsubmit={handleSearch} class="flex gap-4">
      <div class="flex-1">
        <input
          type="text"
          bind:value={searchQuery}
          placeholder={m.search_shop()}
          class="input input-bordered w-full"
        />
      </div>
      <button
        type="submit"
        class="btn btn-primary"
        class:btn-soft={!searchQuery}
        class:btn-disabled={isSearching}
      >
        {#if isSearching}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          <i class="fa-solid fa-search"></i>
        {/if}
        <span class="not-sm:hidden">{m.search()}</span>
      </button>
    </form>
  </div>

  <!-- Results -->
  <div class="space-y-6">
    {#if data.shops.length > 0}
      <!-- Results Header -->
      <div class="flex items-center justify-between">
        <div class="text-base-content/60 text-sm">
          {#if data.query}
            {m.showing_results_for({ query: data.query })}
          {:else}
            {m.showing_all_shops()}
          {/if}
        </div>
        <div class="text-base-content/60 text-sm">
          {m.shops_available({ count: data.totalCount })}
        </div>
      </div>

      <!-- Shop Grid -->
      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {#each data.shops as shop (shop._id)}
          {@const aggregatedGames = (() => {
            const map = new Map();
            for (const g of shop.games) {
              const existing = map.get(g.id);
              if (existing) {
                existing.quantity += g.quantity;
              } else {
                map.set(g.id, { ...g });
              }
            }
            return Array.from(map.values());
          })()}
          <a
            href={getShopLink(shop)}
            class="card bg-base-200 border-primary/0 hover:border-primary min-w-0 border-2 shadow-sm transition hover:shadow-md"
          >
            <div class="card-body">
              <!-- Shop Header -->
              <div class="flex items-center justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <h3 class="truncate text-lg font-semibold" title={shop.name}>
                    {shop.name}
                  </h3>
                </div>
                <button
                  class="btn btn-soft btn-sm btn-circle"
                  onclick={(e) => {
                    e.preventDefault();
                    window.open(getShopSourceUrl(shop), '_blank');
                  }}
                  aria-label={m.view_on_source({ source: shop.source.toUpperCase() })}
                >
                  <i class="fa-solid fa-external-link-alt"></i>
                </button>
              </div>

              <!-- Address -->
              <div class="mb-4">
                <div class="text-base-content/80 flex items-start gap-2 text-sm">
                  <i class="fa-solid fa-location-dot text-primary mt-0.5 shrink-0"></i>
                  <span class="line-clamp-2">
                    {formatShopAddress(shop)}
                  </span>
                </div>
              </div>

              <!-- Games Info -->
              <div class="mb-4">
                <div class="flex flex-wrap gap-2">
                  {#each aggregatedGames.slice(0, 6) as game (game.id)}
                    {@const gameInfo = getGameInfo(game.id)}
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
              <div class="mt-auto flex items-center justify-between gap-1 text-sm">
                <div class="text-base-content/60 flex items-center gap-1">
                  <i class="fa-solid fa-desktop"></i>
                  <span>{m.machines({ count: getTotalMachines(shop) })}</span>
                </div>
                <div class="text-base-content/60 flex items-center gap-1">
                  <i class="fa-solid fa-users"></i>
                  <span>{m.in_attendance({ count: 0 })}</span>
                </div>
              </div>
            </div>
          </a>
        {/each}
      </div>

      <!-- Pagination -->
      {#if data.totalCount > PAGINATION.PAGE_SIZE}
        <div class="flex justify-center">
          <div class="join">
            {#if data.hasPrevPage}
              <button
                class="join-item btn"
                onclick={() => handlePageChange(data.currentPage - 1)}
                aria-label={m.previous_page()}
              >
                <i class="fa-solid fa-chevron-left"></i>
              </button>
            {/if}

            <button class="join-item btn btn-active">
              {data.currentPage} / {Math.ceil(data.totalCount / PAGINATION.PAGE_SIZE)}
            </button>

            {#if data.hasNextPage}
              <button
                class="join-item btn"
                onclick={() => handlePageChange(data.currentPage + 1)}
                aria-label={m.next_page()}
              >
                <i class="fa-solid fa-chevron-right"></i>
              </button>
            {/if}
          </div>
        </div>
      {/if}
    {:else}
      <!-- No Results -->
      <div class="py-12 text-center">
        <div class="text-base-content/40 mb-4">
          <i class="fa-solid fa-store text-4xl"></i>
        </div>
        <h3 class="mb-2 text-xl font-semibold">
          {#if data.query}
            {m.no_shops_found_for({ query: data.query })}
          {:else}
            {m.no_shops_available()}
          {/if}
        </h3>
        <p class="text-base-content/60">
          {m.try_different_search_or_check_later()}
        </p>
      </div>
    {/if}
  </div>
</div>
