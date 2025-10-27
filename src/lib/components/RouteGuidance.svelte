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
  import { convertPath, formatDistance, formatDuration, removeRecursiveBrackets } from '$lib/utils';
  import { SELECTED_ROUTE_INDEX } from '$lib/constants';
  import FancyButton from './FancyButton.svelte';

  type ProcessedStep = (WalkingStep | Ride | DrivingStep) & {
    isSignificant?: boolean;
  };

  interface ProcessedSegment {
    name: string;
    distance: number;
    time: number;
    prominentRoad: string;
    steps: ProcessedStep[];
  }

  type ProcessedRoute = (WalkingRoute | RidingRoute | DrivingRoute) & {
    segments: ProcessedSegment[];
  };

  interface Props {
    isOpen?: boolean;
    shop?: Shop | null;
    isLoading?: boolean;
    selectedRouteIndex?: number;
    routeData: TransportSearchResult | null;
    map?: AMap.Map;
    amap?: typeof AMap;
    amapLink?: string;
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
    amap = undefined,
    amapLink = '',
    onClose = () => {},
    onRouteSelected = () => {}
  }: Props = $props();

  let routes: (TransitPlan | WalkingRoute | RidingRoute | DrivingRoute)[] = $state([]);
  let stepPolylines: AMap.Polyline[] = $state([]);

  const preprocessRoute = (route: WalkingRoute | RidingRoute | DrivingRoute): ProcessedRoute => {
    const steps: ProcessedStep[] =
      'steps' in route ? route.steps : 'rides' in route ? route.rides : [];
    if (steps.length === 0) {
      return { ...route, segments: [] };
    }

    // Pass 1: Create initial segments based on road name changes.
    const initialSegments: { steps: ProcessedStep[]; distance: number; time: number }[] = [];
    if (steps.length > 0) {
      initialSegments.push({ steps: [steps[0]], distance: steps[0].distance, time: steps[0].time });
      for (let i = 1; i < steps.length; i++) {
        const currentStep = steps[i];
        const lastSegment = initialSegments[initialSegments.length - 1];
        const lastStepInSegment = lastSegment.steps[lastSegment.steps.length - 1];

        // Group steps with the same road name. Empty roads create new segments.
        if (
          currentStep.road &&
          (currentStep.road === lastStepInSegment.road ||
            currentStep.instruction.includes(lastStepInSegment.road))
        ) {
          lastSegment.steps.push(currentStep);
          lastSegment.distance += currentStep.distance;
          lastSegment.time += currentStep.time;
        } else {
          initialSegments.push({
            steps: [currentStep],
            distance: currentStep.distance,
            time: currentStep.time
          });
        }
      }
    }

    // Pass 2: Merge small, insignificant segments.
    const finalSegments: ProcessedSegment[] = [];
    initialSegments.forEach((segment) => {
      const isSmallSegment = segment.steps.every((step) => !step.road) && segment.time < 90;
      const lastFinalSegment =
        finalSegments.length > 0 ? finalSegments[finalSegments.length - 1] : null;

      // Merge small segments into the previous one.
      if (isSmallSegment && lastFinalSegment) {
        lastFinalSegment.steps.push(...segment.steps);
        lastFinalSegment.distance += segment.distance;
        lastFinalSegment.time += segment.time;
      } else {
        // Otherwise, create a new final segment.
        finalSegments.push({
          name: '',
          steps: segment.steps,
          distance: segment.distance,
          time: segment.time,
          prominentRoad: ''
        });
      }
    });

    // Pass 3: Calculate prominent road for each segment before assigning names.
    finalSegments.forEach((segment) => {
      // Find the most prominent road name in the segment for naming.
      const roadTime: { [key: string]: number } = {};
      let prominentRoad = '';
      let maxTime = 0;

      segment.steps.forEach((step) => {
        if (step.road) {
          roadTime[step.road] = (roadTime[step.road] || 0) + step.time;
          if (roadTime[step.road] > maxTime) {
            maxTime = roadTime[step.road];
            prominentRoad = step.road;
          }
        }
      });

      segment.prominentRoad = prominentRoad;
    });

    // Pass 4: Assign names for the final segments.
    finalSegments.forEach((segment) => {
      if (segment.steps.length === 1) {
        segment.name = segment.steps[0].instruction;
      } else {
        segment.name = segment.prominentRoad;
      }
    });

    // Pass 5: Combine adjacent segments with the same prominent road name.
    if (finalSegments.length > 1) {
      const mergedSegments: ProcessedSegment[] = [];
      let prev: ProcessedSegment | null = null;

      for (const seg of finalSegments) {
        if (
          prev &&
          prev.name &&
          seg.name &&
          (prev.name === seg.name ||
            seg.name.includes(prev.name) ||
            prev.name.includes(seg.name)) &&
          prev.name !== ''
        ) {
          // Merge seg into prev
          prev.steps.push(...seg.steps);
          prev.distance += seg.distance;
          prev.time += seg.time;
        } else {
          mergedSegments.push(seg);
          prev = seg;
        }
      }
      // Replace finalSegments with mergedSegments
      finalSegments.length = 0;
      finalSegments.push(...mergedSegments);
    }

    // Pass 6: Mark significant steps for the merged segments.
    finalSegments.forEach((segment) => {
      // Create deep copies of steps to avoid modifying original state
      segment.steps = segment.steps.map((step) => ({ ...step }));

      // Mark the step with the longest time as significant.
      if (segment.steps.length > 0) {
        const maxTimeIndex = segment.steps.reduce(
          (maxIndex, step, index) => (step.time > segment.steps[maxIndex].time ? index : maxIndex),
          0
        );
        segment.steps[maxTimeIndex].isSignificant = true;
      }
    });

    return { ...route, segments: finalSegments };
  };

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

  // Preprocess routes into a derived state
  const processedRoutes = $derived(
    routes.map((route) => {
      if (!('segments' in route) && ('steps' in route || 'rides' in route)) {
        return preprocessRoute(route as WalkingRoute | RidingRoute | DrivingRoute);
      }
      return route as TransitPlan;
    })
  );

  const transportMethod: TransportMethod = $derived.by(() => {
    if (processedRoutes.length > 0) {
      const firstRoute = processedRoutes[0];
      if ('nightLine' in firstRoute) return 'transit';
      if ('rides' in firstRoute) return 'riding';
      if ('tolls' in firstRoute) return 'driving';
      return 'walking';
    }
    return undefined;
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

  $effect(() => {
    if (map && amap && processedRoutes[selectedRouteIndex] && isOpen) {
      untrack(() => {
        cleanupPolylines(stepPolylines);
        const route = processedRoutes[selectedRouteIndex];
        createStepPolylines(route);
      });
    }
  });

  const createStepPolylines = (route: TransitPlan | ProcessedRoute) => {
    if (!amap || !map) return;

    const newPolylines: AMap.Polyline[] = [];

    if ('segments' in route) {
      if (transportMethod === 'transit') {
        // Transit plan - create polylines for each segment
        (route.segments as Segment[]).forEach((segment, segmentIndex) => {
          if (segment.transit?.path) {
            const polyline = createSegmentPolyline(segment, segmentIndex);
            if (polyline) {
              newPolylines.push(polyline);
            }
          }
        });
      } else {
        // Processed route - create polylines for each step within segments
        (route.segments as ProcessedSegment[]).forEach((segment) => {
          segment.steps.forEach((step, stepIndex) => {
            if (step.path) {
              const polyline = createGenericStepPolyline(step, stepIndex);
              if (polyline) {
                newPolylines.push(polyline);
              }
            }
          });
        });
      }
    }

    stepPolylines = newPolylines;
    if (newPolylines.length > 0) {
      map.setFitView(newPolylines);
    }
  };

  const createGenericStepPolyline = (
    step: ProcessedStep,
    stepIndex: number
  ): AMap.Polyline | null => {
    if (!amap || !map || !step.path) return null;

    const path = Array.isArray(step.path[0])
      ? (step.path as number[][]).map((p) => new amap.LngLat(p[0], p[1]))
      : convertPath(step.path as { lat: number; lng: number }[]);

    let options: Partial<AMap.PolylineOptions>;
    switch (transportMethod) {
      case 'walking':
        options = getWalkingStepPolylineOptions(0, stepIndex);
        break;
      case 'driving':
        options = getDrivingStepPolylineOptions(stepIndex);
        break;
      case 'riding':
        options = getRidingStepPolylineOptions(stepIndex);
        break;
      default:
        options = getBasePolylineOptions(stepIndex);
    }

    const polyline = new amap.Polyline({ path, ...options });
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
    onRouteSelected(index);
  };

  const getRouteSummary = (route: TransitPlan | ProcessedRoute): string => {
    if (transportMethod === 'transit' && 'segments' in route) {
      const transitSegments = (route.segments as Segment[]).filter(
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
    }
    switch (transportMethod) {
      case 'walking':
        return m.walking();
      case 'riding':
        return m.riding();
      case 'driving':
        return m.driving();
      default:
        return '';
    }
  };

  const formatStepInstruction = (
    step: Segment | WalkingStep | Ride | DrivingStep | TransitStep
  ): string => {
    if ('transit_mode' in step) {
      if (step.transit_mode === 'SUBWAY' || step.transit_mode === 'BUS') {
        const lineName = step.transit?.lines?.[0]?.name || '';
        if (lineName) {
          return m.take_line({ line: formatTransitLineName(lineName) });
        }
      }
      return step.instruction;
    }

    return step.instruction || '';
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
    const match = name.match(/^([^（(]*)[（(](.+)[）)](.*)$/);
    if (!match) return name;
    const [, prefix, content, suffix] = match;
    const directionParts = content
      .split(/--+|→|↔/)
      .map((part: string) => part.trim())
      .filter((part) => part.length > 0);
    if (directionParts.length >= 2) {
      return `${prefix.trim()} (${directionParts.join(' → ')})${suffix}`;
    }
    return `${prefix.trim()} (${content})${suffix}`;
  };
</script>

<div
  class="pointer-events-auto fixed z-1000 w-fit transition-transform duration-300 ease-out will-change-transform not-md:right-0 not-md:bottom-0 not-md:left-0 not-md:w-screen not-md:max-w-full md:top-0 md:right-0 md:bottom-0 {shop
    ? 'opacity-100'
    : 'opacity-0'} {isOpen
    ? 'not-md:translate-y-0 md:translate-x-0'
    : 'not-md:translate-y-full md:translate-x-full'}"
>
  <div
    class="flex h-full max-h-[50vh] flex-col overflow-hidden rounded-t-xl transition-all md:max-h-full md:rounded-l-xl md:rounded-tr-none {isOpen
      ? 'shadow-lg/30 hover:shadow-lg/80'
      : 'shadow-lg/0'}"
  >
    <!-- Header -->
    <div class="bg-base-100 flex items-center justify-between gap-2 p-2 md:p-4">
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-base font-semibold not-md:ml-2 md:text-lg">{shop?.name}</h3>
        <p class="text-base-content/70 text-sm not-md:hidden">{m.route_guidance()}</p>
      </div>
      <div class="flex items-center gap-0.5">
        <FancyButton
          href={amapLink}
          target="_blank"
          class="fa-solid fa-arrow-up-right-from-square fa-md"
          btnCls="btn-ghost btn-sm"
          text={m.view_in_amap()}
        />
        <button
          class="btn btn-ghost btn-sm btn-circle"
          onclick={closeDialog}
          aria-label={m.close()}
        >
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
            {#each processedRoutes as route, index (index)}
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
                    {formatDuration(route.time)}
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {/if}

        {#if processedRoutes[selectedRouteIndex]}
          {@const selectedRoute = processedRoutes[selectedRouteIndex]}
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
                  <div class="stat-value text-lg text-wrap">
                    {formatDuration(selectedRoute.time)}
                  </div>
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
              {#if selectedRoute.segments && selectedRoute.segments.length > 0}
                {#if transportMethod === 'transit'}
                  {#each selectedRoute.segments as s, segmentIndex (segmentIndex)}
                    {@const segment = s as Segment}
                    {@const transitDetails = renderTransitSegmentDetails(segment)}
                    {@const walkingSteps = renderWalkingStepDetails(segment)}
                    <div class="bg-base-200/30 space-y-2 rounded-lg p-3">
                      <!-- Main step header -->
                      <div class="flex items-center gap-3">
                        <div class="shrink-0">
                          {#if segment.transit_mode === 'SUBWAY'}
                            <div
                              class="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500 text-sm font-bold text-white shadow-lg"
                            >
                              <i class="fas fa-subway text-xs"></i>
                            </div>
                          {:else if segment.transit_mode === 'BUS'}
                            <div
                              class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white shadow-lg"
                            >
                              <i class="fas fa-bus text-xs"></i>
                            </div>
                          {:else if segment.transit_mode === 'WALK'}
                            <div
                              class="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-sm font-bold text-white shadow-lg"
                            >
                              <i class="fas fa-walking text-xs"></i>
                            </div>
                          {/if}
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="text-sm font-medium sm:text-base">
                            {formatStepInstruction(segment)}
                          </div>
                          <div class="text-base-content/60 text-xs sm:text-sm">
                            <span>{formatDistance(segment.distance / 1000, 2)}</span>
                            {#if segment.time}
                              <span> · {formatDuration(segment.time)}</span>
                            {/if}
                          </div>
                        </div>
                      </div>

                      {#if transitDetails}
                        <div class="ml-9 space-y-2">
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
                          <div class="space-y-1 text-sm">
                            {#if transitDetails.onStation}
                              <div class="flex items-center gap-2">
                                <i class="fas fa-circle-up text-xs text-green-500"></i>
                                <span class="font-medium">{m.board_at()}:</span>
                                <span class="text-base-content/80"
                                  >{transitDetails.onStation.name}</span
                                >
                              </div>
                              {#if transitDetails.entrance}
                                <div class="text-base-content/60 ml-5 text-xs">
                                  {m.entrance()}: {transitDetails.entrance.name}
                                </div>
                              {/if}
                            {/if}
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
                                    <div
                                      class="text-base-content/60 flex items-center gap-2 text-xs"
                                    >
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
                    </div>
                  {/each}
                {:else}
                  {#each selectedRoute.segments as s, segmentIndex (segmentIndex)}
                    {@const segment = s as ProcessedSegment}
                    <div class="bg-base-200/30 space-y-2 rounded-lg p-3">
                      <div class="flex items-center gap-3">
                        <div class="shrink-0">
                          {#if transportMethod === 'walking'}
                            <div
                              class="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-sm font-bold text-white shadow-lg"
                            >
                              <i class="fas fa-walking text-xs"></i>
                            </div>
                          {:else if transportMethod === 'driving'}
                            <div
                              class="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-sm font-bold text-white shadow-lg"
                            >
                              <i class="fas fa-car text-xs"></i>
                            </div>
                          {:else if transportMethod === 'riding'}
                            <div
                              class="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-sm font-bold text-white shadow-lg"
                            >
                              <i class="fas fa-bicycle text-xs"></i>
                            </div>
                          {/if}
                        </div>
                        <div class="min-w-0 flex-1">
                          {#if segment.name}
                            <div class="text-sm font-medium sm:text-base">{segment.name}</div>
                            <div class="text-base-content/60 text-xs sm:text-sm">
                              <span>{formatDistance(segment.distance / 1000, 2)}</span>
                              {#if segment.time}
                                <span> · {formatDuration(segment.time)}</span>
                              {/if}
                            </div>
                          {:else}
                            <div class="text-sm font-medium sm:text-base">
                              <span>{formatDistance(segment.distance / 1000, 2)}</span>
                              {#if segment.time}
                                <span> · {formatDuration(segment.time)}</span>
                              {/if}
                            </div>
                          {/if}
                        </div>
                      </div>

                      {#if segment.steps.length > 1}
                        <div class="ml-9">
                          <details class="group">
                            <summary
                              class="text-base-content/60 hover:text-base-content/80 cursor-pointer text-xs transition-colors"
                            >
                              <i
                                class="fas fa-chevron-down mr-1 transition-transform group-open:rotate-180"
                              ></i>
                              <span class="group-open:hidden"
                                >{m.expand_details()} ({segment.steps.length})</span
                              >
                              <span class="hidden group-open:inline">{m.collapse_details()}</span>
                            </summary>
                            <div class="mt-2 space-y-1 md:space-y-2">
                              {#each segment.steps as step, stepIndex (stepIndex)}
                                <div class="flex items-center gap-2 text-xs sm:text-sm">
                                  <div
                                    class="flex h-6 w-6 shrink-0 items-center justify-center {step.isSignificant
                                      ? 'text-base-content'
                                      : 'text-base-content/80'}"
                                  >
                                    {#if step.orientation}
                                      <span title={step.orientation}>
                                        {#if step.orientation === '东'}
                                          <i class="fa-solid fa-circle-arrow-right"></i>
                                        {:else if step.orientation === '西'}
                                          <i class="fa-solid fa-circle-arrow-left"></i>
                                        {:else if step.orientation === '南'}
                                          <i class="fa-solid fa-circle-arrow-down"></i>
                                        {:else if step.orientation === '北'}
                                          <i class="fa-solid fa-circle-arrow-up"></i>
                                        {:else if step.orientation === '东北'}
                                          <i
                                            class="fa-solid fa-circle-arrow-up"
                                            style="transform: rotate(45deg);"
                                          ></i>
                                        {:else if step.orientation === '东南'}
                                          <i
                                            class="fa-solid fa-circle-arrow-right"
                                            style="transform: rotate(45deg);"
                                          ></i>
                                        {:else if step.orientation === '西南'}
                                          <i
                                            class="fa-solid fa-circle-arrow-down"
                                            style="transform: rotate(45deg);"
                                          ></i>
                                        {:else if step.orientation === '西北'}
                                          <i
                                            class="fa-solid fa-circle-arrow-left"
                                            style="transform: rotate(45deg);"
                                          ></i>
                                        {:else}
                                          {step.orientation}
                                        {/if}
                                      </span>
                                    {:else}
                                      <span><i class="fa-solid fa-circle"></i></span>
                                    {/if}
                                  </div>
                                  <div class="flex-1">
                                    <span
                                      class={step.isSignificant
                                        ? 'text-base-content font-semibold'
                                        : 'text-base-content/80'}>{step.instruction}</span
                                    >
                                    {#if step.isSignificant || step.time > 90}
                                      <div
                                        class="text-xs {step.isSignificant
                                          ? 'text-base-content/80'
                                          : 'text-base-content/60 font-normal'}"
                                      >
                                        <span>{formatDistance(step.distance / 1000, 2)}</span>
                                        {#if step.time}
                                          <span> · {formatDuration(step.time)}</span>
                                        {/if}
                                      </div>
                                    {/if}
                                  </div>
                                </div>
                              {/each}
                            </div>
                          </details>
                        </div>
                      {/if}
                    </div>
                  {/each}
                {/if}
              {/if}
            </div>
          </div>
        {/if}
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
    @apply max-w-[50vw] text-xs text-wrap whitespace-normal sm:px-3 sm:py-2 sm:text-sm md:max-w-[15vw];
  }
</style>
