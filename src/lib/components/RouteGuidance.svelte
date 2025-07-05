<script lang="ts">
  import { untrack } from 'svelte';
  import type { TransportSearchResult, TransportMethod, Shop } from '$lib/types';
  import type {
    TransitPlan,
    WalkingRoute,
    RidingRoute,
    DrivingRoute,
    Segment,
    WalkingStep,
    Ride,
    DrivingStep,
    TransitStep
  } from '$lib/types/amap';
  import { m } from '$lib/paraglide/messages';
  import { convertPath, formatDistance, formatTime, removeRecursiveBrackets } from '$lib/utils';
  import { SELECTED_ROUTE_INDEX } from '$lib/constants';

  interface Props {
    isOpen?: boolean;
    shop?: Shop | null;
    selectedRouteIndex?: number;
    routeData: TransportSearchResult | null;
    transportMethod?: TransportMethod;
    map?: AMap.Map;
    amap?: typeof AMap;
    onClose?: () => void;
    onRouteSelected?: (index: number) => void;
  }

  let {
    isOpen = $bindable(false),
    shop = null,
    selectedRouteIndex = 0,
    routeData = undefined,
    transportMethod = undefined,
    map = undefined,
    amap = undefined,
    onClose = () => {},
    onRouteSelected = () => {}
  }: Props = $props();

  let routes: (TransitPlan | WalkingRoute | RidingRoute | DrivingRoute)[] = $state([]);
  let stepPolylines: AMap.Polyline[] = $state([]);

  const cleanupPolylines = (polylines: AMap.Polyline[]): void => {
    polylines.forEach((polyline) => {
      polyline.setMap(null);
      polyline.destroy();
    });
    polylines.length = 0;
  };

  // Extract routes from the response
  $effect(() => {
    if (routeData && typeof routeData === 'object') {
      if ('plans' in routeData) {
        routes = routeData.plans;
      } else if ('routes' in routeData) {
        routes = routeData.routes;
      } else {
        routes = [];
      }
    } else {
      routes = [];
    }
  });

  // Clean up polylines when component is destroyed or route changes
  $effect(() => {
    return () => {
      cleanupPolylines(stepPolylines);
    };
  });

  // Clean up polylines when dialog closes
  $effect(() => {
    if (!isOpen) {
      untrack(() => {
        cleanupPolylines(stepPolylines);
      });
    }
  });

  // Create step polylines for the selected route
  $effect(() => {
    if (map && amap && routes[selectedRouteIndex] && isOpen) {
      untrack(() => {
        // Clear existing polylines
        cleanupPolylines(stepPolylines);

        const route = routes[selectedRouteIndex];
        createStepPolylines(route);
      });
    }
  });

  const createStepPolylines = (route: TransitPlan | WalkingRoute | RidingRoute | DrivingRoute) => {
    if (!amap || !map) return;

    const newPolylines: AMap.Polyline[] = [];

    if ('segments' in route) {
      // Transit plan - create polylines for each segment
      route.segments.forEach((segment, segmentIndex) => {
        if (segment.transit?.path) {
          const polyline = createSegmentPolyline(segment, segmentIndex);
          if (polyline) {
            newPolylines.push(polyline);
          }
        }
      });
    } else if ('steps' in route) {
      // Walking route or Driving route - create polylines for each step
      route.steps.forEach((step, stepIndex) => {
        if (step.path) {
          const polyline =
            'tolls' in step
              ? createDrivingStepPolyline(step as DrivingStep, stepIndex)
              : createWalkingStepPolyline(step, 0, stepIndex);
          if (polyline) {
            newPolylines.push(polyline);
          }
        }
      });
    } else if ('rides' in route) {
      // Riding route - create polylines for each ride
      route.rides.forEach((ride, rideIndex) => {
        if (ride.path) {
          const polyline = createRidingStepPolyline(ride, rideIndex);
          if (polyline) {
            newPolylines.push(polyline);
          }
        }
      });
    }

    stepPolylines = newPolylines;
    map.setFitView(newPolylines);
  };

  const createDrivingStepPolyline = (
    step: DrivingStep,
    stepIndex: number
  ): AMap.Polyline | null => {
    if (!amap || !map || !step.path) return null;

    const path = step.path.map((point) => new amap.LngLat(point[0], point[1]));
    const options = getDrivingStepPolylineOptions(stepIndex);

    const polyline = new amap.Polyline({
      path,
      ...options
    });

    polyline.setMap(map);
    return polyline;
  };

  const createSegmentPolyline = (segment: Segment, segmentIndex: number): AMap.Polyline | null => {
    if (!amap || !map || !segment.transit?.path) return null;

    const path = convertPath(segment.transit.path);
    const options = getSegmentPolylineOptions(segment, segmentIndex);

    const polyline = new amap.Polyline({
      path,
      ...options
    });

    polyline.setMap(map);
    return polyline;
  };

  const createWalkingStepPolyline = (
    step: WalkingStep | TransitStep,
    segmentIndex: number,
    stepIndex: number
  ): AMap.Polyline | null => {
    if (!amap || !map || !step.path) return null;

    const path = convertPath(step.path);
    const options = getWalkingStepPolylineOptions(segmentIndex, stepIndex);

    const polyline = new amap.Polyline({
      path,
      ...options
    });

    polyline.setMap(map);
    return polyline;
  };

  const createRidingStepPolyline = (ride: Ride, rideIndex: number): AMap.Polyline | null => {
    if (!amap || !map || !ride.path) return null;

    const path = convertPath(ride.path);
    const options = getRidingStepPolylineOptions(rideIndex);

    const polyline = new amap.Polyline({
      path,
      ...options
    });

    polyline.setMap(map);
    return polyline;
  };

  const getBasePolylineOptions = (index: number): Partial<AMap.PolylineOptions> => {
    return {
      strokeOpacity: 1,
      zIndex: SELECTED_ROUTE_INDEX + index,
      lineJoin: 'round' as const,
      lineCap: 'round' as const,
      showDir: true
    };
  };

  const getWalkingStepPolylineOptions = (
    segmentIndex: number,
    stepIndex: number
  ): Partial<AMap.PolylineOptions> => {
    return {
      ...getBasePolylineOptions(segmentIndex * 100 + stepIndex),
      strokeColor: '#f43f5e',
      strokeWeight: 8
    };
  };

  const getSegmentPolylineOptions = (
    segment: Segment,
    segmentIndex: number
  ): Partial<AMap.PolylineOptions> => {
    const baseOptions = getBasePolylineOptions(segmentIndex);

    switch (segment.transit_mode) {
      case 'SUBWAY':
        return {
          ...baseOptions,
          strokeColor: '#8b5cf6',
          strokeWeight: 8
        };
      case 'BUS':
        return {
          ...baseOptions,
          strokeColor: '#3b82f6',
          strokeWeight: 8
        };
      case 'WALK':
        return {
          ...baseOptions,
          strokeColor: '#f43f5e',
          strokeWeight: 6,
          strokeOpacity: 1,
          strokeStyle: 'dashed' as const,
          strokeDasharray: [6, 3],
          showDir: false
        };
      default:
        return {
          ...baseOptions,
          strokeColor: '#6B7280'
        };
    }
  };

  const getRidingStepPolylineOptions = (rideIndex: number): Partial<AMap.PolylineOptions> => {
    return {
      ...getBasePolylineOptions(rideIndex),
      strokeColor: '#f59e0b',
      strokeWeight: 8
    };
  };

  const getDrivingStepPolylineOptions = (stepIndex: number): Partial<AMap.PolylineOptions> => {
    return {
      ...getBasePolylineOptions(stepIndex),
      strokeColor: '#6366f1',
      strokeWeight: 8
    };
  };

  const closeDialog = () => {
    cleanupPolylines(stepPolylines);
    isOpen = false;
    onClose();
  };

  const selectRoute = (index: number) => {
    selectedRouteIndex = index;
    cleanupPolylines(stepPolylines);
    if (map && amap && routes[index]) {
      createStepPolylines(routes[index]);
    }
    onRouteSelected(index);
  };

  const getRouteSummary = (
    route: TransitPlan | WalkingRoute | RidingRoute | DrivingRoute
  ): string => {
    if ('segments' in route) {
      // Transit plan
      const transitSegments = route.segments.filter(
        (s) => s.transit_mode === 'SUBWAY' || s.transit_mode === 'BUS'
      );
      if (transitSegments.length > 0) {
        const lines = transitSegments
          .map((s) => {
            const name = s.transit?.lines?.[0]?.name?.trim();
            if (!name) return '';

            return removeRecursiveBrackets(name);
          })
          .filter(Boolean)
          .join(' → ');
        return lines || m.public_transport();
      }
      return m.public_transport();
    } else if ('steps' in route) {
      return m.walking();
    } else if ('rides' in route) {
      return m.riding();
    } else {
      return m.driving();
    }
  };

  const formatStepInstruction = (
    step: Segment | WalkingStep | Ride | DrivingStep | TransitStep
  ): string => {
    // Handle transit segments
    if ('transit_mode' in step) {
      if (step.transit_mode === 'SUBWAY' || step.transit_mode === 'BUS') {
        const lineName = step.transit?.lines?.[0]?.name || '';
        if (lineName) {
          return m.take_line({ line: formatTransitLineName(lineName) });
        }
      }
      return step.instruction;
    }

    // Handle other step types with action-based instructions
    if ('action' in step && step.action) {
      switch (step.action.toLowerCase()) {
        case 'start':
          return step.instruction || m.walk_to();
        case 'end':
          return m.arrive_at();
        case 'left':
          return m.turn_left();
        case 'right':
          return m.turn_right();
        case 'straight':
          return m.continue_straight();
        default:
          return step.instruction || '';
      }
    }

    return step.instruction || '';
  };

  const getStepDetails = (step: Segment | WalkingStep | Ride | DrivingStep) => {
    const details = [];

    // Handle transit-specific details
    if ('transit' in step && step.transit) {
      if (step.transit.entrance) {
        details.push({ label: m.entrance(), value: step.transit.entrance.name });
      }
      if (step.transit.exit) {
        details.push({ label: m.exit(), value: step.transit.exit.name });
      }
      if (step.transit.via_stops && step.transit.via_stops.length > 0) {
        details.push({
          label: m.via_stop(),
          value: step.transit.via_stops.map((stop) => stop.name).join(', ')
        });
      }
    }

    return details;
  };

  const renderRouteSteps = (
    route: TransitPlan | WalkingRoute | RidingRoute | DrivingRoute
  ): (Segment | WalkingStep | Ride | DrivingStep)[] => {
    if ('segments' in route) {
      return route.segments;
    } else if ('steps' in route) {
      return route.steps;
    } else if ('rides' in route) {
      return route.rides;
    }
    return [];
  };

  const renderTransitSegmentDetails = (segment: Segment) => {
    if (segment.transit_mode === 'SUBWAY' || segment.transit_mode === 'BUS') {
      const transit = segment.transit;
      const line = transit?.lines?.[0];
      const stationCount = transit?.via_num || 0;

      return {
        lineName: line?.name || '',
        lineType: segment.transit_mode,
        onStation: transit?.on_station,
        offStation: transit?.off_station,
        viaStops: transit?.via_stops || [],
        stationCount,
        entrance: transit?.entrance,
        exit: transit?.exit
      };
    }
    return null;
  };

  const renderWalkingStepDetails = (segment: Segment) => {
    if (segment.transit_mode === 'WALK' && segment.transit?.steps) {
      return segment.transit.steps;
    }
    return [];
  };

  const formatTransitLineName = (name: string, preserveDirection: boolean = false) => {
    if (!preserveDirection) {
      return removeRecursiveBrackets(name);
    }

    // Handle nested parentheses by finding the outermost parentheses
    const match = name.match(/^([^（(]*)[（(](.+)[）)](.*)$/);
    if (!match) return name;

    const [, prefix, content, suffix] = match;

    // Split the content by direction separators
    const directionParts = content
      .split(/--+|→|↔/)
      .map((part: string) => {
        return part.trim();
      })
      .filter((part) => part.length > 0);

    if (directionParts.length >= 2) {
      return `${prefix.trim()} (${directionParts.join(' → ')})${suffix}`;
    }

    return `${prefix.trim()} (${content})${suffix}`;
  };
</script>

<div
  class="pointer-events-auto fixed z-[1000] w-fit transition-transform duration-300 ease-out will-change-transform not-md:right-0 not-md:bottom-0 not-md:left-0 not-md:w-screen not-md:max-w-full md:top-0 md:right-0 md:bottom-0 {shop
    ? 'opacity-100'
    : 'opacity-0'} {isOpen
    ? 'not-md:translate-y-0 md:translate-x-0'
    : 'not-md:translate-y-full md:translate-x-full'}"
