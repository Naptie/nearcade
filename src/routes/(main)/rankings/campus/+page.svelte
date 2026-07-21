<script lang="ts">
  import { goto } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';
  import { formatRegionLabel, adaptiveNewTab } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import { onMount, onDestroy } from 'svelte';
  import type {
    UniversityRankingData,
    SortCriteria,
    RankingRadiusFilter,
    UniversityRankingResponse,
    RankingsTableItem
  } from '$lib/types';
  import { PAGINATION } from '$lib/constants';
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import RankingsHeader from '$lib/components/rankings/RankingsHeader.svelte';
  import RankingsTable from '$lib/components/rankings/RankingsTable.svelte';

  let { data } = $props();

  let sortBy: SortCriteria = $derived(data.sortBy);
  let radiusFilter: RankingRadiusFilter = $derived(data.radius);
  let displayedRankings: UniversityRankingData[] = $derived(data.rankings);
  let hasMore = $derived(data.hasMore);
  let nextCursor = $derived(data.nextCursor);
  let isLoading = $state(false);
  let isLoadingMore = $state(false);

  const divider = ' · ';

  $effect(() => {
    displayedRankings = data.rankings;
    hasMore = data.hasMore;
    nextCursor = data.nextCursor;
  });

  $effect(() => {
    if (browser && (sortBy !== data.sortBy || radiusFilter !== data.radius)) {
      const url = new URL(window.location.href);
      url.searchParams.set('sortBy', sortBy);
      url.searchParams.set('radius', radiusFilter.toString());
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
        const apiUrl = new URL(fromPath('/api/rankings/campus'), window.location.origin);
        apiUrl.searchParams.set('sortBy', sortBy);
        apiUrl.searchParams.set('radius', radiusFilter.toString());
        apiUrl.searchParams.set('after', nextCursor);
        apiUrl.searchParams.set('limit', PAGINATION.RANKING_PAGE_SIZE.toString());

        const response = await fetch(apiUrl.toString());

        if (!response.ok) {
          throw new Error(`Failed to load more results: ${response.status}`);
        }

        const result = (await response.json()) as UniversityRankingResponse;

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
      return () => {
        window.removeEventListener('scroll', handleScroll);
      };
    }
  });

  onDestroy(() => {
    isLoading = false;
    isLoadingMore = false;
  });

  const getMetricsForRadius = (ranking: RankingsTableItem, radius: number) => {
    return (ranking as UniversityRankingData).rankings.find((r) => r.radius === radius);
  };
</script>

<div class="mx-auto pt-20 pb-8 sm:container sm:px-4">
  <RankingsHeader
    title={m.campus_rankings()}
    description={m.campus_rankings_description()}
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
    <RankingsTable
      rankings={displayedRankings}
      {sortBy}
      bind:radiusFilter
      {isLoading}
      {isLoadingMore}
      {hasMore}
      getMetrics={getMetricsForRadius}
      nameHeader={m.university()}
    >
      {#snippet nameColumn(ranking: RankingsTableItem)}
        {@const campus = ranking as UniversityRankingData}
        <div class="flex flex-col gap-1">
          <div>
            <a
              href={resolve('/(main)/universities/[id]', {
                id: campus.id.split('_')[0]
              })}
              target={adaptiveNewTab()}
              class="text-base-content link-accent pr-1 font-semibold transition-colors"
              >{campus.universityName}</a
            >
            <span class="font-light text-current/70">{campus.campusName}</span>
          </div>
          <div class="flex flex-wrap items-center space-x-1.5">
            <div class="text-xs opacity-70 not-xl:hidden sm:text-sm">
              {formatRegionLabel(campus, true, divider)}
            </div>
            <div class="text-xs opacity-70 sm:text-sm xl:hidden">
              {formatRegionLabel(campus, false, divider)}
            </div>
            {#if campus.is985}
              <div class="badge badge-soft badge-primary badge-xs text-nowrap">
                {m.badge_985()}
              </div>
            {/if}
            {#if campus.is211}
              <div class="badge badge-soft badge-secondary badge-xs text-nowrap">
                {m.badge_211()}
              </div>
            {/if}
            {#if campus.isDoubleFirstClass}
              <div class="badge badge-soft badge-accent badge-xs text-nowrap">
                {m.badge_double_first_class()}
              </div>
            {/if}
          </div>
        </div>
      {/snippet}

      {#snippet nameHoverDetails(ranking: RankingsTableItem)}
        {@const campus = ranking as UniversityRankingData}
        <div class="flex flex-wrap text-xs opacity-70 sm:text-sm">
          <div>{campus.type}</div>
          <div class="whitespace-pre">{divider}</div>
          <div class="tooltip tooltip-bottom" data-tip={m.governing_body()}>
            {campus.affiliation}
          </div>
        </div>
      {/snippet}

      {#snippet actionColumn(ranking: RankingsTableItem)}
        {@const campus = ranking as UniversityRankingData}
        <a
          class="btn btn-ghost btn-sm"
          href="{resolve('/(main)/discover')}?latitude={campus.location
            .coordinates[1]}&longitude={campus.location
            .coordinates[0]}&radius={radiusFilter}&name={encodeURIComponent(campus.fullName)}"
          target={adaptiveNewTab()}
        >
          <i class="fas fa-map-marker-alt"></i>
          <span class="not-md:hidden">{m.view_location()}</span>
        </a>
      {/snippet}
    </RankingsTable>
  {/if}
</div>

<style lang="postcss">
  @reference "tailwindcss";
</style>
