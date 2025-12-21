<script lang="ts">
  import ManagedArcade from '$lib/components/ManagedArcade.svelte';
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import type { Shop } from '$lib/types';
  import type { PageData } from './$types';
  import { pageTitle } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import { onMount } from 'svelte';

  let { data }: { data: PageData } = $props();

  let isSubmitting = $state(false);
  let showSuccess = $state(false);
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

  const autoDiscoveryOptions = Array.from({ length: 10 }, (_, i) => ({
    value: i + 1,
    label: m.times({ count: i + 1 })
  }));

  const searchArcades = async (query: string) => {
    if (!query.trim()) {
      searchResults = [];
      return;
    }

    isSearching = true;
    try {
      const response = await fetch(
        fromPath(`/api/shops?q=${encodeURIComponent(query)}&includeTimeInfo=false`)
      );
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
  <title>{pageTitle(m.frequenting_arcades())}</title>
</svelte:head>

<div class="space-y-6 md:space-y-10 md:p-5">
  <div>
    <h1 class="text-2xl font-bold md:text-3xl">{m.frequenting_arcades()}</h1>
    <p class="text-base-content/70 mt-1">
      {m.manage_frequenting_arcades()}
    </p>
  </div>

  <!-- Auto-Discovery Settings -->
  <div class="bg-base-200 mb-6 rounded-lg">
    <form
      method="POST"
      action="?/updateSettings"
      use:enhance={() => {
        isSubmitting = true;
        return async ({ result }) => {
          isSubmitting = false;
          if (result.type === 'success') {
            showSuccess = true;
            setTimeout(() => {
              showSuccess = false;
            }, 2000);
          }
        };
      }}
    >
      <div class="mb-4 flex items-center justify-between gap-2">
        <h2 class="text-xl font-semibold">{m.auto_discovery_settings()}</h2>
        <button
          type="submit"
          class="btn btn-soft btn-primary"
          class:btn-active={showSuccess}
          disabled={isSubmitting}
        >
          {#if isSubmitting}
            <span class="loading loading-spinner loading-sm"></span>
          {:else if showSuccess}
            <i class="fa-solid fa-check"></i>
          {:else}
            <i class="fa-solid fa-save"></i>
          {/if}
          {showSuccess ? m.success() : m.save()}
        </button>
      </div>
      <div class="mb-3">
        <label class="label whitespace-normal" for="discoveryInteractionThreshold">
          <span class="label-text">{m.discovery_interaction_threshold()}</span>
        </label>
        <div class="flex w-full gap-4">
          <select
            name="discoveryInteractionThreshold"
            id="discoveryInteractionThreshold"
            class="select select-bordered w-full"
            value={data.autoDiscovery?.discoveryInteractionThreshold ?? 5}
          >
            {#each autoDiscoveryOptions as option, index (index)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <label class="label whitespace-normal" for="discoveryInteractionThreshold">
          <span class="label-text-alt">{m.discovery_interaction_threshold_description()}</span>
        </label>
      </div>
      <div>
        <label class="label whitespace-normal" for="attendanceThreshold">
          <span class="label-text">{m.attendance_threshold()}</span>
        </label>
        <div class="flex w-full gap-4">
          <select
            name="attendanceThreshold"
            id="attendanceThreshold"
            class="select select-bordered w-full"
            value={data.autoDiscovery?.attendanceThreshold ?? 2}
          >
            {#each autoDiscoveryOptions as option, index (index)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <label class="label whitespace-normal" for="attendanceThreshold">
          <span class="label-text-alt">{m.attendance_threshold_description()}</span>
        </label>
      </div>
    </form>
  </div>

  <!-- Add Arcade Section -->
  <div class="bg-base-200 mb-6 rounded-lg">
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
          <ManagedArcade {shop} shops={data.frequentingArcades} {radius} />
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
  <div class="bg-base-200 rounded-lg">
    <h2 class="mb-4 text-xl font-semibold">{m.my_frequenting_arcades()}</h2>

    {#if data.frequentingArcades && data.frequentingArcades.length > 0}
      <div class="grid gap-4">
        {#each data.frequentingArcades as shop (shop._id)}
          <ManagedArcade {shop} {radius} />
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
