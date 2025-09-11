<script lang="ts">
  import ManagedArcade from '$lib/components/ManagedArcade.svelte';
  import { m } from '$lib/paraglide/messages';
  import type { Shop } from '$lib/types';
  import { pageTitle } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state('');
  let searchResults = $state<Shop[]>([]);
  let isSearching = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | undefined = $state(undefined);
  let radius = $state(10);

  onMount(() => {
    const savedRadius = localStorage.getItem('nearcade-radius');
    if (savedRadius) {
      radius = parseInt(savedRadius);
    }
  });

  const searchArcades = async (query: string) => {
    if (!query.trim()) {
      searchResults = [];
      return;
    }

    isSearching = true;
    try {
      const response = await fetch(fromPath(`/api/shops/search?q=${encodeURIComponent(query)}`));
      if (response.ok) {
        const results = (await response.json()) as { shops: Shop[] };
        searchResults = results.shops || [];
      } else {
        searchResults = [];
      }
    } catch (error) {
      console.error('Error searching arcades:', error);
      searchResults = [];
    } finally {
      isSearching = false;
    }
  };

  const handleSearchInput = () => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    searchTimeout = setTimeout(() => {
      searchArcades(searchQuery);
    }, 300);
  };

  const clearSearch = () => {
    searchQuery = '';
    searchResults = [];
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
  };
</script>

<svelte:head>
  <title>{pageTitle(m.starred_arcades())}</title>
</svelte:head>

<div class="mx-auto px-4 py-8 sm:container">
  <div class="mb-6">
    <h1 class="mb-2 text-3xl font-bold">{m.starred_arcades()}</h1>
    <p class="text-base-content/70">
      {m.manage_starred_arcades()}
    </p>
  </div>

  <!-- Add Arcade Section -->
  <div class="bg-base-200 mb-6 rounded-lg p-6">
    <h2 class="mb-4 text-xl font-semibold">{m.add_arcade()}</h2>

    <div class="mb-4 flex gap-2">
      <div class="flex-1">
        <input
          type="text"
          placeholder={m.search_arcades_placeholder()}
          class="input input-bordered w-full"
          bind:value={searchQuery}
          oninput={handleSearchInput}
        />
      </div>
      <button
        class="btn btn-ghost"
        onclick={clearSearch}
        disabled={!searchQuery}
        aria-label={m.clear_search()}
      >
        <i class="fa-solid fa-times"></i>
      </button>
    </div>

    {#if isSearching}
      <div class="flex items-center justify-center py-8">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
    {:else if searchResults.length > 0}
      <div class="max-h-96 space-y-2 overflow-y-auto">
        {#each searchResults as shop (shop._id)}
          <ManagedArcade {shop} shops={data.starredArcades} {radius} />
        {/each}
      </div>
    {:else if searchQuery && !isSearching}
      <div class="text-base-content/60 py-8 text-center">
        <i class="fa-solid fa-search mb-2 text-2xl"></i>
        <p>{m.no_arcades_found()}</p>
      </div>
    {/if}
  </div>

  <!-- Current Starred Arcades -->
  <div class="bg-base-200 rounded-lg p-6">
    <h2 class="mb-4 text-xl font-semibold">{m.my_starred_arcades()}</h2>

    {#if data.starredArcades && data.starredArcades.length > 0}
      <div class="grid gap-4">
        {#each data.starredArcades as shop (shop._id)}
          <ManagedArcade {shop} {radius} />
        {/each}
      </div>
    {:else}
      <div class="text-base-content/60 py-12 text-center">
        <i class="fa-solid fa-star mb-4 text-4xl"></i>
        <p>{m.no_starred_arcades()}</p>
        <p class="mt-2 text-sm">{m.add_arcade_to_get_started()}</p>
      </div>
    {/if}
  </div>
</div>
