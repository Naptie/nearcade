<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import { resolve } from '$app/paths';
  import {
    aggregateGames,
    formatShopAddress,
    getGameName,
    getShopSourceUrl,
    pageTitle
  } from '$lib/utils';
  import { PAGINATION, GAMES } from '$lib/constants';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import type { Shop } from '$lib/types';
  import AttendanceReportBlame from '$lib/components/AttendanceReportBlame.svelte';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state(data.query);
  let isSearching = $state(false);
  let selectedTitleIds = $state<number[]>(data.titleIds || []);
  let isFilterOpen = $state(false);

  const handleSearch = async (event: Event) => {
    event.preventDefault();
    isSearching = true;
    const params = new SvelteURLSearchParams();
    if (searchQuery.trim()) {
      params.set('q', searchQuery.trim());
    }
    if (selectedTitleIds.length > 0) {
      params.set('titleIds', selectedTitleIds.join(','));
    }
    await goto(resolve('/(main)/shops') + `?${params.toString()}`);
    isSearching = false;
  };

  const handlePageChange = (newPage: number) => {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    params.set('page', newPage.toString());
    goto(resolve('/(main)/shops') + `?${params.toString()}`);
  };

  const handleTitleFilterChange = (titleId: number) => {
    if (selectedTitleIds.includes(titleId)) {
      selectedTitleIds = selectedTitleIds.filter((id) => id !== titleId);
    } else {
      selectedTitleIds = [...selectedTitleIds, titleId];
    }
  };

  const applyFilters = async () => {
    isSearching = true;
    const params = new SvelteURLSearchParams();
    if (searchQuery.trim()) {
      params.set('q', searchQuery.trim());
    }
    if (selectedTitleIds.length > 0) {
      params.set('titleIds', selectedTitleIds.join(','));
    }
    await goto(resolve('/(main)/shops') + `?${params.toString()}`);
    isSearching = false;
    isFilterOpen = false;
  };

  const clearFilters = async () => {
    selectedTitleIds = [];
    isSearching = true;
    const params = new SvelteURLSearchParams();
    if (searchQuery.trim()) {
      params.set('q', searchQuery.trim());
    }
    await goto(resolve('/(main)/shops') + `?${params.toString()}`);
    isSearching = false;
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
      <!-- Game Title Filter Dropdown -->
      <div class="dropdown" class:dropdown-open={isFilterOpen}>
        <button
          type="button"
          tabindex="0"
          class="btn btn-soft"
          class:btn-primary={selectedTitleIds.length > 0}
          onclick={() => (isFilterOpen = !isFilterOpen)}
          aria-label={m.filter_by_game_titles()}
        >
          <i class="fa-solid fa-filter"></i>
          {#if selectedTitleIds.length > 0}
            <span class="badge badge-sm">{selectedTitleIds.length}</span>
          {/if}
        </button>
        {#if isFilterOpen}
          <div
            role="menu"
            tabindex="-1"
            class="card dropdown-content bg-base-100 z-10 mt-2 w-64 shadow-lg"
            onkeydown={(e) => {
              if (e.key === 'Escape') {
                isFilterOpen = false;
              }
            }}
          >
            <div class="card-body p-4">
              <h3 class="card-title text-base">{m.filter_by_game_titles()}</h3>
              <div class="space-y-2">
                {#each GAMES as game (game.id)}
                  <label class="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      checked={selectedTitleIds.includes(game.id)}
                      onchange={() => handleTitleFilterChange(game.id)}
                    />
                    <span class="text-sm">{getGameName(game.key)}</span>
                  </label>
                {/each}
              </div>
              <div class="card-actions mt-4 justify-between">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  onclick={clearFilters}
                  disabled={selectedTitleIds.length === 0}
                >
                  {m.clear_filters()}
                </button>
                <button type="button" class="btn btn-primary btn-sm" onclick={applyFilters}>
                  {m.apply_filters()}
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>

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
          {@const aggregatedGames = aggregateGames(shop)}
          <a
            href={getShopLink(shop)}
            class="card bg-base-200 border-primary/0 hover:border-primary min-w-0 border-2 shadow-sm transition hover:shadow-md"
          >
            <div class="card-body p-5">
              <!-- Shop Header -->
              <div class="mb-2 flex flex-col">
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

                <div class="text-base-content/80 flex items-start gap-2 text-sm">
                  <i class="fa-solid fa-location-dot text-primary mt-0.5 shrink-0"></i>
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
              <div class="mt-auto flex items-center justify-between gap-1 text-sm">
                <div class="text-base-content/60 flex items-center gap-1">
                  <i class="fa-solid fa-desktop"></i>
                  <span>{m.machines({ count: getTotalMachines(shop) })}</span>
                </div>
                {#if shop.currentReportedAttendance && shop.currentReportedAttendance.count >= shop.currentAttendance}
                  <AttendanceReportBlame reportedAttendance={shop.currentReportedAttendance}>
                    <div class="text-accent flex items-center gap-1">
                      <i class="fa-solid fa-user"></i>
                      <span
                        >{m.in_attendance({
                          count: shop.currentReportedAttendance.count || 0
                        })}</span
                      >
                    </div>
                  </AttendanceReportBlame>
                {:else}
                  <div
                    class="text-base-content/60 flex items-center gap-1"
                    class:text-primary={shop.currentAttendance > 0}
                  >
                    <i class="fa-solid fa-user"></i>
                    <span>{m.in_attendance({ count: shop.currentAttendance || 0 })}</span>
                  </div>
                {/if}
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
