<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { adaptiveNewTab, pageTitle } from '$lib/utils';
  import InlineAlert from '$lib/components/InlineAlert.svelte';
  import { fromPath } from '$lib/utils/scoped';
  import { onMount, onDestroy } from 'svelte';
  import RankingsHeader from '$lib/components/rankings/RankingsHeader.svelte';
  import RankingsTable from '$lib/components/rankings/RankingsTable.svelte';
  import { getMetroBadgeTextColor, getMetroLocalizedName } from '$lib/utils/metro.client';
  import { getLocale } from '$lib/paraglide/runtime';
  import type { MetroRankingResponse, MetroStationRanking } from '$lib/schemas/metro';
  import type { SortCriteria, MetroRankingRadiusFilter, RankingsTableItem } from '$lib/types';
  import { PAGINATION, METRO_RANKING_RADIUS_OPTIONS, POI_SORT_CRITERIA } from '$lib/constants';
  import { browser } from '$app/environment';

  let { data } = $props();

  let sortBy: SortCriteria = $derived(data.sortBy);
  let radiusFilter: MetroRankingRadiusFilter = $derived(data.radius);
  let networkId: string | undefined = $derived(data.networkId);
  let displayedRankings: MetroStationRanking[] = $derived(data.rankings);
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
    if (
      browser &&
      (sortBy !== data.sortBy || radiusFilter !== data.radius || networkId !== data.networkId)
    ) {
      const url = new URL(window.location.href);
      url.searchParams.set('sortBy', sortBy);
      url.searchParams.set('radius', radiusFilter.toString());
      if (networkId) url.searchParams.set('networkId', networkId);
      else url.searchParams.delete('networkId');
      url.searchParams.delete('after');
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
        const apiUrl = new URL(fromPath('/api/rankings/metro'), window.location.origin);
        apiUrl.searchParams.set('sortBy', sortBy);
        apiUrl.searchParams.set('radius', radiusFilter.toString());
        if (networkId) apiUrl.searchParams.set('networkId', networkId);
        apiUrl.searchParams.set('after', nextCursor);
        apiUrl.searchParams.set('limit', PAGINATION.RANKING_PAGE_SIZE.toString());

        const response = await fetch(apiUrl.toString());

        if (!response.ok) {
          throw new Error(`Failed to load more results: ${response.status}`);
        }

        const result = (await response.json()) as MetroRankingResponse;

        // A rebuilt ranking invalidates old global-rank cursors; drop stale pages.
        if (result.cacheTime !== data.cacheTime?.toISOString()) return;

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
    return (ranking as MetroStationRanking).rankings.find((r) => r.radius === radius);
  };

  const locale = getLocale();
  // openmetro's names contract is {zh, en}; fall back en → primary name.
  const stationName = (station: MetroStationRanking) =>
    getMetroLocalizedName(station.names, station.name, locale);

  const badgeColor = (color: string | null) =>
    color && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color) ? color : '#64748b';

  const discoverUrl = (station: MetroStationRanking) => {
    const query = new URLSearchParams({
      latitude: station.location.lat.toFixed(6),
      longitude: station.location.lon.toFixed(6),
      name: stationName(station),
      radius: radiusFilter.toString()
    });
    return `${resolve('/(main)/discover')}?${query}`;
  };

  const networkMeta = (networkId: string) =>
    data.networks.find((network) => network.id === networkId);
  const networkName = (station: MetroStationRanking) => {
    const meta = networkMeta(station.networkId);
    return meta ? getMetroLocalizedName(meta.names, meta.name, locale) : station.networkId;
  };
</script>

<svelte:head>
  <title>{pageTitle(m.stations_ranking())}</title>
  <meta name="description" content={m.metro_rankings_description()} />
  <meta property="og:title" content={pageTitle(m.stations_ranking())} />
  <meta property="og:description" content={m.metro_rankings_description()} />
  <meta name="twitter:title" content={pageTitle(m.stations_ranking())} />
  <meta name="twitter:description" content={m.metro_rankings_description()} />
