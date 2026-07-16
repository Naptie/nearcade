<script lang="ts">
  import { goto } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';
  import { getGameName, formatAddressParts } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import { onMount, onDestroy } from 'svelte';
  import type {
    RegionRankingData,
    SortCriteria,
    RegionLevel,
    RegionRankingResponse
  } from '$lib/types';
  import { PAGINATION, REGION_LEVELS, GAME_TITLES } from '$lib/constants';
  import { browser } from '$app/environment';
  import RankingsHeader from '$lib/components/rankings/RankingsHeader.svelte';

  let { data } = $props();

  let sortBy: SortCriteria = $derived(data.sortBy);
  let level: RegionLevel = $derived(data.level);
  let displayedRankings: RegionRankingData[] = $derived(data.rankings);
  let hasMore = $derived(data.hasMore);
  let nextCursor = $derived(data.nextCursor);
  let isLoading = $state(false);
  let isLoadingMore = $state(false);

  $effect(() => {
    displayedRankings = data.rankings;
    hasMore = data.hasMore;
    nextCursor = data.nextCursor;
  });

  $effect(() => {
    if (browser && (sortBy !== data.sortBy || level !== data.level)) {
      const url = new URL(window.location.href);
      url.searchParams.set('sortBy', sortBy);
      url.searchParams.set('level', level);
      url.searchParams.delete('page');
      goto(url.toString(), { invalidateAll: true });
      isLoading = true;
      return () => {
        isLoading = false;
      };
    }
  });

  const handleLoadMore = async () => {
    if (!isLoadingMore && hasMore && nextCursor) {
      isLoadingMore = true;
      try {
        const apiUrl = new URL(fromPath('/api/rankings/region'), window.location.origin);
        apiUrl.searchParams.set('sortBy', sortBy);
        apiUrl.searchParams.set('level', level);
        apiUrl.searchParams.set('after', nextCursor);
        apiUrl.searchParams.set('limit', PAGINATION.PAGE_SIZE.toString());

        const response = await fetch(apiUrl.toString());

        if (!response.ok) {
          throw new Error(`Failed to load more results: ${response.status}`);
        }

        const result = (await response.json()) as RegionRankingResponse;

        displayedRankings = [...displayedRankings, ...result.data];
        hasMore = result.hasMore;
        nextCursor = result.nextCursor;
      } catch (error) {
        console.error('Error loading more region results:', error);
      } finally {
        isLoadingMore = false;
      }
    }
  };

  const handleScroll = () => {
    if (typeof window === 'undefined') return;

    const scrollHeight = document.documentElement.scrollHeight;
    const scrollTop = window.scrollY;
    const clientHeight = window.innerHeight;

    if (scrollHeight - scrollTop - clientHeight < PAGINATION.SCROLL_THRESHOLD) {
      handleLoadMore();
    }
  };

  onMount(() => {
    if (browser) {
      window.addEventListener('scroll', handleScroll, { passive: true });
      return () => {
        window.removeEventListener('scroll', handleScroll);
      };
    }
  });

  onDestroy(() => {
    isLoading = false;
    isLoadingMore = false;
  });

  const getLevelLabel = (levelKey: RegionLevel): string => {
    const f = m[`region_level_${levelKey}`];
    return typeof f === 'function' ? f() : levelKey;
  };

  const formatNumber = (num: number): string => {
    if (num === 0) return '0';
    return num.toLocaleString();
  };

  const formatDensity = (density: number): string => {
    if (density === 0) return '0.000';
    return density.toFixed(3);
  };

  const buildParentChain = (ranking: RegionRankingData): string => {
    const parts: string[] = [];
    if (level === 'province' && ranking.country) {
      parts.push(ranking.country);
    } else if (level === 'city') {
      if (ranking.country && ranking.province && ranking.country !== ranking.province) {
        parts.push(ranking.country);
      }
      if (ranking.province) {
        parts.push(ranking.province);
      }
    } else if (level === 'county') {
      if (ranking.province) {
        parts.push(ranking.province);
      }
      if (ranking.city) {
        parts.push(ranking.city);
      }
    }
    return formatAddressParts(parts);
  };

  const getMetrics = (ranking: RegionRankingData) => {
    // All radius entries have the same data; use the first one
    return ranking.rankings[0];
  };

  const visibleGameTitles = $derived.by(() => {
    return GAME_TITLES;
  });
</script>

