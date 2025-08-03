<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import type { PageData } from './$types';
  import { onMount } from 'svelte';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state(data.search || '');
  let searchTimeout: ReturnType<typeof setTimeout>;

  let radius = $state(10);

  onMount(() => {
    const savedRadius = localStorage.getItem('nearcade-radius');
    if (savedRadius) {
      radius = parseInt(savedRadius);
    }
  });

  const handleSearchInput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      updateSearch();
    }, 300);
  };

  const updateSearch = () => {
    const url = new URL(page.url);
    if (searchQuery.trim()) {
      url.searchParams.set('search', searchQuery.trim());
    } else {
      url.searchParams.delete('search');
    }
    url.searchParams.delete('page'); // Reset to first page
    goto(url.toString());
  };
</script>

<svelte:head>
  <title>{m.admin_shops()} - {m.admin_panel()} - {m.app_name()}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <!-- Page Header -->
  <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
    <div class="not-sm:text-center">
      <h1 class="text-base-content text-3xl font-bold">{m.admin_shops()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_shops_description()}</p>
    </div>

    <!-- Shop Statistics -->
    <div class="stats shadow">
      <div class="stat">
        <div class="stat-title">{m.admin_total_shops()}</div>
        <div class="stat-value text-primary">{data.shopStats?.total || 0}</div>
      </div>
    </div>
  </div>

  <!-- Search -->
  <div class="bg-base-100 border-base-300 rounded-lg border p-4 shadow-sm">
    <div class="form-control">
      <label class="label" for="search">
        <span class="label-text font-medium">{m.search()}</span>
      </label>
      <input
        id="search"
        type="text"
        class="input input-bordered w-full"
        placeholder={m.admin_search_by_name()}
        bind:value={searchQuery}
        oninput={handleSearchInput}
      />
    </div>
  </div>

  <!-- Shops List -->
  <div class="bg-base-100 border-base-300 rounded-lg border shadow-sm">
    {#if data.shops && data.shops.length > 0}
      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>{m.admin_shop_header()}</th>
              <th class="not-lg:hidden">{m.admin_location_header()}</th>
              <th class="not-sm:hidden">{m.admin_games_header()}</th>
              <th class="text-right">{m.admin_actions_header()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.shops as shop (shop.id)}
              <tr class="hover">
                <td>
                  <div>
                    <div class="font-medium">
                      <a
                        href="https://map.bemanicn.com/shop/{shop.id}"
                        target="_blank"
                        class="hover:text-accent line-clamp-3 transition-colors"
                      >
                        {shop.name}
                      </a>
                    </div>
                  </div>
                </td>
                <td class="not-lg:hidden">
                  <div class="max-w-xs text-sm">
                    {#if shop.location?.coordinates}
                      <span class="text-xs opacity-60">
                        Lat: {shop.location.coordinates[1].toFixed(4)}, Lng: {shop.location.coordinates[0].toFixed(
                          4
                        )}
                      </span>
                    {:else}
                      <span class="text-xs opacity-60">{m.admin_no_location_data()}</span>
                    {/if}
                  </div>
                </td>
                <td class="not-sm:hidden">
                  {#if shop.games && shop.games.length > 0}
                    <div class="mt-1 flex flex-wrap gap-1">
                      {#each shop.games.slice(0, 3) as game (game.id)}
                        <span class="badge badge-xs badge-soft">
                          {game.name || `Game ${game.id}`}
                        </span>
                      {/each}
                      {#if shop.games.length > 3}
                        <span class="badge badge-xs badge-soft">
                          +{shop.games.length - 3}
                        </span>
                      {/if}
                    </div>
                  {/if}
                </td>
                <td>
                  <div class="flex justify-end gap-2">
                    <a
                      href="{base}/discover?longitude={shop.location?.coordinates[0]}&latitude={shop
                        .location?.coordinates[1]}&name={shop.name}&radius={radius}"
                      target="_blank"
                      class="btn btn-soft btn-sm"
                      title={m.explore_nearby()}
                    >
                      <i class="fa-solid fa-map-location-dot"></i>
                      <span class="not-md:hidden">{m.explore_nearby()}</span>
                    </a>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      {#if data.hasMore}
        <div class="border-base-300 border-t p-4">
          <div class="flex justify-center gap-2">
            {#if (data.currentPage || 1) > 1}
              <a
                href="?page={(data.currentPage || 1) - 1}{data.search
                  ? `&search=${encodeURIComponent(data.search)}`
                  : ''}"
                class="btn btn-soft"
              >
                {m.previous_page()}
              </a>
            {/if}
            <span class="btn btn-disabled btn-soft">
              {m.page({ page: data.currentPage || 1 })}
            </span>
            <a
              href="?page={(data.currentPage || 1) + 1}{data.search
                ? `&search=${encodeURIComponent(data.search)}`
                : ''}"
              class="btn btn-soft"
            >
              {m.next_page()}
            </a>
          </div>
        </div>
      {/if}
    {:else}
      <div class="py-12 text-center">
        <i class="fa-solid fa-gamepad text-base-content/40 mb-4 text-4xl"></i>
        <h3 class="text-base-content mb-2 text-lg font-semibold">{m.admin_no_shops_found()}</h3>
        <p class="text-base-content/60">
          {data.search ? m.admin_no_shops_found_search() : m.admin_no_shops_found_empty()}
        </p>
        {#if !data.search}
          <a href="{base}/shops/new" class="btn btn-primary mt-4">
            <i class="fa-solid fa-plus"></i>
            {m.admin_add_shop()}
          </a>
        {/if}
      </div>
    {/if}
  </div>
</div>
