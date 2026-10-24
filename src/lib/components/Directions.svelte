<script lang="ts">
  import { untrack } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import type { ShopApi, TransportMethod } from '$lib/types';
  import type { RouteResult, RouteSegment, TransportSearchResult } from '$lib/types/routing';
  import { m } from '$lib/paraglide/messages';
  import { formatDistance, formatDuration, removeRecursiveBrackets } from '$lib/utils';
  import { formatCurrencyAmount } from '$lib/utils';
  import { getLocale } from '$lib/paraglide/runtime';
  import FancyButton from './FancyButton.svelte';
  import Drawer from './Drawer.svelte';

  /** One grouped row of the panel for non-transit modes. */
  interface ProcessedSegment {
    name: string;
    distanceMeters: number;
    durationSeconds: number;
    segments: RouteSegment[];
  }

  interface Props {
    isOpen?: boolean;
    shop?: ShopApi | null;
    isLoading?: boolean;
    selectedRouteIndex?: number;
    routeData: TransportSearchResult | null;
    /** The discover map, for drawing the selected itinerary. */
    map?: maplibregl.Map | null;
    /**
     * Best "open in maps app" link for the destination, resolved per platform
     * by the caller. Absent → the external button is hidden.
     */
    mapLink?: string | null;
    /**
     * True when `routeData` is a reconstructed openmetro itinerary. Its fare is
     * then fetched live, so the cost column shows a skeleton until it arrives.
     */
    isMetro?: boolean;
    /** True while the openmetro fare request is still in flight. */
    fareLoading?: boolean;
    /**
     * Live fare for a metro itinerary. Overrides the route's own `cost`, which
     * is absent for reconstructed plans (openmetro publishes fares separately).
     */
    fare?: number | null;
    /** ISO currency code reported by Open Metro for a metro fare. */
    fareCurrency?: string | null;
    onClose?: () => void;
    onRouteSelected?: (index: number) => void;
  }

  let {
    isOpen = $bindable(false),
    shop = null,
    isLoading = false,
    selectedRouteIndex = 0,
    routeData = undefined,
    map = undefined,
    mapLink = null,
    isMetro = false,
    fareLoading = false,
    fare = null,
    fareCurrency = null,
    onClose = () => {},
    onRouteSelected = () => {}
  }: Props = $props();

  // Extract routes from the response
  const routes: RouteResult[] = $derived(
    routeData && typeof routeData === 'object' ? (routeData.routes ?? []) : []
  );

  /** Group non-transit steps into readable segments sharing a road name. */
  const processSegments = (route: RouteResult): ProcessedSegment[] => {
    const segments: ProcessedSegment[] = [];
    for (const segment of route.segments) {
      const road = segment.instruction?.trim() ?? '';
      const last = segments[segments.length - 1];
      const distance = segment.distanceMeters ?? 0;
      const duration = segment.durationSeconds ?? 0;
      if (
        last &&
        road &&
        (last.name === road || last.name.includes(road) || road.includes(last.name))
      ) {
        last.segments.push(segment);
        last.distanceMeters += distance;
        last.durationSeconds += duration;
        continue;
      }
      segments.push({
        name: road,
        distanceMeters: distance,
        durationSeconds: duration,
        segments: [segment]
      });
    }
    // Merge tiny unnamed fragments into the previous row.
    const merged: ProcessedSegment[] = [];
    for (const segment of segments) {
      const previous = merged[merged.length - 1];
      if (previous && !segment.name && segment.durationSeconds < 90) {
        previous.segments.push(...segment.segments);
        previous.distanceMeters += segment.distanceMeters;
        previous.durationSeconds += segment.durationSeconds;
        continue;
      }
      merged.push(segment);
    }
    return merged;
  };

  const processedRoutes = $derived(
    routes.map((route) => ({ route, segments: processSegments(route) }))
  );

  const transportMethod = $derived.by((): TransportMethod => {
    const first = routes[0];
    if (!first) return undefined;
    if (first.mode === 'cycling') return 'riding';
    return first.mode;
  });

  /**
   * Metro fares arrive separately: a reconstructed plan has no `cost`. Real
   * routes report their own cost. Explicit zero fares are valid.
   */
  const routeCost = $derived.by(() => {
    const route = routes[selectedRouteIndex];
    const cost = isMetro ? fare : route?.cost;
    return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
  });

  /** Missing or failed fares must not leave an empty third grid column. */
  const showFareStat = $derived(fareLoading || routeCost !== null);

  // ── Map itinerary drawing ────────────────────────────────────────────────

  const ROUTE_SOURCE_ID = 'directions-route';
  const ROUTE_CASING_LAYER_ID = 'directions-route-casing';
  const ROUTE_LAYER_ID = 'directions-route';
  const ROUTE_DASHED_LAYER_ID = 'directions-route-dashed';

  const clearItinerary = (instance?: maplibregl.Map | null) => {
    if (!instance) return;
    try {
      for (const id of [ROUTE_LAYER_ID, ROUTE_DASHED_LAYER_ID, ROUTE_CASING_LAYER_ID]) {
        if (instance.getLayer(id)) instance.removeLayer(id);
      }
      if (instance.getSource(ROUTE_SOURCE_ID)) instance.removeSource(ROUTE_SOURCE_ID);
    } catch {
      // Map may already be destroyed during navigation.
    }
  };

  const drawItinerary = (instance: maplibregl.Map, route: RouteResult) => {
    clearItinerary(instance);
    const features = route.segments
      .filter((segment) => segment.geometry.length >= 2)
      .map((segment, index) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: segment.geometry
        },
        properties: {
          index,
          color: segment.color ?? defaultModeColor(route.mode),
          dashed: segment.dashed ? 1 : 0
        }
      }));
    if (features.length === 0) return;

    instance.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features }
    });
    instance.addLayer({
      id: ROUTE_CASING_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#000000',
        'line-width': 10,
        'line-opacity': 0.25
      },
      filter: ['!', ['get', 'dashed']]
    });
    // Solid segments: casing under a colored fill. Walking legs draw dashed
    // and skip the casing.
    instance.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 7,
        'line-opacity': 1
      },
      filter: ['!', ['get', 'dashed']]
    });
    instance.addLayer({
      id: ROUTE_DASHED_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 5,
        'line-opacity': 1,
        'line-dasharray': [2, 2]
      },
      filter: ['get', 'dashed']
    });

    const bounds = new maplibregl.LngLatBounds();
    for (const [lng, lat] of route.geometry) bounds.extend([lng, lat]);
    if (!bounds.isEmpty()) {
      instance.fitBounds(bounds, { padding: 72, duration: 600, maxZoom: 16 });
    }
  };

  const defaultModeColor = (mode: RouteResult['mode']): string => {
    switch (mode) {
      case 'walking':
        return '#f43f5e';
      case 'driving':
        return '#6366f1';
      case 'cycling':
        return '#f59e0b';
      default:
        return '#8b5cf6';
    }
  };

  $effect(() => {
    const instance = map;
    const route = routes[selectedRouteIndex];
    if (!instance || !route || !isOpen) {
      clearItinerary(instance);
      return;
    }
    untrack(() => drawItinerary(instance, route));
  });

  // Clean up when dialog closes
  $effect(() => {
    if (!isOpen) {
      untrack(() => clearItinerary(map));
    }
  });

  const closeDialog = () => {
    isOpen = false;
  };

  // Cleanup when drawer/panel closes (handles both button close and drag-to-close)
  let wasOpen = false;
  $effect(() => {
    if (wasOpen && !isOpen) {
      clearItinerary(map);
      onClose();
    }
    wasOpen = isOpen;
  });

  const selectRoute = (index: number) => {
    selectedRouteIndex = index;
    onRouteSelected(index);
  };

  const getRouteSummary = (route: RouteResult): string => {
    const names = (route.lines ?? [])
      .map((line) => line.name.trim())
      .filter(Boolean)
      .map((name) => removeRecursiveBrackets(name));
    if (names.length > 0) return names.join(' → ');
    switch (route.mode) {
      case 'walking':
        return m.walking();
      case 'cycling':
        return m.riding();
      case 'driving':
        return m.driving();
      default:
        return m.public_transport();
    }
  };

  const isWalkSegment = (segment: RouteSegment): boolean =>
    !segment.color && /步行|walk/i.test(segment.instruction ?? '');

  const segmentIcon = (segment: RouteSegment): string => {
    if (segment.color) return 'fa-subway';
    if (isWalkSegment(segment)) return 'fa-walking';
    switch (transportMethod) {
      case 'walking':
        return 'fa-walking';
      case 'riding':
        return 'fa-bicycle';
      case 'driving':
        return 'fa-car';
      default:
        return 'fa-train-subway';
    }
  };

  const segmentBadgeClass = (segment: RouteSegment): string => {
    if (segment.color) return 'bg-violet-500';
    if (isWalkSegment(segment)) return 'bg-rose-500';
    switch (transportMethod) {
      case 'walking':
        return 'bg-rose-500';
      case 'riding':
        return 'bg-amber-500';
      case 'driving':
        return 'bg-indigo-500';
      default:
        return 'bg-slate-500';
    }
  };
