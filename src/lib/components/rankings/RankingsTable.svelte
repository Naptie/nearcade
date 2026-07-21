<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { m } from '$lib/paraglide/messages';
  import { formatDistance, getGameName } from '$lib/utils';
  import { GAME_TITLES, RANKING_RADIUS_OPTIONS } from '$lib/constants';
  import type {
    RankingMetrics,
    SortCriteria,
    RankingRadiusFilter,
    RankingsTableItem
  } from '$lib/types';
  import type { Snippet } from 'svelte';

  interface Props {
    rankings: RankingsTableItem[];
    sortBy: SortCriteria;
    radiusFilter: RankingRadiusFilter;
    isLoading: boolean;
    isLoadingMore: boolean;
    hasMore: boolean;
    getMetrics: (ranking: RankingsTableItem, radius: number) => RankingMetrics | undefined;
    nameColumn: Snippet<[RankingsTableItem, number]>;
    nameHoverDetails: Snippet<[RankingsTableItem, number]>;
    actionColumn: Snippet<[RankingsTableItem]>;
    nameHeader: string;
    allLoadedMessage?: string;
  }

  let {
    rankings,
    sortBy,
    radiusFilter = $bindable(),
    isLoading,
    isLoadingMore,
    hasMore,
    getMetrics,
    nameColumn,
    nameHoverDetails,
    actionColumn,
    nameHeader,
    allLoadedMessage = m.all_results_loaded()
  }: Props = $props();

  let hoveredRowId = $state<number | null>(null);
  let showHoverDetails = $state<number | null>(null);
  let hoverTimeout = $state<ReturnType<typeof setTimeout> | null>(null);
  let hoverDetailsHeights = $state<{ [key: number]: number }>({});
  let screenWidth = $state(0);

  const visibleRadiusOptions = $derived.by(() => {
    if (screenWidth < 640) return [RANKING_RADIUS_OPTIONS[1]];
    if (screenWidth < 768) return RANKING_RADIUS_OPTIONS.slice(1, 3);
    if (screenWidth < 1024) return RANKING_RADIUS_OPTIONS.slice(0, 3);
    return RANKING_RADIUS_OPTIONS;
  });

  $effect(() => {
    if (screenWidth > 0 && !visibleRadiusOptions.includes(radiusFilter)) {
      radiusFilter = visibleRadiusOptions[visibleRadiusOptions.length - 1];
    }
  });

  const handleResize = () => {
    screenWidth = window.innerWidth;
  };

  onMount(() => {
    if (typeof window !== 'undefined') {
      screenWidth = window.innerWidth;
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
  });

  const handleMouseEnter = async (index: number) => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
    showHoverDetails = index;
    await tick();

    const hoverDetails = document.getElementById(`ranking-hover-details-${index}`);
    if (hoverDetails) {
      const height = hoverDetails.scrollHeight;
      hoverDetailsHeights[index] = height;
    }

    hoverTimeout = setTimeout(() => {
      hoveredRowId = index;
    }, 10);
  };

  const handleMouseLeave = () => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
    hoveredRowId = null;
    hoverTimeout = setTimeout(() => {
      showHoverDetails = null;
    }, 200);
  };

  onDestroy(() => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
    }
  });

  const formatNumber = (num: number): string => {
    if (num === 0) return '0';
    return num.toLocaleString();
  };

  const formatDensity = (density: number | null): string => {
    if (density == null) return '—';
    if (density === 0) return '0.000';
    return density.toFixed(3);
  };
</script>