>
  <div
    class="flex h-full max-h-[60vh] flex-col overflow-hidden rounded-t-xl transition-all md:max-h-full md:rounded-l-xl md:rounded-tr-none {isOpen
      ? 'shadow-lg/30 hover:shadow-lg/80'
      : 'shadow-lg/0'}"
  >
    <!-- Header -->
    <div class="bg-base-100 flex items-center justify-between p-4">
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-lg font-semibold">{shop?.name}</h3>
        <p class="text-base-content/70 text-sm">{m.route_guidance()}</p>
      </div>
      <button class="btn btn-ghost btn-sm btn-circle" onclick={closeDialog} aria-label={m.close()}>
        <i class="fa-solid fa-xmark fa-lg"></i>
      </button>
    </div>

    <!-- Content -->
    <div class="bg-base-100/40 flex-1 overflow-x-hidden overflow-y-auto backdrop-blur-3xl">
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
                  {#if 'nightLine' in route && route.nightLine}
                    <i class="fa-solid fa-moon"></i>
                  {/if}
                  {formatTime(route.time)}
                </div>
              </div>
            </button>
          {/each}
        </div>
      {/if}

      {#if routes[selectedRouteIndex]}
        {@const selectedRoute = routes[selectedRouteIndex]}
        <div class="p-4 md:w-[30vw] md:max-w-lg md:min-w-full">
          <!-- Route Summary -->
          <div class="mb-4 grid grid-cols-2 gap-4">
            {#if 'cost' in selectedRoute && selectedRoute.cost > 0}
              <div class="stat bg-base-200/50 rounded-lg p-3">
                <div class="stat-title text-xs">{m.cost()}</div>
                <div class="stat-value text-lg text-wrap">
                  {m.cost_cny({ cost: selectedRoute.cost })}
                </div>
              </div>
            {:else}
              <div class="stat bg-base-200/50 rounded-lg p-3">
                <div class="stat-title text-xs">{m.travel_time()}</div>
                <div class="stat-value text-lg text-wrap">{formatTime(selectedRoute.time)}</div>
              </div>
            {/if}
            <div class="stat bg-base-200/50 rounded-lg p-3">
              <div class="stat-title text-xs">{m.total_distance()}</div>
              <div class="stat-value text-lg text-wrap">
                {formatDistance(selectedRoute.distance / 1000, 2)}
              </div>
            </div>
          </div>

          <!-- Route Steps -->
          <div class="space-y-3">
            <h4 class="text-sm font-medium">{m.route_steps()}</h4>
            {#if renderRouteSteps(selectedRoute).length > 0}
              {#each renderRouteSteps(selectedRoute) as step, stepIndex (stepIndex)}
                {@const isTransitSegment = 'transit_mode' in step}
                {@const transitDetails = isTransitSegment
                  ? renderTransitSegmentDetails(step)
                  : null}
                {@const walkingSteps = isTransitSegment ? renderWalkingStepDetails(step) : []}

                <div class="bg-base-200/30 space-y-2 rounded-lg p-3">
                  <!-- Main step header -->
                  <div class="flex items-center gap-3">
                    <div class="flex-shrink-0">
                      {#if transportMethod === 'transit' && isTransitSegment && step.transit_mode === 'SUBWAY'}
                        <div
                          class="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500 text-sm font-bold text-white shadow-lg"
                        >
                          <i class="fas fa-subway text-xs"></i>
                        </div>
                      {:else if transportMethod === 'transit' && isTransitSegment && step.transit_mode === 'BUS'}
                        <div
                          class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white shadow-lg"
                        >
                          <i class="fas fa-bus text-xs"></i>
                        </div>
                      {:else if transportMethod === 'walking' || (isTransitSegment ? step.transit_mode === 'WALK' : 'assistant_action' in step && !('tolls' in step))}
                        <div
                          class="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-sm font-bold text-white shadow-lg"
                        >
                          <i class="fas fa-walking text-xs"></i>
                        </div>
                      {:else if transportMethod === 'driving' || (!isTransitSegment && 'tolls' in step)}
                        <div
                          class="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-sm font-bold text-white shadow-lg"
                        >
                          <i class="fas fa-car text-xs"></i>
                        </div>
                      {:else if transportMethod === 'riding' || (!isTransitSegment && !('assistant_action' in step))}
                        <div
                          class="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-sm font-bold text-white shadow-lg"
                        >
                          <i class="fas fa-bicycle text-xs"></i>
                        </div>
                      {:else}
                        <div
                          class="bg-primary text-primary-content flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold shadow-lg"
                        >
                          {stepIndex + 1}
                        </div>
                      {/if}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="text-md font-medium">{formatStepInstruction(step)}</div>
                      <div class="text-base-content/60 text-xs md:text-sm">
                        <span>{formatDistance(step.distance / 1000, 2)}</span>
                        {#if step.time}
                          <span> · {formatTime(step.time)}</span>
                        {/if}
                      </div>
                    </div>
                  </div>

                  <!-- Transit details -->
                  {#if transitDetails}
                    <div class="ml-9 space-y-2">
                      <!-- Line information -->

                      <div class="flex items-center gap-2 text-sm">
                        <i class="fas fa-route text-xs"></i>
                        <div class="text-base-content/80">
                          {#if transitDetails.lineName}
                            <span class="font-medium"
                              >{formatTransitLineName(transitDetails.lineName, true)} ·
                            </span>
                          {/if}
                          <span
                            >{transitDetails.lineType === 'SUBWAY'
                              ? m.stations({ count: transitDetails.stationCount + 1 })
                              : m.stops({ count: transitDetails.stationCount + 1 })}</span
                          >
                        </div>
                      </div>

                      <!-- Station journey -->
                      <div class="space-y-1 text-sm">
                        {#if transitDetails.onStation}
                          <div class="flex items-center gap-2">
                            <i class="fas fa-circle-up text-xs text-green-500"></i>
                            <span class="font-medium">{m.board_at()}:</span>
                            <span class="text-base-content/80">{transitDetails.onStation.name}</span
                            >
                          </div>
                          {#if transitDetails.entrance}
                            <div class="text-base-content/60 ml-5 text-xs">
                              {m.entrance()}: {transitDetails.entrance.name}
                            </div>
                          {/if}
                        {/if}

                        <!-- Via stops (collapsible) -->
                        {#if transitDetails.viaStops.length > 0}
                          <details class="group ml-5">
                            <summary
                              class="text-base-content/60 hover:text-base-content/80 cursor-pointer text-xs transition-colors"
                            >
                              <i
                                class="fas fa-chevron-right mr-1 transition-transform group-open:rotate-90"
                              ></i>
                              {m.via_stops({ count: transitDetails.viaStops.length })}
                            </summary>
                            <div class="mt-2 ml-4 space-y-1">
                              {#each transitDetails.viaStops as stop (stop.id)}
                                <div class="text-base-content/60 flex items-center gap-2 text-xs">
                                  <i class="fas fa-circle text-xs opacity-30"></i>
                                  {stop.name}
                                </div>
                              {/each}
                            </div>
                          </details>
                        {/if}

                        {#if transitDetails.offStation}
                          <div class="flex items-center gap-2">
                            <i class="fas fa-circle-down text-xs text-red-500"></i>
                            <span class="font-medium">{m.alight_at()}:</span>
                            <span class="text-base-content/80"
                              >{transitDetails.offStation.name}</span
                            >
                          </div>
                          {#if transitDetails.exit}
                            <div class="text-base-content/60 ml-5 text-xs">
                              {m.exit()}: {transitDetails.exit.name}
                            </div>
                          {/if}
                        {/if}
                      </div>
                    </div>
                  {/if}

                  <!-- Walking steps details -->
                  {#if walkingSteps.length > 0}
                    <div class="ml-9">
                      <details class="group">
                        <summary
                          class="text-base-content/60 hover:text-base-content/80 cursor-pointer text-xs transition-colors"
                        >
                          <i
                            class="fas fa-chevron-down mr-1 transition-transform group-open:rotate-180"
                          ></i>
                          <span class="group-open:hidden"
                            >{m.expand_details()} ({walkingSteps.length})</span
                          >
                          <span class="hidden group-open:inline">{m.collapse_details()}</span>
                        </summary>
                        <div class="mt-2 space-y-1">
                          {#each walkingSteps as walkStep, walkStepIndex (walkStepIndex)}
                            <div class="text-base-content/60 flex items-center gap-2 text-xs">
                              <div
                                class="bg-base-300 text-base-content/80 flex h-4 w-4 items-center justify-center rounded-full text-xs"
                              >
                                {walkStepIndex + 1}
                              </div>
                              <span>{formatStepInstruction(walkStep)}</span>
                            </div>
                          {/each}
                        </div>
                      </details>
                    </div>
                  {/if}

                  <!-- Non-transit step details -->
                  {#if !isTransitSegment}
                    {#each getStepDetails(step) as detail, i (i)}
                      <div class="text-base-content/60 ml-9 text-xs">
                        {detail.label}: {detail.value}
                      </div>
                    {/each}
                  {/if}
                </div>
              {/each}
            {:else}
              <div class="text-base-content/50 py-8 text-center">
                <i class="fas fa-info-circle mb-2"></i>
                <p class="text-sm">{m.loading()}</p>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style lang="postcss">
  @reference "tailwindcss";

  summary {
    @apply cursor-pointer list-none select-none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .tooltip:before {
    @apply max-w-[50vw] px-3 py-2 text-wrap whitespace-normal md:max-w-[15vw];
  }
</style>