<div class="mx-auto pt-20 pb-8 sm:container sm:px-4">
  <RankingsHeader
    title={m.region_rankings()}
    description={m.region_rankings_description()}
    cached={data.cached}
    stale={data.stale}
    cacheTime={data.cacheTime}
    bind:sortBy
  />

  {#if data.error}
    <div class="alert alert-error mb-4">
      <i class="fa-solid fa-circle-xmark fa-lg"></i>
      <span>{data.error}</span>
    </div>
  {:else if data.calculating}
    <div class="alert alert-info mb-4">
      <span class="loading loading-spinner loading-lg"></span>
      <span>{m.rankings_being_updated()}</span>
    </div>
  {:else}
    <div class="tabs tabs-border mb-4 justify-center not-sm:mx-2">
      {#each REGION_LEVELS as option (option.key)}
        <button
          class="tab {level === option.key ? 'tab-active' : ''}"
          onclick={() => (level = option.key)}
        >
          {getLevelLabel(option.key)}
        </button>
      {/each}
    </div>

    {#if displayedRankings && displayedRankings.length > 0}
      <div class="overflow-x-auto overflow-y-hidden">
        <table class="bg-base-200/30 dark:bg-base-200/60 table w-full overflow-hidden">
          <thead>
            <tr>
              <th class="text-center">{m.ranking()}</th>
              <th class="min-w-36 text-left">{m.region()}</th>
              <th
                class="cursor-pointer text-center transition {sortBy === 'shops'
                  ? 'text-accent'
                  : 'hover:text-base-content'}"
                onclick={() => (sortBy = 'shops')}
              >
                {m.sort_by_shops()}
              </th>
              <th
                class="cursor-pointer text-center transition {sortBy === 'machines'
                  ? 'text-accent'
                  : 'hover:text-base-content'}"
                onclick={() => (sortBy = 'machines')}
              >
                {m.sort_by_machines()}
              </th>
              <th
                class="cursor-pointer text-center transition not-md:hidden {sortBy === 'density'
                  ? 'text-accent'
                  : 'hover:text-base-content'}"
                onclick={() => (sortBy = 'density')}
              >
                {m.sort_by_density()}
              </th>
              {#each visibleGameTitles as game (game.id)}
                <th
                  class="cursor-pointer text-center transition not-lg:hidden {sortBy === game.key
                    ? 'text-accent'
                    : 'hover:text-base-content'}"
                  onclick={() => (sortBy = game.key)}
                >
                  {getGameName(game.key)}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each displayedRankings as ranking, index (ranking.id)}
              {@const metrics = getMetrics(ranking)}
              {@const parentChain = buildParentChain(ranking)}
              <tr class="h-12 transition-opacity duration-200" class:opacity-50={isLoading}>
                <td class="text-center font-bold">
                  <span class="text-lg">{index + 1}</span>
                </td>
                <td class="min-w-36">
                  <div class="flex flex-col">
                    <span class="font-semibold">{ranking.name}</span>
                    {#if parentChain}
                      <span class="text-base-content/50 text-xs">
                        {parentChain}
                      </span>
                    {/if}
                  </div>
                </td>
                {#if metrics}
                  <td
                    class="text-center transition {sortBy === 'shops'
                      ? 'text-accent font-semibold'
                      : ''}"
                  >
                    {formatNumber(metrics.shopCount)}
                  </td>
                  <td
                    class="text-center transition {sortBy === 'machines'
                      ? 'text-accent font-semibold'
                      : ''}"
                  >
                    {formatNumber(metrics.totalMachines)}
                  </td>
                  <td
                    class="text-center transition not-md:hidden {sortBy === 'density'
                      ? 'text-accent font-semibold'
                      : ''}"
                  >
                    {formatDensity(metrics.areaDensity)}
                  </td>
                  {#each visibleGameTitles as game (game.id)}
                    {@const gameMetric = metrics.gameSpecificMachines.find(
                      (e) => e.name === game.key
                    )}
                    <td
                      class="text-center transition not-lg:hidden {sortBy === game.key
                        ? 'text-accent font-semibold'
                        : ''}"
                    >
                      {formatNumber(gameMetric?.quantity || 0)}
                    </td>
                  {/each}
                {:else}
                  <td class="text-center"><span class="text-base-content/40">—</span></td>
                  <td class="text-center"><span class="text-base-content/40">—</span></td>
                  <td class="text-center not-md:hidden">
                    <span class="text-base-content/40">—</span>
                  </td>
                  {#each visibleGameTitles as game (game.id)}
                    <td class="text-center not-lg:hidden">
                      <span class="text-base-content/40">—</span>
                    </td>
                  {/each}
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if hasMore}
        {#if isLoadingMore}
          <div class="mt-6 flex justify-center">
            <span class="loading loading-spinner loading-sm"></span>
          </div>
        {/if}
      {:else}
        <div class="mt-6 flex justify-center">
          <div class="text-base-content/50 text-sm">{m.all_results_loaded()}</div>
        </div>
      {/if}
    {:else}
      <div class="alert alert-info">
        <i class="fa-solid fa-circle-info fa-lg"></i>
        <span>{m.no_data()}</span>
      </div>
    {/if}
  {/if}
</div>

<style lang="postcss">
  @reference "tailwindcss";

  .table th {
    position: sticky;
    top: 0;
    z-index: 10;
  }
</style>
