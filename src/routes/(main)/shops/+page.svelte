<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import { resolve } from '$app/paths';
  import { formatShopAddress, pageTitle } from '$lib/utils';
  import { PAGINATION, GAMES, ShopSource } from '$lib/constants';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import type { Shop, Game } from '$lib/types';

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
    return GAMES.find(g => g.id === gameId);
  };

  const getSourceUrl = (shop: Shop): string => {
    return shop.source === ShopSource.ZIV 
      ? `https://zenius-i-vanisher.com/v5.2/arcade.php?id=${shop.id}`
      : `https://map.bemanicn.com/shop/${shop.id}`;
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
          <a
            href={getShopLink(shop)}
            class="card bg-base-200 border-primary/0 hover:border-primary border-2 shadow-sm transition hover:shadow-md"
          >
            <div class="card-body p-6">
              <!-- Shop Header -->
              <div class="mb-4 flex items-center justify-between">
                <div class="flex-1 min-w-0">
                  <h3 class="text-lg font-semibold truncate">
                    {shop.name}
                  </h3>
                  <div class="text-base-content/60 flex items-center gap-2 text-sm">
                    <span class="badge badge-outline badge-sm">
                      {shop.source.toUpperCase()}
                    </span>
                    <span>#{shop.id}</span>
                  </div>
                </div>
              </div>

              <!-- Address -->
              <div class="mb-4">
                <div class="text-base-content/80 flex items-start gap-2 text-sm">
                  <i class="fa-solid fa-location-dot mt-0.5 text-primary shrink-0"></i>
                  <span class="line-clamp-2">
                    {formatShopAddress(shop)}
                  </span>
                </div>
              </div>

              <!-- Games Info -->
              <div class="mb-4">
                <div class="text-base-content/60 mb-2 text-xs font-medium uppercase">
                  {m.games_available()}
                </div>
                <div class="flex flex-wrap gap-2">
                  {#each shop.games.slice(0, 4) as game (game.id)}
                    {@const gameInfo = getGameInfo(game.id)}
                    {#if gameInfo}
                      <div class="badge badge-soft badge-sm">
                        <span class="truncate max-w-16">{gameInfo.key.replace(/_/g, ' ')}</span>
                        <span class="ml-1 text-xs opacity-70">×{game.quantity}</span>
                      </div>
                    {/if}
                  {/each}
                  {#if shop.games.length > 4}
                    <div class="badge badge-soft badge-sm">
                      +{shop.games.length - 4}
                    </div>
                  {/if}
                </div>
              </div>

              <!-- Stats -->
              <div class="flex items-center justify-between text-sm">
                <div class="text-base-content/60 flex items-center gap-1">
                  <i class="fa-solid fa-desktop"></i>
                  <span>{getTotalMachines(shop)} {m.machines()}</span>
                </div>
                <a
                  href={getSourceUrl(shop)}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-ghost btn-xs"
                  onclick={(e) => e.stopPropagation()}
                >
                  <i class="fa-solid fa-external-link-alt"></i>
                  {m.source()}
                </a>
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
              >
                <i class="fa-solid fa-chevron-left"></i>
                {m.previous()}
              </button>
            {/if}
            
            <button class="join-item btn btn-active">
              {m.page_of({ current: data.currentPage, total: Math.ceil(data.totalCount / PAGINATION.PAGE_SIZE) })}
            </button>
            
            {#if data.hasNextPage}
              <button
                class="join-item btn"
                onclick={() => handlePageChange(data.currentPage + 1)}
              >
                {m.next()}
                <i class="fa-solid fa-chevron-right"></i>
              </button>
            {/if}
          </div>
        </div>
      {/if}
    {:else}
      <!-- No Results -->
      <div class="text-center py-12">
        <div class="text-base-content/40 mb-4">
          <i class="fa-solid fa-store text-4xl"></i>
        </div>
        <h3 class="text-xl font-semibold mb-2">
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