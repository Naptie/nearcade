<script lang="ts">
  import type {
    Game,
    AMapContext,
    Shop,
    TransportMethod,
    AMapTransportSearchResult
  } from '$lib/types';
  import { m } from '$lib/paraglide/messages';
  import { onMount, onDestroy, getContext, untrack } from 'svelte';
  import { formatDistance, formatTime, isDarkMode } from '$lib/utils';
  import { browser } from '$app/environment';

  let { data } = $props();

  const HOVERED_SHOP_INDEX = 3002;
  const SELECTED_SHOP_INDEX = 3001;
  const ORIGIN_INDEX = 3000;
  const SHOP_INDEX = 2000;
  const HOVERED_ROUTE_INDEX = 1999;
  const SELECTED_ROUTE_INDEX = 1998;
  const ROUTE_INDEX = 1000;

  let screenWidth = $state(0);

  const amapContext = getContext<AMapContext>('amap');
  let amap = $derived(amapContext?.amap);
  let amapReady = $derived(amapContext?.ready ?? false);
  let amapError = $derived(amapContext?.error ?? null);
  let amapContainer: HTMLDivElement | undefined = $state(undefined);
  let map: AMap.Map | undefined = $state(undefined);
  let markers: Record<number, { marker: AMap.Marker; zIndex: number }> = $state({});

  let hoveredShopId: number | null = $state(null);
  let selectedShopId: number | null = $state(null);
  let highlightedShopId: number | null = $state(null);
  let highlightedShopIdTimeout: number | null = $state(null);
  let darkMode = $derived(browser ? isDarkMode() : undefined);
  let transportMethod = $state<TransportMethod>(undefined); // 'transit', 'walking', 'riding', 'driving'
  let travelData = $state<
    Record<
      number,
      {
        time: number;
        distance: number;
        path: { latitude: number; longitude: number }[];
        route: AMap.Polyline;
      } | null
    >
  >({}); // shopId -> travel data
  let trafficLayer: AMap.CoreVectorLayer | undefined = $state(undefined);

  let avgTravelTime = $derived.by(() => {
    if (!transportMethod) return 0;
    const times = Object.values(travelData)
      .filter((data) => data !== null)
      .map((data) => data!.time);
    return times.length > 0 ? times.reduce((sum, time) => sum + time, 0) / times.length : 0;
  });

  let avgTravelDistance = $derived.by(() => {
    if (!transportMethod)
      return data.shops.reduce((sum, shop) => sum + shop.distance, 0) / data.shops.length;
    const distances = Object.values(travelData)
      .filter((data) => data !== null)
      .map((data) => data!.distance);
    return distances.length > 0
      ? distances.reduce((sum, dist) => sum + dist, 0) / distances.length
      : 0;
  });

  let sortedShops = $derived.by(() => {
    if (!transportMethod) {
      return data.shops;
    }

    return [...data.shops].sort((a, b) => {
      const dataA = travelData[a.id];
      const dataB = travelData[b.id];

      if (dataA && dataB) {
        if (dataA.time !== dataB.time) return dataA.time - dataB.time;
        if (dataA.distance !== dataB.distance) return dataA.distance - dataB.distance;
        return a.distance - b.distance;
      }

      if (dataA) return -1;
      if (dataB) return 1;
      return a.distance - b.distance;
    });
  });

  let machineCount = $derived.by(() => {
    return sortedShops.reduce(
      (total, shop) =>
        total + shop.games.reduce((total: number, game: Game) => total + game.quantity, 0),
      0
    );
  });

  const getRouteOptions = (id: number): Partial<AMap.PolylineOptions> => {
    const isSelected = selectedShopId === id;
    const isHovered = hoveredShopId === id;
    return {
      strokeColor: isSelected ? 'lime' : isHovered ? 'orange' : 'cyan',
      strokeWeight: isSelected ? 3.8 : isHovered ? 4.2 : 3,
      strokeOpacity: isSelected || isHovered ? 1 : 0.4,
      lineJoin: 'round',
      zIndex: isSelected ? SELECTED_ROUTE_INDEX : isHovered ? HOVERED_ROUTE_INDEX : ROUTE_INDEX
    };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let plugins: Record<string, any> = $state({});

  const calculateTravelData = async (method: NonNullable<TransportMethod>) => {
    if (!amap || !amapReady || !data || data.shops.length === 0) return;
    travelData = {};

    const pluginName =
      method === 'transit'
        ? 'AMap.Transfer'
        : method === 'walking'
          ? 'AMap.Walking'
          : method === 'riding'
            ? 'AMap.Riding'
            : 'AMap.Driving';

    if (!(method in plugins)) {
      await new Promise<void>((resolve) => {
        amap.plugin([pluginName], () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const a = amap as any;
          if (method === 'transit') {
            plugins[method] = new a.Transfer({ city: ' ' });
          } else if (method === 'walking') {
            plugins[method] = new a.Walking();
          } else if (method === 'riding') {
            plugins[method] = new a.Riding();
          } else {
            plugins[method] = new a.Driving();
          }
          resolve();
        });
      });
    }

    const plugin = plugins[method];

    const processShop = async (shop: Shop, retryCount = 0): Promise<void> => {
      return new Promise((resolve) => {
        const origin = new amap.LngLat(data.location.longitude, data.location.latitude);
        const destination = new amap.LngLat(
          shop.location.coordinates[0],
          shop.location.coordinates[1]
        );

        try {
          plugin.search(
            origin,
            destination,
            (status: string, result: AMapTransportSearchResult) => {
              console.debug(result);
              if (
                status === 'complete' &&
                typeof result === 'object' &&
                ((result.plans && result.plans.length > 0) ||
                  (result.routes && result.routes.length > 0))
              ) {
                const plans = result.plans ?? result.routes;
                const minTimeIndex = plans.reduce((minIndex: number, plan, index: number) => {
                  return (plan.time || Infinity) < (plans[minIndex].time || Infinity)
                    ? index
                    : minIndex;
                }, 0);

                const bestPlan = plans[minTimeIndex];
                const path = bestPlan.path
                  ? bestPlan.path.map((point: { lat: number; lng: number }) => ({
                      latitude: point.lat,
                      longitude: point.lng
                    }))
                  : ('steps' in bestPlan ? bestPlan.steps : bestPlan.rides)
                      .map((step: { path: { lat: number; lng: number }[] }) =>
                        step.path.map((point: { lat: number; lng: number }) => ({
                          latitude: point.lat,
                          longitude: point.lng
                        }))
                      )
                      .flat();
                const route = new amap.Polyline({
                  path: path.map((point) => new amap.LngLat(point.longitude, point.latitude)),
                  ...getRouteOptions(shop.id)
                });
                route.on('mouseover', () => {
                  hoveredShopId = shop.id;
                });
                route.on('mouseout', () => {
                  if (hoveredShopId === shop.id) {
                    hoveredShopId = null;
                  }
                });
                route.on('click', () => {
                  selectedShopId = shop.id;
                });
                map?.add(route);
                travelData[shop.id] = {
                  time: bestPlan.time ?? 0,
                  distance: bestPlan.distance ? bestPlan.distance / 1000 : 0,
                  path,
                  route
                };
                resolve();
              } else if (
                typeof result !== 'object' &&
                ['CUQPS_HAS_EXCEEDED_THE_LIMIT', 'Request Error', undefined].includes(result) &&
                retryCount < 10
              ) {
                // Rate limit exceeded, add to end of queue for retry
                setTimeout(() => {
                  processShop(shop, retryCount + 1).then(resolve);
                }, 1000); // Wait 1 second before retry
              } else {
                console.error(result);
                travelData[shop.id] = null;
                resolve();
              }
            }
          );
        } catch (error) {
          console.error(`Error calculating travel data for shop ${shop.id}:`, error);
          travelData[shop.id] = null;
          resolve();
        }
      });
    };

    // Process shops sequentially to avoid rate limiting
    // Process selected shop first if exists, then process remaining shops
    for (const shop of [
      ...data.shops.filter((shop) => shop.id === selectedShopId),
      ...data.shops.filter((shop) => shop.id !== selectedShopId)
    ]) {
      await processShop(shop);
    }

    map?.setFitView();
  };

  const findGame = (games: Game[], gameId: number): Game | null => {
    return games?.find((game) => game.id === gameId) || null;
  };

  const allGames = [
    { id: 1, name: m.maimai_dx() },
    { id: 3, name: m.chunithm() },
    { id: 31, name: m.taiko_no_tatsujin() },
    { id: 4, name: m.sound_voltex() },
    { id: 17, name: m.wacca() }
  ];

  const visibleGames = $derived.by(() => {
    if (screenWidth < 480) return []; // 2xs: no games
    if (screenWidth < 640) return allGames.slice(0, 1); // xs: 1 game
    if (screenWidth < 768) return allGames.slice(0, 2); // sm: 2 games
    if (screenWidth < 1024) return allGames.slice(0, 3); // md: 3 games
    if (screenWidth < 1280) return allGames.slice(0, 4); // lg: 4 games
    return allGames; // xl: all 5 games
  });

  const handleResize = () => {
    screenWidth = window.innerWidth;
  };

  onMount(() => {
    screenWidth = window.innerWidth;
    window.addEventListener('resize', handleResize);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', handleResize);
    }
  });

  $effect(() => {
    if (!amap || !amapReady || !data || !amapContainer || darkMode === undefined) return;
    untrack(() => {
      map = new amap.Map(amapContainer!.id, {
        zoom: 10,
        center: [data.location.longitude, data.location.latitude],
        mapStyle: darkMode ? 'amap://styles/dark' : 'amap://styles/light',
        viewMode: '2D'
      });

      const origin = new amap.Marker({
        position: [data.location.longitude, data.location.latitude],
        title: m.origin(),
        content: '<i class="fa-solid fa-location-crosshairs fa-lg"></i>',
        offset: new amap.Pixel(-9.375, -10),
        label: {
          content: m.origin(),
          offset: new amap.Pixel(2, -5),
          direction: 'right'
        },
        zIndex: ORIGIN_INDEX
      });
      origin.setMap(map);

      data.shops.forEach((shop) => {
        const minLat = Math.min(...data.shops.map((s) => s.location.coordinates[1]));
        const maxLat = Math.max(...data.shops.map((s) => s.location.coordinates[1]));
        const minLng = Math.min(...data.shops.map((s) => s.location.coordinates[0]));
        const maxLng = Math.max(...data.shops.map((s) => s.location.coordinates[0]));

        const normalizedLat = (shop.location.coordinates[1] - minLat) / (maxLat - minLat) || 0;
        const normalizedLng = (shop.location.coordinates[0] - minLng) / (maxLng - minLng) || 0;
        const zIndex =
          Math.floor((1 - normalizedLat) * 700 + (1 - normalizedLng) * 300) + SHOP_INDEX;

        const marker = new amap.Marker({
          position: shop.location.coordinates,
          title: shop.name,
          content: `<i id="shop-marker-${shop.id}" class="text-info dark:text-success fa-solid fa-location-dot fa-lg"></i>`,
          offset: new amap.Pixel(-7.03, -20),
          label: {
            content: shop.name,
            offset: new amap.Pixel(2, -5),
            direction: 'right'
          },
          zIndex
        });

        markers[shop.id] = { marker, zIndex };

        marker.on('mouseover', () => {
          hoveredShopId = shop.id;
        });
        marker.on('mouseout', () => {
          if (hoveredShopId === shop.id) {
            hoveredShopId = null;
          }
        });
        marker.on('click', () => {
          selectedShopId = shop.id;
          highlightedShopId = shop.id;
          if (highlightedShopIdTimeout) {
            clearTimeout(highlightedShopIdTimeout);
          }
          highlightedShopIdTimeout = setTimeout(() => {
            highlightedShopId = null;
          }, 3000);
          const shopElement = document.getElementById(`shop-${shop.id}`);
          if (shopElement) {
            shopElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
        marker.setMap(map);
      });

      map.setFitView();
    });
  });

  $effect(() => {
    if (!map) return;
    map.setMapStyle(darkMode ? 'amap://styles/dark' : 'amap://styles/light');
  });

  $effect(() => {
    if (!amap || !amapReady || !data) return;
    if (transportMethod) {
      untrack(async () => {
        await calculateTravelData(transportMethod!);
      });
      return () => {
        Object.keys(travelData).forEach((shopId) => {
          const route = travelData[Number(shopId)]?.route;
          if (route) {
            map?.remove(route);
          }
        });
      };
    } else {
      travelData = {};
    }
  });

  $effect(() => {
    Object.keys(travelData).forEach((shopId) => {
      const id = Number(shopId);
      const data = travelData[id];
      if (!data) return;
      data.route.setOptions(getRouteOptions(id));
    });
  });

  $effect(() => {
    if (selectedShopId) {
      untrack(() => {
        const route = travelData[selectedShopId!]?.route;
        if (route) map?.setFitView([route]);
        else
          map?.setZoomAndCenter(
            15,
            data.shops.find((e) => e.id === selectedShopId)!.location.coordinates
          );
      });
    }
  });

  $effect(() => {
    const selected = selectedShopId;
    const hovered = hoveredShopId;
    untrack(() => {
      data.shops.forEach((shop) => {
        markers[shop.id]?.marker.setzIndex(
          shop.id === selected
            ? SELECTED_SHOP_INDEX
            : shop.id === hovered
              ? HOVERED_SHOP_INDEX
              : markers[shop.id].zIndex
        );
        const element = document.querySelector(`#shop-marker-${shop.id}`) as HTMLElement | null;
        if (element) {
          element.className = element.className.replace(
            /text-error|text-warning dark:text-info|text-info dark:text-success/g,
            ''
          );
          if (selected === shop.id) {
            element.classList.add('text-error');
          } else if (hovered === shop.id) {
            element.classList.add('text-warning');
            element.classList.add('dark:text-info');
          } else {
            element.classList.add('text-info');
            element.classList.add('dark:text-success');
          }
        }
      });
    });
  });

  $effect(() => {
    if (!amap || !amapReady || !map) return;
    if (['transit', 'riding', 'driving'].includes(transportMethod!)) {
      if (!trafficLayer) {
        trafficLayer = new amap.TileLayer.Traffic({
          zIndex: 1000,
          autoRefresh: true,
          opacity: 0.5
        });
        trafficLayer.setMap(map);
      }
    } else {
      trafficLayer?.setMap(null);
      trafficLayer = undefined;
    }
  });
</script>

<svelte:head>
  <title
    >{data.location.name
      ? m.arcades_near({
          name: data.location.name
        })
      : m.nearby_arcades()} - nearcade</title
  >
</svelte:head>

<div class="container mx-auto pt-20 sm:px-4">
  <div class="mb-6 flex flex-col items-center justify-between gap-2 sm:flex-row">
    <div class="not-sm:text-center">
      <h1 class="mb-2 text-3xl font-bold">{m.nearby_arcades()}</h1>
      <p class="text-base-content/70">
        {m.found_shops_near({
          count: data.shops.length,
          location: data.location.name ?? `(${data.location.longitude}, ${data.location.latitude})`
        })}
      </p>
    </div>
    <div class="flex flex-col gap-1">
      <label class="label not-md:mx-auto" for="transport-select">
        <span class="label-text">{m.transport_method()}</span>
      </label>
      <select
        id="transport-select"
        class="select select-bordered w-full pe-8"
        bind:value={transportMethod}
      >
        <option value={undefined}>{m.not_specified()}</option>
        <option value="transit">{m.public_transport()}</option>
        <option value="walking">{m.walking()}</option>
        <option value="riding">{m.riding()}</option>
        <option value="driving">{m.driving()}</option>
      </select>
    </div>
  </div>
  {#if data.shops.length === 0}
    <div class="alert alert-soft alert-info not-dark:hidden">
      <i class="fa-solid fa-circle-info fa-lg"></i>
      <span>{m.no_shops_found()}</span>
    </div>
    <div class="alert alert-info dark:hidden">
      <i class="fa-solid fa-circle-info fa-lg"></i>
      <span>{m.no_shops_found()}</span>
    </div>
  {:else}
    {#if amapError}
      <div class="alert alert-error mb-4">
        <i class="fa-solid fa-circle-xmark fa-lg"></i>
        <span>
          {m.map_failure({
            error: amapError
          })}
        </span>
      </div>
    {/if}
    <div
      id="amap-container"
      class="mb-4 h-[60vh] w-full rounded-xl {!amapReady
        ? 'bg-base-200 animate-pulse opacity-50'
        : ''}"
      bind:this={amapContainer}
    ></div>
    <div class="overflow-x-auto">
      <table class="bg-base-200/30 dark:bg-base-200 table w-full">
        <thead>
          <tr>
            <th class="text-left">{m.shop()}</th>
            <th class="text-center">
              {#if transportMethod}
                {m.travel_time()}
              {:else}
                {m.distance()}
              {/if}
            </th>
            {#each visibleGames as game (game.id)}
              <th id="game-{game.id}" class="text-center">{game.name}</th>
            {/each}
            <th class="text-center">{m.actions()}</th>
          </tr>
        </thead>
        <tbody>
          {#each sortedShops as shop (shop.id)}
            <tr
              id="shop-{shop.id}"
              class="cursor-pointer transition-all select-none {highlightedShopId === shop.id
                ? 'bg-accent/12'
                : hoveredShopId === shop.id
                  ? 'bg-base-300'
                  : ''}"
              onmouseenter={() => {
                hoveredShopId = shop.id;
              }}
              onmouseleave={() => {
                if (hoveredShopId === shop.id) {
                  hoveredShopId = null;
                }
              }}
              onclick={() => {
                selectedShopId = shop.id;
                amapContainer?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            >
              <td>
                <div class="flex items-center space-x-3">
                  <div>
                    <div class="text-lg font-bold">{shop.name}</div>
                    <div class="hidden text-sm opacity-50 sm:block">
                      {#if transportMethod}
                        {@const hasTravelData = travelData[shop.id] !== undefined}
                        {@const distance = travelData[shop.id]?.distance ?? shop.distance}
                        <span>ID: {shop.id} · </span>
                        <span
                          class="whitespace-nowrap {!hasTravelData
                            ? ''
                            : distance < avgTravelDistance / 1.5
                              ? 'text-success'
                              : distance < avgTravelDistance * 1.5
                                ? 'text-warning'
                                : 'text-error'}"
                        >
                          {formatDistance(distance, 2)}
                        </span>
                      {:else}
                        ID: {shop.id}
                      {/if}
                    </div>
                  </div>
                </div>
              </td>
              <td class="text-center">
                {#if transportMethod}
                  {#if travelData[shop.id] === undefined}
                    <span class="loading loading-spinner loading-sm"></span>
                  {:else}
                    <div
                      class="badge badge-soft badge-sm sm:badge-md lg:badge-lg whitespace-nowrap {travelData[
                        shop.id
                      ] === null
                        ? 'badge-neutral'
                        : travelData[shop.id]!.time < Math.max(avgTravelTime / 1.5, 1200)
                          ? 'badge-success'
                          : travelData[shop.id]!.time < Math.max(avgTravelTime * 1.5, 2400)
                            ? 'badge-warning'
                            : 'badge-error'}"
                    >
                      {formatTime(travelData[shop.id]?.time)}
                    </div>
                  {/if}
                {:else}
                  <div
                    class="badge badge-soft badge-sm sm:badge-md lg:badge-lg whitespace-nowrap {shop.distance <
                    avgTravelDistance / 1.5
                      ? 'badge-success'
                      : shop.distance < avgTravelDistance * 1.5
                        ? 'badge-warning'
                        : 'badge-error'}"
                  >
                    {formatDistance(shop.distance, 2)}
                  </div>
                {/if}
              </td>
              {#each visibleGames as gameInfo (gameInfo.id)}
                {@const game = findGame(shop.games, gameInfo.id)}
                <td class="text-center">
                  {#if game}
                    <div class="flex items-center justify-center gap-3">
                      <div class="text-accent flex items-center gap-1 text-sm">
                        <i class="fas fa-desktop"></i>
                        {game.quantity}
                      </div>
                      <div class="text-warning flex items-center gap-1 text-sm">
                        <i class="fa-solid fa-coins"></i>
                        {game.cost}
                      </div>
                    </div>
                  {:else}
                    <div class="text-base-content/40 text-xl">—</div>
                  {/if}
                </td>
              {/each}
              <td class="text-right">
                <div class="flex justify-center space-x-2">
                  <a
                    class="btn btn-ghost btn-sm"
                    href={`https://map.bemanicn.com/shop/${shop.id}`}
                    target="_blank"
                  >
                    <i class="fas fa-info-circle"></i>
                    {m.details()}
                  </a>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
      <div class="stat bg-base-200/30 dark:bg-base-200 rounded-xl" style="--border: 0">
        <div class="stat-figure text-primary">
          <i class="fas fa-store text-3xl"></i>
        </div>
        <div class="stat-title">{m.total_shops()}</div>
        <div class="stat-value text-primary">{data.shops.length}</div>
        <div class="stat-desc">{m.in_this_area()}</div>
      </div>

      <div class="stat bg-base-200/30 dark:bg-base-200 rounded-xl" style="--border: 0">
        <div class="stat-figure text-secondary">
          <i class="fas fa-desktop text-3xl"></i>
        </div>
        <div class="stat-title">{m.total_machines()}</div>
        <div class="stat-value text-secondary">
          {machineCount}
        </div>
        <div class="stat-desc">{m.arcade_machines()}</div>
      </div>

      <div class="stat bg-base-200/30 dark:bg-base-200 rounded-xl" style="--border: 0">
        <div class="stat-figure text-accent">
          <i class="fas fa-bullseye text-3xl"></i>
        </div>
        <div class="stat-title">{m.area_density()}</div>
        <div class="stat-value text-accent">
          {(machineCount / (Math.PI * Math.pow(data.radius, 2))).toFixed(3)}
        </div>
        <div class="stat-desc">{m.machines_per_km2()}</div>
      </div>
    </div>
  {/if}
</div>

<style lang="postcss">
  @reference "tailwindcss";

  :global(.amap-marker-label) {
    @apply rounded-full border-0 bg-sky-400/12 px-2 backdrop-blur-lg dark:bg-emerald-500/12;
  }
</style>
