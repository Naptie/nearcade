<script lang="ts">
  import { untrack } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import type { ShopApi } from '$lib/types';
  import type { LegKind, RouteLeg, RouteResult, TransportSearchResult } from '$lib/types/routing';
  import { m } from '$lib/paraglide/messages';
  import { formatDistance, formatDuration, removeRecursiveBrackets } from '$lib/utils';
  import { formatCurrencyAmount } from '$lib/utils';
  import { getLocale } from '$lib/paraglide/runtime';
  import { LEG_STYLES, legColor } from '$lib/utils/route-style';
  import FancyButton from './FancyButton.svelte';
  import Drawer from './Drawer.svelte';

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

  // ── Leg presentation ──────────────────────────────────────────────────────
  // Providers hand back legs at their own granularity — AMap splits every
  // transit segment into walks + rides, Baidu emits per-road fragments — and
  // both sprinkle near-zero fragments (a crossing mis-attributed to a road
  // 9 m away) that read as noise. The panel renders a derived list that folds
  // the noise away, so the itinerary reads like the SDK's: one instruction
  // per action, distance and time attached, stations underneath.

  const MICRO_LEG_METERS = 25;
  /** Walk legs up to this combined length read as a single instruction. */
  const MERGEABLE_WALK_METERS = 500;

  const mergeLegPair = (a: RouteLeg, b: RouteLeg): RouteLeg => ({
    ...a,
    ...(!a.name && b.name ? { name: b.name } : {}),
    distanceMeters: a.distanceMeters + b.distanceMeters,
    durationSeconds: a.durationSeconds + b.durationSeconds,
    geometry: [...a.geometry, ...b.geometry],
    steps: [...a.steps, ...b.steps],
    ...((a.stations ?? b.stations) ? { stations: a.stations ?? b.stations } : {})
  });

  const buildPresentationLegs = (legs: RouteLeg[]): RouteLeg[] => {
    const merged: RouteLeg[] = [];
    for (const leg of legs) {
      const previous = merged[merged.length - 1];
      // A fragment too short to walk deliberately is presentation noise.
      if (previous && leg.distanceMeters < MICRO_LEG_METERS) {
        merged[merged.length - 1] = mergeLegPair(previous, leg);
        continue;
      }
      // Consecutive short walks read as one "walk to the platform" instead of
      // three fragment cards; longer walks keep their road identity.
      if (
        previous &&
        leg.kind === 'walk' &&
        previous.kind === 'walk' &&
        previous.distanceMeters + leg.distanceMeters <= MERGEABLE_WALK_METERS
      ) {
        merged[merged.length - 1] = mergeLegPair(previous, leg);
        continue;
      }
      merged.push(leg);
    }
    return merged;
  };

  const isTransitKind = (kind: LegKind): boolean =>
    kind === 'bus' || kind === 'subway' || kind === 'rail' || kind === 'ferry';

  /**
   * The instruction a leg renders as, action-first — the SDK's "walk 176 m to
   * Zhenbei Road" / "take metro line 13" rather than a bare distance.
   */
  const legTitle = (
    leg: RouteLeg,
    next: RouteLeg | undefined,
    mode: RouteResult['mode']
  ): string => {
    const clean = (value: string) => removeRecursiveBrackets(value);
    if (leg.kind === 'walk') {
      // Metro reconstruction bakes complete phrases (walk to station,
      // transfer at station, walk to the shop); walking-mode legs carry the
      // road. Both are ready-made titles.
      if (leg.name) {
        return mode === 'transit' ? clean(leg.name) : m.walk_along_road({ road: clean(leg.name) });
      }
      const boarding = isTransitKind(next?.kind ?? 'walk') ? next?.stations?.on : undefined;
      if (boarding) return m.walk_to_station({ station: clean(boarding) });
      if (!next && mode === 'transit') return m.walk_to_shop();
      return m.walking();
    }
    if (isTransitKind(leg.kind)) {
      return leg.name ? m.ride_line({ line: clean(leg.name) }) : m.public_transport();
    }
    if (leg.name) return clean(leg.name);
    return leg.kind === 'ride' ? m.riding() : m.driving();
  };

  // ── Map itinerary drawing ────────────────────────────────────────────────
  // The focused route is painted the way OpenMetro paints a selected line:
  // a white casing under the colored line with animated white dashes flowing
  // along it. Every kind of leg joins in with its own adaptation — vehicles
  // get the full casing + line + dash treatment, walks get the same casing
  // under a dashed line of their own whose dashes march at foot pace. The
  // movement itself is the direction cue, so there are no arrow overlays.

  const ROUTE_SOURCE_ID = 'directions-route';
  const ROUTE_CASING_LAYER_ID = 'directions-route-casing';
  const ROUTE_LAYER_ID = 'directions-route';
  const ROUTE_FLOW_LAYER_ID = 'directions-route-flow';
  const ROUTE_WALK_CASING_LAYER_ID = 'directions-route-walk-casing';
  const ROUTE_WALK_LAYER_ID = 'directions-route-walk';

  /** The walk leg's casing and its dashes, in map pixels. */
  const ROUTE_WALK_CASING_WIDTH = 9;
  const ROUTE_WALK_WIDTH = 6;

  /**
   * The casing under the walk dashes carries the same dash pattern as the
   * dashes themselves, so the white edges each dash instead of filling the
   * gaps between them — the leg stays the colour of the mode, with the map
   * showing through, and still reads as the cased line the vehicle legs use.
   *
   * MapLibre measures a dash pattern in line-widths, so the wider casing
   * needs its pattern scaled down by the same ratio or the two march out of
   * step with each other.
   */
  const walkCasingDash = (values: number[]): number[] =>
    values.map((value) => (value * ROUTE_WALK_WIDTH) / ROUTE_WALK_CASING_WIDTH);

  /** Every layer the itinerary can put on the map, drawn back to front. */
  const ROUTE_LAYER_IDS = [
    ROUTE_CASING_LAYER_ID,
    ROUTE_WALK_CASING_LAYER_ID,
    ROUTE_LAYER_ID,
    ROUTE_FLOW_LAYER_ID,
    ROUTE_WALK_LAYER_ID
  ];

  /**
   * The marching-dash phases: every entry totals 7 units and advances the
   * pattern by one, so stepping through them per frame slides the dashes
   * forward along the line — OpenMetro's own sequence for its selected
   * routes, whose direction read was verified against their live frontend.
   */
  const DASH_SEQUENCE: number[][] = [
    [0, 4, 3],
    [0.5, 4, 2.5],
    [1, 4, 2],
    [1.5, 4, 1.5],
    [2, 4, 1],
    [2.5, 4, 0.5],
    [3, 4, 0],
    [0, 0.5, 3, 3.5],
    [0, 1, 3, 3],
    [0, 1.5, 3, 2.5],
    [0, 2, 3, 2],
    [0, 2.5, 3, 1.5],
    [0, 3, 3, 1],
    [0, 3.5, 3, 0.5]
  ];

  /**
   * One animation loop drives every animated layer. The phases live outside
   * the loop so a redraw (another route, another tab) picks the motion up
   * where it left off instead of snapping back to the pattern's start.
   * Vehicles step each frame; walks step every fourth frame — foot pace
   * against vehicle speed.
   */
  let routeAnimFrame = 0;
  let vehicleDashPhase = 0;
  let walkDashPhase = 0;
  let animationTick = 0;

  const stopRouteAnimation = () => {
    if (routeAnimFrame !== 0) {
      cancelAnimationFrame(routeAnimFrame);
      routeAnimFrame = 0;
    }
  };

  const startRouteAnimation = (instance: maplibregl.Map) => {
    stopRouteAnimation();
    // Paint the current phase right away: waiting for the first frame would
    // leave the dashes standing still for a beat after the line appears.
    const applyStep = () => {
      let alive = false;
      animationTick += 1;
      if (instance.getLayer(ROUTE_FLOW_LAYER_ID)) {
        instance.setPaintProperty(
          ROUTE_FLOW_LAYER_ID,
          'line-dasharray',
          DASH_SEQUENCE[vehicleDashPhase % DASH_SEQUENCE.length] as unknown as number[]
        );
        vehicleDashPhase += 1;
        alive = true;
      }
      if (instance.getLayer(ROUTE_WALK_LAYER_ID)) {
        if (animationTick % 4 === 0) {
          walkDashPhase += 1;
          const pattern = DASH_SEQUENCE[walkDashPhase % DASH_SEQUENCE.length];
          instance.setPaintProperty(
            ROUTE_WALK_LAYER_ID,
            'line-dasharray',
            pattern as unknown as number[]
          );
          // The casing marches with the dashes it edges — same pattern, scaled
          // to its own width.
          if (instance.getLayer(ROUTE_WALK_CASING_LAYER_ID)) {
            instance.setPaintProperty(
              ROUTE_WALK_CASING_LAYER_ID,
              'line-dasharray',
              walkCasingDash(pattern) as unknown as number[]
            );
          }
        }
        alive = true;
      }
      return alive;
    };
    if (!applyStep()) return;
    const frame = () => {
      // The layers vanish with the style (a theme swap) or the panel closing;
      // then the loop stops instead of spinning on a dead map.
      if (!applyStep()) {
        routeAnimFrame = 0;
        return;
      }
      routeAnimFrame = requestAnimationFrame(frame);
    };
    routeAnimFrame = requestAnimationFrame(frame);
  };

  const clearItinerary = (instance?: maplibregl.Map | null) => {
    stopRouteAnimation();
    if (!instance) return;
    try {
      for (const id of ROUTE_LAYER_IDS) {
        if (instance.getLayer(id)) instance.removeLayer(id);
      }
      if (instance.getSource(ROUTE_SOURCE_ID)) instance.removeSource(ROUTE_SOURCE_ID);
    } catch {
      // Map may already be destroyed during navigation.
    }
  };

  const drawItinerary = (instance: maplibregl.Map, route: RouteResult) => {
    clearItinerary(instance);
    // Providers trim their step polylines at junctions — a leg can end tens of
    // metres before the next one starts (measured: up to 42 m across a cross),
    // and the legs draw as separate features, so the missing connector reads
    // as a broken route. Each feature extends to the next leg's first point,
    // which closes the gap with a straight crossing segment.
    const legs = buildPresentationLegs(route.legs).filter((leg) => leg.geometry.length >= 2);
    const features = legs.map((leg, index) => {
      const next = legs[index + 1];
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: next ? [...leg.geometry, next.geometry[0]] : leg.geometry
        },
        properties: {
          index,
          color: legColor(leg),
          // Boolean on purpose: the layer filters read this with `!`/identity,
          // which are boolean-typed expressions — a 0/1 number fails them and
          // MapLibre silently drops every feature from the layer.
          dashed: LEG_STYLES[leg.kind].dashed
        }
      };
    });
    if (features.length === 0) return;

    instance.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features }
    });

    const hasVehicleLegs = features.some((feature) => !feature.properties.dashed);
    const hasWalkLegs = features.some((feature) => feature.properties.dashed);

    // Vehicles: white casing under the colored line, OpenMetro's proportions.
    if (hasVehicleLegs) {
      instance.addLayer({
        id: ROUTE_CASING_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 11,
          'line-opacity': 0.95
        },
        filter: ['!', ['get', 'dashed']]
      });
      instance.addLayer({
        id: ROUTE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 7
        },
        filter: ['!', ['get', 'dashed']]
      });
    }

    // Both kinds animate: the vehicle dash overlay flows over the colored
    // line, the walk IS the dashed line and flows at foot pace. The motion
    // itself is the direction cue — no arrow overlays.
    if (hasVehicleLegs) {
      instance.addLayer({
        id: ROUTE_FLOW_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 2.5,
          'line-dasharray': [0, 4, 3]
        },
        filter: ['!', ['get', 'dashed']]
      });
    }

    if (hasWalkLegs) {
      // The same casing treatment the vehicle legs get — a white line under
      // the colour — so the footpath belongs to the same family. The earlier
      // halo was white at 35% over the dark map, which read as a faint grey
      // band behind the dashes rather than a casing; it is now opaque, and it
      // dashes along with the line so the colour leads and the map shows
      // through the gaps.
      instance.addLayer({
        id: ROUTE_WALK_CASING_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ROUTE_WALK_CASING_WIDTH,
          'line-opacity': 0.95,
          'line-dasharray': walkCasingDash([0, 4, 3])
        },
        filter: ['get', 'dashed']
      });
      instance.addLayer({
        id: ROUTE_WALK_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ROUTE_WALK_WIDTH,
          'line-dasharray': [0, 4, 3]
        },
        filter: ['get', 'dashed']
      });
    }

    const bounds = new maplibregl.LngLatBounds();
    for (const [lng, lat] of route.geometry) bounds.extend([lng, lat]);
    if (!bounds.isEmpty()) {
      instance.fitBounds(bounds, { padding: 72, duration: 600, maxZoom: 16 });
    }
    startRouteAnimation(instance);
  };

  /**
   * Bumped every time the map finishes loading a style — once at map init and
   * again after each theme swap. From the first bump on, `addSource` is safe
   * even while style changes are pending (a freshly added layer keeps
   * `isStyleLoaded()` false until the next render frame, which would
   * otherwise drop redraws that come quicker than the frames); the bump after
   * a swap is what repaints the open route, whose layers `setStyle` dropped.
   */
  let itineraryStyleEpoch = $state(0);

  $effect(() => {
    const instance = map;
    if (!instance) return;
    untrack(() => {
      instance.on('style.load', () => {
        itineraryStyleEpoch += 1;
      });
      // A component that mounts after the style has already settled (a hot
      // reload, a remount) never sees `style.load`; take the epoch now.
      if (instance.isStyleLoaded()) itineraryStyleEpoch += 1;
    });
  });

  /** The itinerary waits for the style instead of throwing mid-load. */
  let itineraryRedrawArmed = false;
  const armItineraryRedraw = (instance: maplibregl.Map, route: RouteResult) => {
    if (itineraryRedrawArmed) return;
    itineraryRedrawArmed = true;
    instance.once('style.load', () => {
      itineraryRedrawArmed = false;
      try {
        drawItinerary(instance, route);
      } catch {
        // The style was replaced again mid-draw; the next `style.load` wins.
      }
    });
  };

  $effect(() => {
    const instance = map;
    const route = routes[selectedRouteIndex];
    // Tracked so a theme swap — which dropped the layers from under the open
    // panel — repaints the route onto the new style.
    const epoch = itineraryStyleEpoch;
    // The drawing follows the selected shop's route, not the panel: closing
    // the panel keeps the itinerary on the map while the shop stays selected.
    if (!instance || !route) {
      clearItinerary(instance);
      return;
    }
    untrack(() => {
      // Before the first style load `addSource` throws; wait for `style.load`.
      if (epoch === 0) {
        armItineraryRedraw(instance, route);
        return;
      }
      try {
        drawItinerary(instance, route);
      } catch {
        armItineraryRedraw(instance, route);
      }
    });
  });

  const closeDialog = () => {
    isOpen = false;
  };

  // Notify the parent when the drawer/panel closes (button close and
  // drag-to-close both land here). The itinerary deliberately stays: the
  // selection, not the panel, decides what the map draws.
  let wasOpen = false;
  $effect(() => {
    if (wasOpen && !isOpen) onClose();
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
      {#if routes.length > 1}
        <!-- Route Tabs -->
        <div class="tabs tabs-border px-4 pt-4">
          {#each routes as route, index (index)}
            <button
              class="tab tab-sm text-nowrap transition {selectedRouteIndex === index
                ? 'tab-active'
                : ''}"
              onclick={() => selectRoute(index)}
            >
              <div class="tooltip tooltip-bottom" data-tip={getRouteSummary(route)}>
                <div class="inline-flex items-center gap-2 text-sm font-medium">
                  {formatDuration(route.durationSeconds)}
                </div>
              </div>
            </button>
          {/each}
        </div>
      {/if}

      {#if routes[selectedRouteIndex]}
        {@const selected = routes[selectedRouteIndex]}
        {@const presentedLegs = buildPresentationLegs(selected.legs)}
        <div class="p-4 md:w-[30vw] md:max-w-lg md:min-w-full">
          <!-- Route Summary -->
          <div class="mb-4 grid gap-4 {showFareStat ? 'grid-cols-3' : 'grid-cols-2'}">
            <div class="stat bg-base-200/50 rounded-lg p-3">
              <div class="stat-title text-xs">{m.travel_time()}</div>
              <div class="stat-value text-lg text-wrap">
                {formatDuration(selected.durationSeconds)}
              </div>
            </div>
            <div class="stat bg-base-200/50 rounded-lg p-3">
              <div class="stat-title text-xs">{m.total_distance()}</div>
              <div class="stat-value text-lg text-wrap">
                {formatDistance(selected.distanceMeters / 1000, 2)}
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
            {#each presentedLegs as leg, legIndex (legIndex)}
              {@const stations = leg.stations}
              {@const nextLeg = presentedLegs[legIndex + 1]}
              <div class="bg-base-200/30 space-y-2 rounded-lg p-3">
                <div class="flex items-center gap-3">
                  <div class="shrink-0">
                    <div
                      class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white shadow-lg {LEG_STYLES[
                        leg.kind
                      ].badge}"
                      style:background-color={leg.color ?? undefined}
                    >
                      <i class="fas {LEG_STYLES[leg.kind].icon} text-xs"></i>
                    </div>
                  </div>
                  <div class="min-w-0 flex-1">
                    <!-- Action-first instruction; the figures follow underneath. -->
                    <div class="text-sm font-medium sm:text-base">
                      {legTitle(leg, nextLeg, selected.mode)}
                    </div>
                    <div class="text-base-content/60 text-xs sm:text-sm">
                      <span>{formatDistance(leg.distanceMeters / 1000, 2)}</span>
                      {#if leg.durationSeconds}
                        <span> · {formatDuration(leg.durationSeconds)}</span>
                      {/if}
                    </div>
                  </div>
                </div>

                {#if stations}
                  <div class="ml-9 space-y-1 text-sm">
                    <div class="flex items-center gap-2">
                      <i class="fas fa-route text-xs"></i>
                      <span class="text-base-content/80">
                        {m.stations({
                          count: stations.stopCount ?? (stations.via?.length ?? 0) + 1
                        })}
                      </span>
                    </div>
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
                          {#each stations.via as stop, stopIndex (stopIndex)}
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
                {/if}

                {#if leg.steps.length > 1}
                  <details class="group ml-9">
                    <summary
                      class="text-base-content/60 hover:text-base-content/80 cursor-pointer text-xs transition-colors"
                    >
                      <i class="fas fa-chevron-right mr-1 transition-transform group-open:rotate-90"
                      ></i>
                      {m.details()} ({leg.steps.length})
                    </summary>
                    <ol class="mt-2 space-y-1.5">
                      {#each leg.steps as step, stepIndex (stepIndex)}
                        <li class="text-base-content/70 text-xs">
                          <span>{step.instruction}</span>
                          {#if step.distanceMeters}
                            <span class="text-base-content/50">
                              · {formatDistance(step.distanceMeters / 1000, 2)}
                            </span>
                          {/if}
                        </li>
                      {/each}
                    </ol>
                  </details>
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
