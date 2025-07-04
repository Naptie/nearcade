<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import type { TransportSearchResult, TransportMethod, Shop } from '$lib/types';
  import type {
    TransitPlan,
    WalkingRoute,
    RidingRoute,
    DrivingRoute,
    Segment,
    WalkingStep,
    Ride,
    DrivingStep
  } from '$lib/types/amap';
  import { m } from '$lib/paraglide/messages';
  import { formatDistance, formatTime } from '$lib/utils';

  interface Props {
    isOpen?: boolean;
    shop?: Shop | null;
    routeData: TransportSearchResult | null;
    transportMethod?: TransportMethod;
    isMobile?: boolean;
  }

  let {
    isOpen = $bindable(false),
    shop = null,
    routeData = undefined,
    transportMethod = undefined,
    isMobile = false
  }: Props = $props();

  const dispatch = createEventDispatcher();

  let selectedRouteIndex = $state(0);
  let dialogElement: HTMLDialogElement | undefined = $state(undefined);
  let routes: (TransitPlan | WalkingRoute | RidingRoute | DrivingRoute)[] = $state([]);
  let scrollY = $state(0);
  let lastScrollY = $state(0);
  let isDrawerVisible = $state(true);

  // Desktop dialog position and size
  let dialogPosition = $state({
    x: typeof window !== 'undefined' ? window.innerWidth - 420 : 0,
    y: 100
  });
  let dialogSize = $state({ width: 400, height: 600 });
  let isDragging = $state(false);
  let isResizing = $state(false);
  let dragStart = $state({ x: 0, y: 0 });
  let resizeStart = $state({ x: 0, y: 0, width: 0, height: 0 });

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

  // Auto-hide drawer on mobile based on scroll
  $effect(() => {
    if (isMobile && isOpen) {
      const delta = scrollY - lastScrollY;
      if (Math.abs(delta) > 5) {
        isDrawerVisible = delta < 0 || scrollY < 100;
        lastScrollY = scrollY;
      }
    }
  });

  const handleScroll = () => {
    scrollY = window.scrollY;
  };

  const closeDialog = () => {
    isOpen = false;
    dispatch('close');
  };

  const selectRoute = (index: number) => {
    selectedRouteIndex = index;
    dispatch('routeSelected', { index, route: routes[index] });
  };

  // Desktop drag functionality
  const handleMouseDown = (e: MouseEvent) => {
    if (isMobile) return;
    const target = e.target as HTMLElement;
    if (target.classList.contains('dialog-header')) {
      isDragging = true;
      dragStart = { x: e.clientX - dialogPosition.x, y: e.clientY - dialogPosition.y };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    } else if (target.classList.contains('resize-handle')) {
      isResizing = true;
      resizeStart = {
        x: e.clientX,
        y: e.clientY,
        width: dialogSize.width,
        height: dialogSize.height
      };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      dialogPosition = {
        x: Math.max(0, Math.min(window.innerWidth - dialogSize.width, e.clientX - dragStart.x)),
        y: Math.max(0, Math.min(window.innerHeight - dialogSize.height, e.clientY - dragStart.y))
      };
    } else if (isResizing) {
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;
      dialogSize = {
        width: Math.max(300, Math.min(800, resizeStart.width + deltaX)),
        height: Math.max(400, Math.min(window.innerHeight - 100, resizeStart.height + deltaY))
      };
    }
  };

  const handleMouseUp = () => {
    isDragging = false;
    isResizing = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
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
          .map((s) => s.transit.lines?.[0]?.name)
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

  const formatStepInstruction = (step: Segment | WalkingStep | Ride | DrivingStep): string => {
    // Handle transit segments
    if ('transit_mode' in step) {
      if (step.transit_mode === 'SUBWAY' || step.transit_mode === 'BUS') {
        const lineName = step.transit?.lines?.[0]?.name || '';
        if (lineName) {
          return m.take_line({ line: lineName });
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

    // Handle road information
    if ('road' in step && step.road) {
      details.push({ label: 'Road', value: step.road });
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

  onMount(() => {
    if (isMobile) {
      window.addEventListener('scroll', handleScroll, { passive: true });
    }
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
  });

  $effect(() => {
    console.log(isOpen, dialogElement);
    if (isOpen && dialogElement) {
      dialogElement.showModal();
    } else if (!isOpen && dialogElement) {
      dialogElement.close();
    }
  });
</script>

{#if isOpen && shop}
  {#if isMobile}
    <!-- Mobile Semi-Drawer -->
    <div
      class="fixed right-0 bottom-0 left-0 z-50 transform transition-transform duration-300 ease-in-out {isDrawerVisible
        ? 'translate-y-0'
        : 'translate-y-full'}"
    >
      <div
        class="bg-base-100 border-base-300 max-h-[60vh] overflow-hidden rounded-t-xl border-t shadow-xl"
      >
        <!-- Header -->
        <div class="border-base-300 flex items-center justify-between border-b p-4">
          <div class="flex-1">
            <h3 class="truncate text-lg font-semibold">{shop.name}</h3>
            <p class="text-base-content/70 text-sm">{m.route_guidance()}</p>
          </div>
          <button
            class="btn btn-ghost btn-sm btn-circle"
            onclick={closeDialog}
            aria-label={m.close()}
          >
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Content -->
        <div class="max-h-[calc(60vh-80px)] overflow-y-auto">
          {#if routes.length > 1}
            <!-- Route Tabs -->
            <div class="tabs tabs-bordered px-4 pt-4">
              {#each routes as route, index}
                <button
                  class="tab tab-sm {selectedRouteIndex === index ? 'tab-active' : ''}"
                  onclick={() => selectRoute(index)}
                >
                  <div class="text-xs">
                    <div class="font-medium">{formatTime(route.time)}</div>
                    <div class="text-base-content/60">{getRouteSummary(route)}</div>
                  </div>
                </button>
              {/each}
            </div>
          {/if}

          {#if routes[selectedRouteIndex]}
            {@const selectedRoute = routes[selectedRouteIndex]}
            <div class="p-4">
              <!-- Route Summary -->
              <div class="mb-4 grid grid-cols-2 gap-4">
                <div class="stat bg-base-200/50 rounded-lg p-3">
                  <div class="stat-title text-xs">{m.travel_time()}</div>
                  <div class="stat-value text-lg">{formatTime(selectedRoute.time)}</div>
                </div>
                <div class="stat bg-base-200/50 rounded-lg p-3">
                  <div class="stat-title text-xs">{m.total_distance()}</div>
                  <div class="stat-value text-lg">
                    {formatDistance(selectedRoute.distance / 1000, 1)}
                  </div>
                </div>
              </div>

              <!-- Route Steps -->
              <div class="space-y-3">
                <h4 class="text-sm font-medium">{m.route_steps()}</h4>
                {#if renderRouteSteps(selectedRoute).length > 0}
                  {#each renderRouteSteps(selectedRoute) as step, stepIndex}
                    <div class="bg-base-200/30 flex gap-3 rounded-lg p-3">
                      <div
                        class="bg-primary text-primary-content flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium"
                      >
                        {stepIndex + 1}
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="text-sm font-medium">{formatStepInstruction(step)}</div>
                        {#each getStepDetails(step) as detail}
                          <div class="text-base-content/60 mt-1 text-xs">
                            {detail.label}: {detail.value}
                          </div>
                        {/each}
                        <div class="text-base-content/60 mt-1 flex gap-3 text-xs">
                          <span>{formatDistance(step.distance / 1000, 1)}</span>
                          {#if step.time}
                            <span>{formatTime(step.time)}</span>
                          {/if}
                        </div>
                      </div>
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
  {:else}
    <!-- Desktop Dialog -->
    <dialog bind:this={dialogElement} class="modal" onmousedown={handleMouseDown}>
      <div
        class="bg-base-100 border-base-300 overflow-hidden rounded-xl border shadow-xl"
        style="position: fixed; left: {dialogPosition.x}px; top: {dialogPosition.y}px; width: {dialogSize.width}px; height: {dialogSize.height}px;"
      >
        <!-- Header -->
        <div
          class="dialog-header border-base-300 flex cursor-move items-center justify-between border-b p-4"
        >
          <div class="min-w-0 flex-1">
            <h3 class="truncate text-lg font-semibold">{shop.name}</h3>
            <p class="text-base-content/70 text-sm">{m.route_guidance()}</p>
          </div>
          <button
            class="btn btn-ghost btn-sm btn-circle"
            onclick={closeDialog}
            aria-label={m.close()}
          >
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Content -->
        <div class="flex h-full flex-col">
          {#if routes.length > 1}
            <!-- Route Tabs -->
            <div class="tabs tabs-bordered flex-shrink-0 px-4 pt-4">
              {#each routes as route, index}
                <button
                  class="tab {selectedRouteIndex === index ? 'tab-active' : ''}"
                  onclick={() => selectRoute(index)}
                >
                  <div class="text-sm">
                    <div class="font-medium">{formatTime(route.time)}</div>
                    <div class="text-base-content/60 text-xs">{getRouteSummary(route)}</div>
                  </div>
                </button>
              {/each}
            </div>
          {/if}

          {#if routes[selectedRouteIndex]}
            {@const selectedRoute = routes[selectedRouteIndex]}
            <div class="flex-1 overflow-y-auto p-4">
              <!-- Route Summary -->
              <div class="mb-4 grid grid-cols-2 gap-4">
                <div class="stat bg-base-200/50 rounded-lg p-3">
                  <div class="stat-title text-xs">{m.travel_time()}</div>
                  <div class="stat-value text-lg">{formatTime(selectedRoute.time)}</div>
                </div>
                <div class="stat bg-base-200/50 rounded-lg p-3">
                  <div class="stat-title text-xs">{m.total_distance()}</div>
                  <div class="stat-value text-lg">
                    {formatDistance(selectedRoute.distance / 1000, 1)}
                  </div>
                </div>
              </div>

              <!-- Route Steps -->
              <div class="space-y-3">
                <h4 class="font-medium">{m.route_steps()}</h4>
                {#if renderRouteSteps(selectedRoute).length > 0}
                  {#each renderRouteSteps(selectedRoute) as step, stepIndex}
                    <div class="bg-base-200/30 flex gap-3 rounded-lg p-3">
                      <div
                        class="bg-primary text-primary-content flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium"
                      >
                        {stepIndex + 1}
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="font-medium">{formatStepInstruction(step)}</div>
                        {#each getStepDetails(step) as detail}
                          <div class="text-base-content/60 mt-1 text-sm">
                            {detail.label}: {detail.value}
                          </div>
                        {/each}
                        <div class="text-base-content/60 mt-1 flex gap-3 text-sm">
                          <span>{formatDistance(step.distance / 1000, 1)}</span>
                          {#if step.time}
                            <span>{formatTime(step.time)}</span>
                          {/if}
                        </div>
                      </div>
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

        <!-- Resize Handle -->
        <div class="resize-handle absolute right-0 bottom-0 h-4 w-4 cursor-se-resize">
          <i class="fas fa-grip-lines-vertical text-base-content/40 text-xs"></i>
        </div>
      </div>
    </dialog>
  {/if}
{/if}

<style>
  .resize-handle {
    background: linear-gradient(-45deg, transparent 40%, currentColor 50%, transparent 60%);
  }
</style>
