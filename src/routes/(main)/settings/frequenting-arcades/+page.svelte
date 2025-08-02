<script lang="ts">
  import ManagedArcade from '$lib/components/ManagedArcade.svelte';
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import type { Shop } from '$lib/types';
  import type { PageData } from './$types';
  import { toPath } from '$lib/utils';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state('');
  let searchResults = $state<Shop[]>([]);
  let isSearching = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | undefined = $state(undefined);

  const autoDiscoveryOptions = Array.from({ length: 10 }, (_, i) => ({
    value: i + 1,
    label: m.clicks({ count: i + 1 })
  }));

  async function searchArcades(query: string) {
    if (!query.trim()) {
      searchResults = [];
      return;
    }

    isSearching = true;
    try {
      const response = await fetch(toPath(`/api/shops/search?q=${encodeURIComponent(query)}`));
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
  }

  function handleSearchInput() {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    searchTimeout = setTimeout(() => {
      searchArcades(searchQuery);
    }, 300);
  }

  function clearSearch() {
    searchQuery = '';
    searchResults = [];
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
  }
</script>

<svelte:head>
  <title>{m.frequenting_arcades()} - {m.app_name()}</title>
</svelte:head>

<div class="container mx-auto px-4 py-8">
  <div class="mb-6">
    <h1 class="mb-2 text-3xl font-bold">{m.frequenting_arcades()}</h1>
    <p class="text-base-content/70">
      {m.manage_frequenting_arcades()}
    </p>
  </div>

  <!-- Auto-Discovery Settings -->
  <div class="bg-base-200 mb-6 rounded-lg p-6">
    <h2 class="mb-4 text-xl font-semibold">{m.auto_discovery_settings()}</h2>

    <form method="POST" action="?/updateSettings" use:enhance>
      <label class="label whitespace-normal" for="autoDiscoveryThreshold">
        <span class="label-text">{m.auto_discovery_threshold()}</span>
      </label>
      <div class="flex w-full gap-4">
        <select
          name="autoDiscoveryThreshold"
          id="autoDiscoveryThreshold"
          class="select select-bordered w-full"
          value={data.autoDiscoveryThreshold}
        >
          {#each autoDiscoveryOptions as option, index (index)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        <button type="submit" class="btn btn-soft btn-primary">
          {m.save()}
        </button>
      </div>
      <label class="label whitespace-normal" for="autoDiscoveryThreshold">
        <span class="label-text-alt">{m.auto_discovery_threshold_description()}</span>
      </label>
    </form>
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
        {#each searchResults as shop (shop.id)}
          <ManagedArcade {shop} shops={data.frequentingArcades} />
        {/each}
      </div>
    {:else if searchQuery && !isSearching}
      <div class="text-base-content/60 py-8 text-center">
        <i class="fa-solid fa-search mb-2 text-2xl"></i>
        <p>{m.no_arcades_found()}</p>
      </div>
    {/if}
  </div>

  <!-- Current Frequenting Arcades -->
  <div class="bg-base-200 rounded-lg p-6">
    <h2 class="mb-4 text-xl font-semibold">{m.my_frequenting_arcades()}</h2>

    {#if data.frequentingArcades && data.frequentingArcades.length > 0}
      <div class="grid gap-4">
        {#each data.frequentingArcades as shop (shop.id)}
          <ManagedArcade {shop} />
        {/each}
      </div>
    {:else}
      <div class="text-base-content/60 py-12 text-center">
        <i class="fa-solid fa-clock mb-4 text-4xl"></i>
        <p>{m.no_frequenting_arcades()}</p>
        <p class="mt-2 text-sm">{m.add_arcade_to_get_started()}</p>
      </div>
    {/if}
  </div>
</div>