</svelte:head>

<div class="mx-auto pt-20 pb-8 sm:container sm:px-4">
  <RankingsHeader
    title={m.stations_ranking()}
    description={m.metro_rankings_description()}
    cached={data.cached}
    stale={data.stale}
    cacheTime={data.cacheTime}
    bind:sortBy
    criteria={POI_SORT_CRITERIA}
  />

  {#if data.error}
    <InlineAlert type="error" icon="fa-circle-xmark" class="mb-4"
      >{m.failed_to_get_rankings()}</InlineAlert
    >
  {:else if data.calculating}
    <InlineAlert type="info" icon="fa-spinner fa-spin" class="mb-4"
      >{m.rankings_being_updated()}</InlineAlert
    >
  {:else}
    <div class="tabs tabs-border mb-4 justify-center not-sm:mx-2">
      <button
        class="tab transition-colors {!networkId ? 'tab-active' : ''}"
        onclick={() => (networkId = undefined)}
      >
        {m.metro_all_networks()}
      </button>
      {#each data.networks as network (network.id)}
        <button
          class="tab transition-colors {networkId === network.id ? 'tab-active' : ''}"
          onclick={() => (networkId = network.id)}
        >
          {getMetroLocalizedName(network.names, network.name, locale)}
        </button>
      {/each}
    </div>

    <RankingsTable
      rankings={displayedRankings}
      {sortBy}
      bind:radiusFilter
      radiusOptions={METRO_RANKING_RADIUS_OPTIONS}
      {isLoading}
      {isLoadingMore}
      {hasMore}
      getMetrics={getMetricsForRadius}
      nameHeader={m.metro_station()}
    >
      {#snippet nameColumn(ranking: RankingsTableItem)}
        {@const station = ranking as MetroStationRanking}
        <div class="flex flex-col gap-1">
          <div>
            <a
              href={discoverUrl(station)}
              target={adaptiveNewTab()}
              class="text-base-content link-accent pr-1 font-semibold transition-colors"
              >{stationName(station)}</a
            >
            <span class="font-light text-current/70">{networkName(station)}</span>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            {#each station.lines as line (line.id)}
              {@const color = badgeColor(line.color)}
              <span
                class="inline-flex min-w-6 items-center justify-center rounded px-1.5 py-0.5 text-xs font-semibold"
                style:background-color={color}
                style:color={getMetroBadgeTextColor(color)}
                title={getMetroLocalizedName(line.names, line.name, locale)}
              >
                <span class="sr-only"
                  >{getMetroLocalizedName(line.names, line.name, locale)} ·
                </span>{line.shortName}
              </span>
            {/each}
          </div>
        </div>
      {/snippet}

      {#snippet nameHoverDetails(ranking: RankingsTableItem)}
        {@const station = ranking as MetroStationRanking}
        {@const localName = stationName(station)}
        {@const altName = locale === 'zh' ? station.names.en : station.names.zh}
        {#if altName && altName !== localName}
          <div class="flex flex-wrap items-center text-xs opacity-70 sm:text-sm">
            <div>{altName}</div>
          </div>
        {/if}
      {/snippet}

      {#snippet actionColumn(ranking: RankingsTableItem)}
        {@const station = ranking as MetroStationRanking}
        <a
          class="btn btn-ghost btn-sm"
          href={discoverUrl(station)}
          target={adaptiveNewTab()}
          aria-label={`${m.explore_nearby()} · ${stationName(station)}`}
        >
          <i class="fa-solid fa-location-arrow" aria-hidden="true"></i>
          <span class="not-md:hidden">{m.explore_nearby()}</span>
        </a>
      {/snippet}
    </RankingsTable>
  {/if}
</div>

<style lang="postcss">
  @reference "tailwindcss";
</style>
