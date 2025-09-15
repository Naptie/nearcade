<script lang="ts">
  import { goto } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';
  import {
    formatDistance,
    formatRegionLabel,
    parseRelativeTime,
    pageTitle,
    getGameName,
    adaptiveNewTab
  } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import { onMount, onDestroy, tick } from 'svelte';
  import type {
    UniversityRankingData,
    SortCriteria,
    RadiusFilter,
    UniversityRankingResponse
  } from '$lib/types';
  import { GAMES, RADIUS_OPTIONS, PAGINATION, SORT_CRITERIA } from '$lib/constants';
  import { getLocale } from '$lib/paraglide/runtime';
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';

  let { data } = $props();

  let sortBy: SortCriteria = $state(data.sortBy);
  let radiusFilter: RadiusFilter = $state(data.radius);
  let displayedRankings: UniversityRankingData[] = $state(data.rankings);
  let hasMore = $state(data.hasMore);
  let nextCursor = $state(data.nextCursor);
  let isLoading = $state(false);
  let isLoadingMore = $state(false);
  let hoveredRowId: number | null = $state(null);
  let showHoverDetails: number | null = $state(null);
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;
  let screenWidth = $state(0);
  let schoolHoverDetailsHeights: { [key: number]: number } = $state({});

  // Define responsive radius visibility
  const visibleRadiusOptions = $derived.by(() => {
    if (screenWidth < 640) return [RADIUS_OPTIONS[1]];
    if (screenWidth < 768) return RADIUS_OPTIONS.slice(1, 3);
    if (screenWidth < 1024) return RADIUS_OPTIONS.slice(0, 3);
    return RADIUS_OPTIONS;
  });

  const divider = ' · ';

  // Ensure radiusFilter is always visible
  $effect(() => {
    if (screenWidth > 0 && !visibleRadiusOptions.includes(radiusFilter)) {
      // If current radius is not visible, use the largest visible radius
      radiusFilter = visibleRadiusOptions[visibleRadiusOptions.length - 1];
    }
  });

  const handleResize = () => {
    screenWidth = window.innerWidth;
  };

  // Reset displayed rankings when data changes (due to sort/radius change)
  $effect(() => {
    displayedRankings = data.rankings;
    hasMore = data.hasMore;
    nextCursor = data.nextCursor;
  });

  // Update URL when sort criteria or radius changes (without page parameter)
  $effect(() => {
    if (browser && (sortBy !== data.sortBy || radiusFilter !== data.radius)) {
      const url = new URL(window.location.href);
      url.searchParams.set('sortBy', sortBy);
      url.searchParams.set('radius', radiusFilter.toString());
      url.searchParams.delete('page'); // Remove page parameter for infinite scroll
      goto(url.toString(), { invalidateAll: true });
      isLoading = true; // Show loading state when changing sort/radius
      return () => {
        isLoading = false; // Reset loading state when component is destroyed
      };
    }
  });
  const handleLoadMore = async () => {
    if (!isLoadingMore && hasMore && nextCursor) {
      isLoadingMore = true;
      try {
        // Fetch next page via API using cursor-based pagination
        const apiUrl = new URL(fromPath('/api/rankings'), window.location.origin);
        apiUrl.searchParams.set('sortBy', sortBy);
        apiUrl.searchParams.set('radius', radiusFilter.toString());
        apiUrl.searchParams.set('after', nextCursor);
        apiUrl.searchParams.set('limit', PAGINATION.PAGE_SIZE.toString());

        const response = await fetch(apiUrl.toString());

        if (!response.ok) {
          throw new Error(`Failed to load more results: ${response.status}`);
        }

        const result = (await response.json()) as UniversityRankingResponse;

        // Append new results to existing ones
        displayedRankings = [...displayedRankings, ...result.data];
        hasMore = result.hasMore;
        nextCursor = result.nextCursor;
      } catch (error) {
        console.error('Error loading more results:', error);
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
      screenWidth = window.innerWidth;
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('scroll', handleScroll);
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

    const schoolHoverDetails = document.getElementById(`school-hover-details-${index}`);
    if (schoolHoverDetails) {
      const height = schoolHoverDetails.scrollHeight;
      schoolHoverDetailsHeights[index] = height;
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
    // Keep details visible for fade-out animation
    hoverTimeout = setTimeout(() => {
      showHoverDetails = null;
    }, 200); // Match CSS transition duration
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

  const formatDensity = (density: number): string => {
    if (density === 0) return '0.000';
    return density.toFixed(3);
  };
  const getMetricsForRadius = (ranking: UniversityRankingData, radius: number) => {
    return ranking.rankings.find((r) => r.radius === radius);
  };

  const getSortLabel = (sortKey: string): string => {
    const criteria = SORT_CRITERIA.find((s) => s.key === sortKey);
    // @ts-expect-error custom index
    const f = m[`sort_by_${criteria.key}`];
    // @ts-expect-error custom index
    return typeof f === 'function' ? f() : m.sort_by_game_machines({ game: m[criteria.key]() });
  };
</script>

<svelte:head>
  <title>{pageTitle(m.campus_rankings())}</title>
</svelte:head>

<div class="mx-auto pt-20 pb-8 sm:container sm:px-4">
  <div class="xs:flex-row mb-6 flex flex-col items-center justify-between gap-4 not-sm:px-2">
    <div class="grow">
      <div class="not-xs:justify-center mb-2 flex items-center gap-4">
        <h1 class="text-3xl font-bold">{m.campus_rankings()}</h1>
        <div class="hidden items-center gap-2 whitespace-nowrap sm:flex">
          {#if data.stale}
            <div class="badge badge-warning badge-sm">
              <i class="fas fa-clock"></i>
              {m.updated_at({ time: parseRelativeTime(data.cacheTime, getLocale()) })}
            </div>
          {:else if data.cached}
            <div class="badge badge-success badge-sm">
              <i class="fas fa-check"></i>
              {m.updated_at({ time: parseRelativeTime(data.cacheTime, getLocale()) })}
            </div>
          {/if}
        </div>
      </div>
      <p class="text-base-content/70">
        {m.campus_rankings_description()}
      </p>
    </div>
    <div class="flex flex-col gap-1">
      <label class="label not-md:mx-auto" for="sort-select">
        <span class="label-text">{m.sort_by()}</span>
      </label>
      <select id="sort-select" class="select select-bordered w-full pe-8" bind:value={sortBy}>
        {#each SORT_CRITERIA as criteria (criteria.key)}
          <option value={criteria.key}>{getSortLabel(criteria.key)}</option>
        {/each}
      </select>
    </div>
  </div>

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
    <!-- Results Table -->
    {#if displayedRankings && displayedRankings.length > 0}
      <div class="overflow-x-auto overflow-y-hidden">
        <table class="bg-base-200/30 dark:bg-base-200/60 table w-full overflow-hidden">
          <thead>
            <tr>
              <th class="text-center">{m.ranking()}</th>
              <th class="text-left">{m.university()}</th>
              {#each visibleRadiusOptions as option (option)}
                <th
                  class="cursor-pointer text-center transition {radiusFilter == option
                    ? 'text-accent'
                    : 'hover:text-base-content'}"
                  onclick={() => (radiusFilter = option)}>&lt; {formatDistance(option)}</th
                >
              {/each}
              <th class="text-center">{m.actions()}</th>
            </tr>
          </thead>
          <tbody>
            {#each displayedRankings as ranking, index (index)}
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
                    <div>
                      <a
                        href={resolve('/(main)/universities/[id]', {
                          id: ranking.id.split('_')[0]
                        })}
                        target={adaptiveNewTab()}
                        class="text-base-content link-accent pr-1 font-semibold transition-colors"
                        >{ranking.universityName}</a
                      >
                      <span class="font-light text-current/70">{ranking.campusName}</span>
                    </div>
                    <div class="flex flex-wrap items-center space-x-1.5">
                      <div class="text-xs opacity-70 not-xl:hidden sm:text-sm">
                        {formatRegionLabel(ranking, true, divider)}
                      </div>
                      <div class="text-xs opacity-70 sm:text-sm xl:hidden">
                        {formatRegionLabel(ranking, false, divider)}
                      </div>
                      {#if ranking.is985}
                        <div class="badge badge-soft badge-primary badge-xs text-nowrap">
                          {m.badge_985()}
                        </div>
                      {/if}
                      {#if ranking.is211}
                        <div class="badge badge-soft badge-secondary badge-xs text-nowrap">
                          {m.badge_211()}
                        </div>
                      {/if}
                      {#if ranking.isDoubleFirstClass}
                        <div class="badge badge-soft badge-accent badge-xs text-nowrap">
                          {m.badge_double_first_class()}
                        </div>
                      {/if}
                    </div>
                    <div
                      class="transition-all duration-200 {hoveredRowId === index
                        ? 'opacity-100'
                        : 'opacity-0'}"
                      style="height: {hoveredRowId === index && schoolHoverDetailsHeights[index]
                        ? `${schoolHoverDetailsHeights[index]}px`
                        : '0px'}"
                    >
                      <div class="flex flex-wrap text-xs opacity-70 sm:text-sm">
                        <div id="school-hover-details-{index}">{ranking.type}</div>
                        <div class="whitespace-pre">{divider}</div>
                        <div class="tooltip tooltip-bottom" data-tip={m.governing_body()}>
                          {ranking.affiliation}
                        </div>
                      </div>
                    </div>
                  </div>
                </td>

                {#each visibleRadiusOptions as option (option)}
                  {@const metrics = getMetricsForRadius(ranking, option)}
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
                                    metrics.gameSpecificMachines.find((e) => e.name == sortBy)!
                                      .quantity || 0
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
                            <div>
                              {m.machines({ count: formatNumber(metrics.totalMachines) })}
                            </div>
                            <div>
                              {m.count_machines_per_km2({
                                count: formatDensity(metrics.areaDensity)
                              })}
                            </div>
                            {#if metrics.gameSpecificMachines.some((game) => game.quantity > 0)}
                              <div class="divider my-0.5"></div>
                              {#each GAMES as game (game.id)}
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

                <td
                  class="text-center transition-opacity duration-200"
                  class:opacity-50={isLoading}
                >
                  <div class="flex justify-center">
                    <a
                      class="btn btn-ghost btn-sm"
                      href="{resolve('/(main)/discover')}?latitude={ranking.location
                        .coordinates[1]}&longitude={ranking.location
                        .coordinates[0]}&radius={radiusFilter}&name={encodeURIComponent(
                        ranking.fullName
                      )}"
                      target={adaptiveNewTab()}
                    >
                      <i class="fas fa-map-marker-alt"></i>
                      <span class="not-md:hidden">{m.view_location()}</span>
                    </a>
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
      {:else if displayedRankings.length > 0}
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
