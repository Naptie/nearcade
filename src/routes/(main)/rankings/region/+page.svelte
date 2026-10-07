<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { getGameName, formatAddressParts } from '$lib/utils';
  import InlineAlert from '$lib/components/InlineAlert.svelte';
  import { fromPath } from '$lib/utils/scoped';
  import { onMount, onDestroy } from 'svelte';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import type {
    RegionRankingData,
    SortCriteria,
    RegionLevel,
    RegionRankingResponse
  } from '$lib/types';
  import { PAGINATION, REGION_LEVELS, GAME_TITLES } from '$lib/constants';
  import { competitionRanks } from '$lib/utils/rankings';
  import { emptyShopFilterState } from '$lib/schemas/shop-filter';
  import { serializeShopFilterState } from '$lib/utils/shops/filter';
  import { regionNameForLocale } from '$lib/regions/labels';
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
        apiUrl.searchParams.set('limit', PAGINATION.RANKING_PAGE_SIZE.toString());

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

  const getLocalName = (entry: { id: string; name: Record<string, string> }): string =>
    regionNameForLocale(entry.name, getLocale()) || entry.id;

  const getLevelLabel = (levelKey: RegionLevel): string => {
    // The county tab covers both counties and towns (streets).
    if (levelKey === 'county') {
      return `${m.region_level_county()} · ${m.region_level_street()}`;
    }
    const f = m[`region_level_${levelKey}`];
    return typeof f === 'function' ? f() : levelKey;
  };

  const formatNumber = (num: number): string => {
    if (num === 0) return '0';
    return num.toLocaleString();
  };

  const formatDensity = (density: number | null): string => {
    if (density == null) return '—';
    if (density === 0) return '0.000';
    return density.toFixed(3);
  };

  const getRegionZoom = (level: RegionLevel): number => {
    switch (level) {
      case 'country':
        return 6;
      case 'province':
        return 8;
      case 'city':
        return 10;
      case 'county':
        return 12;
      default:
        return 8;
    }
  };

  const getGlobeUrl = (ranking: RegionRankingData): string => {
    const coords = ranking.location.coordinates;
    const zoom = getRegionZoom(ranking.level);
    const leafId = ranking.regionChain?.[ranking.regionChain.length - 1]?.id;
    const params = new SvelteURLSearchParams({
      lat: coords[1].toFixed(6),
      lng: coords[0].toFixed(6),
      zoom: zoom.toString()
    });
    // The globe selects the region through the same filter everything else
    // uses; carrying only the ID keeps the link locale-independent — the globe
    // resolves the names itself, in the reader's language.
    if (leafId) {
      params.set('f', serializeShopFilterState({ ...emptyShopFilterState(), regions: [leafId] }));
    }
    return resolve('/(globe)/globe') + '?' + params.toString();
  };

  const buildParentChain = (ranking: RegionRankingData): string => {
    if (!ranking.regionChain || ranking.regionChain.length <= 1) return '';
    const ancestors = ranking.regionChain.slice(0, -1);
    return formatAddressParts(
      ancestors.map((e) => getLocalName(e)),
      getLocale()
    );
  };

  const visibleGameTitles = $derived.by(() => {
    return GAME_TITLES;
  });

  const regionMetricOf = (ranking: RegionRankingData): number | null => {
    switch (sortBy) {
      case 'shops':
        return ranking.shopCount;
      case 'machines':
        return ranking.totalMachines;
      case 'density':
        return ranking.areaDensity;
      case 'per_capita':
        return ranking.machinesPerCapita;
      default:
        return ranking.gameSpecificMachines.find((entry) => entry.name === sortBy)?.quantity ?? 0;
    }
  };

  // Sub-board display rank within the current level tab: rows arrive in the
  // tab's metric order, so the tied rank is computable from the accumulated
  // prefix (strictly better rows always precede tied ones).
  const displayRanks = $derived(competitionRanks(displayedRankings.map(regionMetricOf)));
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
    <InlineAlert type="error" icon="fa-circle-xmark" class="mb-4">{data.error}</InlineAlert>
  {:else if data.calculating}
    <InlineAlert type="info" icon="fa-spinner fa-spin" class="mb-4"
      >{m.rankings_being_updated()}</InlineAlert
    >
  {:else}
    <div class="tabs tabs-border mb-4 justify-center not-sm:mx-2">
      {#each REGION_LEVELS as option (option.key)}
        <button
          class="tab transition-colors {level === option.key ? 'tab-active' : ''}"
          onclick={() => (level = option.key)}
        >
          {getLevelLabel(option.key)}
        </button>
      {/each}
    </div>

    {#if displayedRankings && displayedRankings.length > 0}
      <div class="overflow-x-auto overflow-y-hidden rounded-2xl">
        <!-- overflow-hidden on the table would become the scroll container the
             sticky cells resolve against; the wrapper already clips corners. -->
        <table class="bg-base-200/30 dark:bg-base-200/60 table w-full">
          <thead>
            <tr>
              <th class="sticky-col left-0 min-w-20 text-center whitespace-normal">{m.ranking()}</th
              >
              <th class="sticky-col border-base-content/10 left-20 min-w-36 border-r text-left"
                >{m.region()}</th
              >
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
              <th
                class="cursor-pointer text-center transition not-md:hidden {sortBy === 'per_capita'
                  ? 'text-accent'
                  : 'hover:text-base-content'}"
                onclick={() => (sortBy = 'per_capita')}
              >
                {m.sort_by_per_capita()}
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
              {@const localizedName = ranking.regionChain?.length
                ? getLocalName(ranking.regionChain[ranking.regionChain.length - 1])
                : ranking.name}
              {@const parentChain = buildParentChain(ranking)}
              <tr class="h-12 transition-opacity duration-200" class:opacity-50={isLoading}>
                <td class="sticky-col left-0 min-w-20 text-center font-bold">
                  <span class="text-lg tabular-nums">{displayRanks[index] ?? index + 1}</span>
                </td>
                <td class="sticky-col border-base-content/10 left-20 min-w-39 border-r">
                  <a
                    href={getGlobeUrl(ranking)}
                    target="_blank"
                    class="hover:text-accent flex flex-col transition-colors"
                  >
                    <span class="font-semibold">{localizedName}</span>
                    {#if parentChain}
                      <span class="text-base-content/50 text-xs">
                        {parentChain}
                      </span>
                    {/if}
                  </a>
                </td>
                <td
                  class="text-center transition {sortBy === 'shops'
                    ? 'text-accent font-semibold'
                    : ''}"
                >
                  {formatNumber(ranking.shopCount)}
                </td>
                <td
                  class="text-center transition {sortBy === 'machines'
                    ? 'text-accent font-semibold'
                    : ''}"
                >
                  {formatNumber(ranking.totalMachines)}
                </td>
                <td
                  class="text-center transition not-md:hidden {sortBy === 'density'
                    ? 'text-accent font-semibold'
                    : ''}"
                >
                  <span class={ranking.areaDensity == null ? 'text-base-content/40' : ''}>
                    {formatDensity(ranking.areaDensity)}
                  </span>
                </td>
                <td
                  class="text-center transition not-md:hidden {sortBy === 'per_capita'
                    ? 'text-accent font-semibold'
                    : ''}"
                >
                  {#if ranking.machinesPerCapita != null}
                    {formatDensity(ranking.machinesPerCapita)}
                  {:else}
                    <span class="text-base-content/40">—</span>
                  {/if}
                </td>
                {#each visibleGameTitles as game (game.id)}
                  {@const gameMetric = ranking.gameSpecificMachines.find(
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
      <InlineAlert type="info" icon="fa-circle-info">{m.no_data()}</InlineAlert>
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

  /* Pinned rank/region cells must be opaque or scrolled columns would show
     through; stacking the table's translucent tint over base-100 (the page
     background) reproduces the table background exactly. Header cells pin
     above the sticky header, body cells above unpinned positioned content. */
  .table .sticky-col {
    position: sticky;
    z-index: 20;
    background-color: var(--color-base-100);
    background-image: linear-gradient(
      color-mix(in oklab, var(--color-base-200) 30%, transparent),
      color-mix(in oklab, var(--color-base-200) 30%, transparent)
    );
  }

  .table td.sticky-col {
    z-index: 1;
  }

  :global([data-theme='forest']) .table .sticky-col {
    background-image: linear-gradient(
      color-mix(in oklab, var(--color-base-200) 60%, transparent),
      color-mix(in oklab, var(--color-base-200) 60%, transparent)
    );
  }
</style>