</script>

{#snippet directionsBody()}
  <!-- Header -->
  <div class="bg-base-100 flex items-center justify-between gap-2 p-2 md:p-4">
    <div class="min-w-0 flex-1">
      <h3 class="truncate text-base font-semibold not-md:ml-2 md:text-lg">{shop?.name}</h3>
      <p class="text-base-content/70 text-sm not-md:hidden">{m.directions()}</p>
    </div>
    <div class="flex items-center gap-0.5">
      {#if mapLink}
        <FancyButton
          href={mapLink}
          target="_blank"
          class="fa-solid fa-arrow-up-right-from-square fa-md"
          btnCls="btn-ghost btn-sm"
          text={m.open_in_maps_app()}
        />
      {/if}
      <button class="btn btn-ghost btn-sm btn-circle" onclick={closeDialog} aria-label={m.close()}>
        <i class="fa-solid fa-xmark fa-lg"></i>
      </button>
    </div>
  </div>

  <!-- Content -->
  <div class="bg-base-100/40 flex-1 overflow-x-hidden overflow-y-auto backdrop-blur-3xl">
    {#if isLoading}
      <div class="flex h-full items-center justify-center p-20">
        <div class="loading loading-spinner loading-lg"></div>
      </div>
    {:else}
      {#if processedRoutes.length > 1}
        <!-- Route Tabs -->
        <div class="tabs tabs-border px-4 pt-4">
          {#each processedRoutes as entry, index (index)}
            <button
              class="tab tab-sm text-nowrap transition {selectedRouteIndex === index
                ? 'tab-active'
                : ''}"
              onclick={() => selectRoute(index)}
            >
              <div class="tooltip tooltip-bottom" data-tip={getRouteSummary(entry.route)}>
                <div class="inline-flex items-center gap-2 text-sm font-medium">
                  {formatDuration(entry.route.durationSeconds)}
                </div>
              </div>
            </button>
          {/each}
        </div>
      {/if}

      {#if processedRoutes[selectedRouteIndex]}
        {@const selected = processedRoutes[selectedRouteIndex]}
        <div class="p-4 md:w-[30vw] md:max-w-lg md:min-w-full">
          <!-- Route Summary -->
          <div class="mb-4 grid gap-4 {showFareStat ? 'grid-cols-3' : 'grid-cols-2'}">
            <div class="stat bg-base-200/50 rounded-lg p-3">
              <div class="stat-title text-xs">{m.travel_time()}</div>
              <div class="stat-value text-lg text-wrap">
                {formatDuration(selected.route.durationSeconds)}
              </div>
            </div>
            <div class="stat bg-base-200/50 rounded-lg p-3">
              <div class="stat-title text-xs">{m.total_distance()}</div>
              <div class="stat-value text-lg text-wrap">
                {formatDistance(selected.route.distanceMeters / 1000, 2)}
              </div>
            </div>
            {#if showFareStat}
              {#if fareLoading}
                <div class="stat bg-base-200/50 rounded-lg p-3">
                  <div class="stat-title text-xs">{m.fare()}</div>
                  <div class="stat-value text-lg text-wrap">
                    <div class="skeleton h-6 w-16"></div>
                  </div>
                </div>
              {:else if routeCost !== null}
                <div class="stat bg-base-200/50 rounded-lg p-3">
                  <div class="stat-title text-xs">{m.fare()}</div>
                  <div class="stat-value text-lg text-wrap">
                    {#if !isMetro || fareCurrency?.toUpperCase() === 'CNY'}
                      {m.cost_cny({ cost: routeCost })}
                    {:else if fareCurrency}
                      {formatCurrencyAmount(routeCost, fareCurrency, getLocale())}
                    {:else}
                      {routeCost}
                    {/if}
                  </div>
                </div>
              {/if}
            {/if}
          </div>

          <!-- Route Steps -->
          <div class="space-y-3">
            <h4 class="text-sm font-medium">{m.details()}</h4>
            {#each selected.segments as segment, segmentIndex (segmentIndex)}
              <div class="bg-base-200/30 space-y-2 rounded-lg p-3">
                <div class="flex items-center gap-3">
                  <div class="shrink-0">
                    <div
                      class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white shadow-lg {segmentBadgeClass(
                        segment.segments[0]
                      )}"
                    >
                      <i class="fas {segmentIcon(segment.segments[0])} text-xs"></i>
                    </div>
                  </div>
                  <div class="min-w-0 flex-1">
                    {#if segment.name}
                      <div class="text-sm font-medium sm:text-base">{segment.name}</div>
                      <div class="text-base-content/60 text-xs sm:text-sm">
                        <span>{formatDistance(segment.distanceMeters / 1000, 2)}</span>
                        {#if segment.durationSeconds}
                          <span> · {formatDuration(segment.durationSeconds)}</span>
                        {/if}
                      </div>
                    {:else}
                      <div class="text-sm font-medium sm:text-base">
                        <span>{formatDistance(segment.distanceMeters / 1000, 2)}</span>
                        {#if segment.durationSeconds}
                          <span> · {formatDuration(segment.durationSeconds)}</span>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </div>

                {#if segment.segments.some((part) => part.stations)}
                  {@const stations = segment.segments.find((part) => part.stations)?.stations}
                  {#if stations}
                    <div class="ml-9 space-y-2">
                      <div class="flex items-center gap-2 text-sm">
                        <i class="fas fa-route text-xs"></i>
                        <div class="text-base-content/80">
                          {#if segment.name}
                            <span class="font-medium">{removeRecursiveBrackets(segment.name)} · </span>
                          {/if}
                          <span>{m.stations({ count: (stations.via?.length ?? 0) + 1 })}</span>
                        </div>
                      </div>
                      <div class="space-y-1 text-sm">
                        {#if stations.on}
                          <div class="flex items-center gap-2">
                            <i class="fas fa-circle-up text-xs text-green-500"></i>
                            <span class="font-medium">{m.board_at()}:</span>
                            <span class="text-base-content/80">{stations.on}</span>
                          </div>
                        {/if}
                        {#if stations.via && stations.via.length > 0}
                          <details class="group ml-5">
                            <summary
                              class="text-base-content/60 hover:text-base-content/80 cursor-pointer text-xs transition-colors"
                            >
                              <i
                                class="fas fa-chevron-right mr-1 transition-transform group-open:rotate-90"
                              ></i>
                              {m.via_stops({ count: stations.via.length })}
                            </summary>
                            <div class="mt-2 ml-4 space-y-1">
                              {#each stations.via as stop (stop)}
                                <div class="text-base-content/60 flex items-center gap-2 text-xs">
                                  <i class="fas fa-circle text-xs opacity-30"></i>
                                  {stop}
                                </div>
                              {/each}
                            </div>
                          </details>
                        {/if}
                        {#if stations.off}
                          <div class="flex items-center gap-2">
                            <i class="fas fa-circle-down text-xs text-red-500"></i>
                            <span class="font-medium">{m.alight_at()}:</span>
                            <span class="text-base-content/80">{stations.off}</span>
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
{/snippet}

<!-- Desktop: right side panel -->
<div
  class="pointer-events-auto hidden w-fit will-change-transform md:fixed md:top-0 md:right-0 md:bottom-0 md:z-1000 md:block md:transition-transform md:duration-300 md:ease-out {shop
    ? 'md:opacity-100'
    : 'md:opacity-0'} {isOpen ? 'md:translate-x-0' : 'md:translate-x-full'}"
>
  <div
    class="bg-base-100 flex h-full flex-col overflow-hidden md:max-h-full md:rounded-l-xl md:rounded-tr-none {isOpen
      ? 'md:shadow-lg'
      : 'md:shadow-none'}"
  >
    {@render directionsBody()}
  </div>
</div>

<!-- Mobile: bottom sheet drawer -->
<Drawer
  bind:open={isOpen}
  snapPoints={[0.2, 0.5, 0.85]}
  initialSnap={1}
  class="bg-base-100 shadow-xl"
>
  {@render directionsBody()}
</Drawer>

<style lang="postcss">
  @reference "tailwindcss";

  summary {
    @apply cursor-pointer list-none select-none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .tooltip:before {
    @apply max-w-[50vw] text-xs text-wrap whitespace-normal sm:px-3 sm:py-2 sm:text-sm md:max-w-[15vw];
  }
</style>