{#if rankings && rankings.length > 0}
  <div class="overflow-x-auto overflow-y-hidden">
    <table class="bg-base-200/30 dark:bg-base-200/60 table w-full overflow-hidden">
      <thead>
        <tr>
          <th class="text-center">{m.ranking()}</th>
          <th class="text-left">{nameHeader}</th>
          {#each visibleRadiusOptions as option (option)}
            <th
              class="cursor-pointer text-center transition {radiusFilter == option
                ? 'text-accent'
                : 'hover:text-base-content'}"
              onclick={() => (radiusFilter = option)}
            >
              &lt; {formatDistance(option)}
            </th>
          {/each}
          <th class="text-center">{m.actions()}</th>
        </tr>
      </thead>
      <tbody>
        {#each rankings as ranking, index (index)}
          <tr
            class="overflow-y-hidden transition-all duration-200 {hoveredRowId === index
              ? 'bg-base-300/30 h-52'
              : 'h-16'}"
            class:skeleton={isLoading}
            onmouseenter={() => handleMouseEnter(index)}
            onmouseleave={handleMouseLeave}
          >
            <td
              class="text-center font-bold transition-opacity duration-200"
              class:opacity-50={isLoading}
            >
              <div class="flex items-center justify-center">
                <span class="text-lg">{index + 1}</span>
              </div>
            </td>
            <td class="transition-opacity duration-200" class:opacity-50={isLoading}>
              <div class="flex flex-col gap-1">
                {@render nameColumn(ranking, index)}
                <div
                  class="transition-all duration-200 {hoveredRowId === index
                    ? 'opacity-100'
                    : 'opacity-0'}"
                  style="height: {hoveredRowId === index && hoverDetailsHeights[index]
                    ? `${hoverDetailsHeights[index]}px`
                    : '0px'}"
                >
                  <div id="ranking-hover-details-{index}">
                    {@render nameHoverDetails(ranking, index)}
                  </div>
                </div>
              </div>
            </td>

            {#each visibleRadiusOptions as option (option)}
              {@const metrics = getMetrics(ranking, option)}
              <td
                class="xs:w-28 relative w-20 text-center transition-opacity duration-200 sm:w-24 md:w-32 lg:w-44 xl:w-48 2xl:w-52"
                class:opacity-50={isLoading}
              >
                {#if metrics}
                  <div
                    class="flex flex-col items-center transition-opacity duration-200 {hoveredRowId ===
                    index
                      ? 'opacity-0'
                      : 'opacity-100'}"
                  >
                    <div class="text-sm font-semibold">
                      {sortBy === 'shops'
                        ? formatNumber(metrics.shopCount)
                        : sortBy === 'machines'
                          ? formatNumber(metrics.totalMachines)
                          : sortBy === 'density'
                            ? formatDensity(metrics.areaDensity)
                            : formatNumber(
                                metrics.gameSpecificMachines.find((e) => e.name == sortBy)
                                  ?.quantity || 0
                              )}
                    </div>
                    <div class="text-xs opacity-50">
                      {formatNumber(metrics.shopCount)} / {formatNumber(metrics.totalMachines)}
                    </div>
                  </div>

                  {#if showHoverDetails === index}
                    <div
                      class="absolute inset-0 flex flex-col items-center justify-center overflow-hidden px-2 text-xs transition-opacity duration-200 lg:px-4 {hoveredRowId ===
                      index
                        ? 'opacity-100'
                        : 'opacity-0'}"
                    >
                      <div class="grid w-full grid-cols-1 gap-0.5 text-center">
                        <div>{m.shops({ count: formatNumber(metrics.shopCount) })}</div>
                        <div>{m.machines({ count: formatNumber(metrics.totalMachines) })}</div>
                        <div>
                          {m.count_machines_per_km2({
                            count: formatDensity(metrics.areaDensity)
                          })}
                        </div>
                        {#if metrics.gameSpecificMachines.some((game) => game.quantity > 0)}
                          <div class="divider my-0.5"></div>
                          {#each GAME_TITLES as game (game.id)}
                            {@const gameMetrics = metrics.gameSpecificMachines.find(
                              (e) => e.name == game.key
                            )}
                            {#if gameMetrics && gameMetrics.quantity > 0}
                              <div class="flex justify-between gap-1">
                                <span class="truncate">{getGameName(game.key)}</span>
                                <span>{formatNumber(gameMetrics.quantity)}</span>
                              </div>
                            {/if}
                          {/each}
                        {/if}
                      </div>
                    </div>
                  {/if}
                {:else}
                  <span class="text-base-content/40">—</span>
                {/if}
              </td>
            {/each}

            <td class="text-center transition-opacity duration-200" class:opacity-50={isLoading}>
              <div class="flex justify-center">
                {@render actionColumn(ranking)}
              </div>
            </td>
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
  {:else if rankings.length > 0}
    <div class="mt-6 flex justify-center">
      <div class="text-base-content/50 text-sm">{allLoadedMessage}</div>
    </div>
  {/if}
{:else}
  <div class="alert alert-info">
    <i class="fa-solid fa-circle-info fa-lg"></i>
    <span>{m.no_data()}</span>
  </div>
{/if}

<style lang="postcss">
  @reference "tailwindcss";

  .table th {
    position: sticky;
    top: 0;
    z-index: 10;
  }
</style>
