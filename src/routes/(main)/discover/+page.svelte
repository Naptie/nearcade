<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import type {
    Game,
    AMapContext,
    Shop,
    TransportMethod,
    TransportSearchResult,
    CachedRouteData,
    RouteGuidanceState
  } from '$lib/types';
  import { m } from '$lib/paraglide/messages';
  import { onMount, getContext, untrack } from 'svelte';
  import {
    formatDistance,
    formatTime,
    isDarkMode,
    generateRouteCacheKey,
    getCachedRouteData,
    setCachedRouteData,
    clearRouteCache,
    convertPath,
    pageTitle,
    sanitizeHTML
  } from '$lib/utils';
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import RouteGuidance from '$lib/components/RouteGuidance.svelte';
  import {
    SELECTED_ROUTE_INDEX,
    HOVERED_ROUTE_INDEX,
    ROUTE_INDEX,
    ORIGIN_INDEX,
    SHOP_INDEX,
    SELECTED_SHOP_INDEX,
    HOVERED_SHOP_INDEX
  } from '$lib/constants';

  let { data } = $props();

  let screenWidth = $state(0);

  const amapContext = getContext<AMapContext>('amap');
  let amap = $derived(amapContext?.amap);
  let amapError = $derived(amapContext?.error ?? null);
  let amapContainer: HTMLDivElement | undefined = $state(undefined);
  let map: AMap.Map | undefined = $state(undefined);
  let markers: Record<string, { marker: AMap.Marker; zIndex: number }> = $state({});

  let hoveredShopId: string | null = $state(null);
  let selectedShopId: string | null = $state(null);
  let highlightedShopId: string | null = $state(null);
  let highlightedShopIdTimeout: ReturnType<typeof setTimeout> | null = $state(null);
  let darkMode = $derived(browser ? isDarkMode() : undefined);
  let transportMethod = $state<TransportMethod>(undefined); // 'transit', 'walking', 'riding', 'driving'
  let travelData = $state<
    Record<
      string,
      {
        time: number;
        distance: number;
        path: AMap.LngLat[];
        route: AMap.Polyline;
        routeData?: TransportSearchResult; // Store complete route data for guidance
      } | null
    >
  >({}); // shopId -> travel data
  let routeGuidance = $state<RouteGuidanceState>({
    isOpen: false,
    shopId: null,
    selectedRouteIndex: 0
  });
  let cachedRoutes = $state<Record<string, CachedRouteData>>({}); // cacheKey -> cached route data
  let trafficLayer: AMap.CoreVectorLayer | undefined = $state(undefined);

  let costs: Record<string, Record<string, { preview: string; full: string }>> = $state({});

  // Auto-discovery functionality
  let user = $derived(data.session?.user);
  let autoDiscoveryThreshold = $derived(user?.autoDiscoveryThreshold ?? 3); // Default to 3 clicks
  let shopClickCounts = $state<Record<string, number>>({});

  // Load shop click counts from localStorage on mount
  $effect(() => {
    if (browser) {
      const newCounts: Record<string, number> = {};
      data.shops.forEach((shop) => {
        const stored = localStorage.getItem(`nearcade-shop-${shop.source}-${shop.id}-count`);
        if (stored) {
          newCounts[`${shop.source}-${shop.id}`] = parseInt(stored, 10) || 0;
        }
      });
      shopClickCounts = newCounts;
    }
  });

  // Function to handle shop interaction clicks (details/route buttons)
  const handleShopClick = async (shop: Shop) => {
    if (!browser || !user) return;

    const currentCount = shopClickCounts[`${shop.source}-${shop.id}`] || 0;
    const newCount = currentCount + 1;

    // Update localStorage and state
    localStorage.setItem(`nearcade-shop-${shop.source}-${shop.id}-count`, newCount.toString());
    shopClickCounts = { ...shopClickCounts, [`${shop.source}-${shop.id}`]: newCount };

    // Check if threshold is reached and user isn't already frequenting this arcade
    if (
      newCount >= autoDiscoveryThreshold &&
      !user.frequentingArcades?.some(
        (arcade) => arcade.id === shop.id && arcade.source === shop.source
      )
    ) {
      try {
        // Submit form to add arcade automatically
        const formData = new FormData();
        formData.append('arcadeSource', shop.source);
        formData.append('arcadeId', shop.id.toString());

        const response = await fetch(
          resolve('/(main)/settings/frequenting-arcades') + '?/addArcade',
          {
            method: 'POST',
            body: formData
          }
        );

        if (response.ok) {
          // Reset click count for this shop since it's now been added
          localStorage.removeItem(`nearcade-shop-${shop.source}-${shop.id}-count`);
          shopClickCounts = { ...shopClickCounts, [`${shop.source}-${shop.id}`]: 0 };

          // Optionally show a notification
          console.log(`Auto-added ${shop.name} to your frequenting arcades!`);
        }
      } catch (error) {
        console.error('Failed to auto-add arcade:', error);
      }
    }
  };

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

  let isMobile = $derived.by(() => {
    return browser && screenWidth < 768;
  });

  const getRouteLink = (shop: Shop | undefined) => {
    if (!data || !shop) return '';
    const useGoogleMaps = shop.source === 'ziv';
    const origin = data.location;
    const from = useGoogleMaps
      ? `${origin.latitude},${origin.longitude}`
      : `${origin.longitude},${origin.latitude},${origin.name}`;
    const destination = shop.location;
    const to = useGoogleMaps
      ? `${destination.coordinates[1]},${destination.coordinates[0]}`
      : `${destination.coordinates[0]},${destination.coordinates[1]},${shop.name}`;
    const mode =
      transportMethod === 'walking'
        ? useGoogleMaps
          ? 'walking'
          : 'walk'
        : transportMethod === 'riding'
          ? useGoogleMaps
            ? 'bicycling'
            : 'ride'
          : transportMethod === 'driving'
            ? useGoogleMaps
              ? 'driving'
              : 'car'
            : useGoogleMaps
              ? 'transit'
              : 'bus';
    return useGoogleMaps
      ? `https://www.google.com/maps/dir/?api=1&origin=${from}&destination=${to}&travelmode=${mode}`
      : `https://uri.amap.com/navigation?from=${from}&to=${to}&mode=${mode}&src=nearcade&callnative=1`;
  };

  let routeLink = $derived.by(
    () => getRouteLink(data.shops.find((s) => `${s.source}-${s.id}` === routeGuidance.shopId)) || ''
  );

  const getRouteOptions = (id: string): Partial<AMap.PolylineOptions> => {
    const isSelected = selectedShopId === id;
    const isHovered = hoveredShopId === id;
    const hasGuidanceOpen = routeGuidance.isOpen && routeGuidance.shopId === id;

    return {
      strokeColor: isSelected ? 'lime' : isHovered ? 'orange' : 'cyan',
      strokeWeight: isSelected ? 3.8 : isHovered ? 4.2 : 3,
      strokeOpacity: hasGuidanceOpen ? 0 : isSelected || isHovered ? 1 : 0.4,
      lineJoin: 'round',
      zIndex: isSelected ? SELECTED_ROUTE_INDEX : isHovered ? HOVERED_ROUTE_INDEX : ROUTE_INDEX
    };
  };

  const showRouteGuidance = () => {
    if (routeGuidance.isOpen || !routeGuidance.shopId || routeGuidance.shopId !== selectedShopId)
      return;
    openRouteGuidance();
  };

  const openRouteGuidance = () => {
    routeGuidance.isOpen = true;
    if (isMobile) {
      amapContainer?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let plugins: Record<string, any> = $state({});

  const calculateTravelData = async (method: NonNullable<TransportMethod>) => {
    if (!amap || !data || data.shops.length === 0) return;
    travelData = {};

    const { quota, usage } = await navigator.storage.estimate();
    if (quota && usage && usage > quota * 0.94) {
      await clearRouteCache(data.shops.length);
    } else {
      await clearRouteCache();
    }

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
        amap?.plugin([pluginName], () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const a = amap as any;
          if (method === 'transit') {
            plugins[method] = new a.Transfer({ city: ' ', nightflag: 1, extensions: 'all' });
          } else if (method === 'walking') {
            plugins[method] = new a.Walking();
          } else if (method === 'riding') {
            plugins[method] = new a.Riding();
          } else {
            plugins[method] = new a.Driving({ strategy: 10 });
          }
          resolve();
        });
      });
    }

    const plugin = plugins[method];

    const processShop = async (shop: Shop, retryCount = 0): Promise<void> => {
      return new Promise((resolve) => {
        if (!amap) {
          return;
        }
        const processRouteData = (result: TransportSearchResult, selectedIndex: number) => {
          if (!amap || typeof result !== 'object') {
            return;
          }
          const routes = 'routes' in result ? result.routes : result.plans;
          routes.sort((a, b) => (a.time || Infinity) - (b.time || Infinity));
          const selectedRoute = routes[selectedIndex];

          const path = convertPath(
            'path' in selectedRoute
              ? selectedRoute.path
              : ('steps' in selectedRoute ? selectedRoute.steps : selectedRoute.rides)
                  .map((step) => step.path)
                  .flat()
          );

          const routeLine = new amap.Polyline({
            path: path,
            ...getRouteOptions(`${shop.source}-${shop.id}`)
          });

          routeLine.on('mouseover', () => {
            hoveredShopId = `${shop.source}-${shop.id}`;
          });
          routeLine.on('mouseout', () => {
            if (hoveredShopId === `${shop.source}-${shop.id}`) {
              hoveredShopId = null;
            }
          });
          routeLine.on('click', () => {
            selectedShopId = `${shop.source}-${shop.id}`;
            showRouteGuidance();
          });

          map?.add(routeLine);
          travelData[`${shop.source}-${shop.id}`] = {
            time: selectedRoute.time ?? 0,
            distance: selectedRoute.distance ? selectedRoute.distance / 1000 : 0,
            path,
            route: routeLine,
            routeData: result
          };
        };

        const cacheKey = generateRouteCacheKey(
          data.location.latitude,
          data.location.longitude,
          `${shop.source}-${shop.id}`,
          method
        );

        // Check cache first
        getCachedRouteData(cacheKey).then((cachedData) => {
          if (cachedData) {
            cachedRoutes[cacheKey] = cachedData;
            processRouteData(cachedData.routeData, cachedData.selectedRouteIndex);
            resolve();
            return;
          }

          // No cache, make fresh request
          const origin = new amap!.LngLat(data.location.longitude, data.location.latitude);
          const destination = new amap!.LngLat(
            shop.location.coordinates[0],
            shop.location.coordinates[1]
          );

          try {
            plugin.search(origin, destination, (status: string, result: TransportSearchResult) => {
              console.debug(result);
              if (
                status === 'complete' &&
                typeof result === 'object' &&
                (('plans' in result && result.plans.length > 0) ||
                  ('routes' in result && result.routes.length > 0))
              ) {
                // Cache the complete result
                setCachedRouteData(cacheKey, result, 0);
                cachedRoutes[cacheKey] = {
                  routeData: result,
                  selectedRouteIndex: 0
                };

                processRouteData(result, 0);
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
                travelData[`${shop.source}-${shop.id}`] = null;
                resolve();
              }
            });
          } catch (error) {
            console.error(
              `Error calculating travel data for shop ${shop.source}-${shop.id}:`,
              error
            );
            travelData[`${shop.source}-${shop.id}`] = null;
            resolve();
          }
        });
      });
    };

    // Process shops sequentially to avoid rate limiting
    // Process selected shop first if exists, then process remaining shops
    for (const shop of [
      ...data.shops.filter((shop) => `${shop.source}-${shop.id}` === selectedShopId),
      ...data.shops.filter((shop) => `${shop.source}-${shop.id}` !== selectedShopId)
    ]) {
      await processShop(shop);
    }

    if (!routeGuidance.isOpen) map?.setFitView();
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

  const assignAMap = (event: CustomEventInit<typeof AMap>) => {
    amap = event.detail;
  };

  onMount(() => {
    if (browser) {
      screenWidth = window.innerWidth;
      window.addEventListener('resize', handleResize);
      window.addEventListener('amap-loaded', assignAMap);

      Promise.all(
        data.shops.flatMap((shop) => {
          costs[`${shop.source}-${shop.id}`] = {};
          shop.games.map(async (game) => {
            costs[`${shop.source}-${shop.id}`][game.id] = {
              preview: await sanitizeHTML(game.cost.substring(0, 30)),
              full: await sanitizeHTML(game.cost)
            };
          });
        })
      );

      return () => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('amap-loaded', assignAMap);
      };
    }
  });

  $effect(() => {
    if (!amap || !amapContainer || !data || darkMode === undefined) return;
    untrack(() => {
      if (!amap) return;
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
      if (data.shops.length > 0) {
        data.shops.forEach((shop) => {
          const minLat = Math.min(...data.shops.map((s) => s.location.coordinates[1]));
          const maxLat = Math.max(...data.shops.map((s) => s.location.coordinates[1]));
          const minLng = Math.min(...data.shops.map((s) => s.location.coordinates[0]));
          const maxLng = Math.max(...data.shops.map((s) => s.location.coordinates[0]));

          const normalizedLat = (shop.location.coordinates[1] - minLat) / (maxLat - minLat) || 0;
          const normalizedLng = (shop.location.coordinates[0] - minLng) / (maxLng - minLng) || 0;
          const zIndex =
            Math.floor((1 - normalizedLat) * 700 + (1 - normalizedLng) * 300) + SHOP_INDEX;

          const marker = new amap!.Marker({
            position: shop.location.coordinates,
            title: shop.name,
            content: `<i id="shop-marker-${shop.source}-${shop.id}" class="text-info dark:text-success fa-solid fa-location-dot fa-lg"></i>`,
            offset: new amap!.Pixel(-7.03, -20),
            label: {
              content: shop.name,
              offset: new amap!.Pixel(2, -5),
              direction: 'right'
            },
            zIndex
          });

          markers[`${shop.source}-${shop.id}`] = { marker, zIndex };

          marker.on('mouseover', () => {
            hoveredShopId = `${shop.source}-${shop.id}`;
          });
          marker.on('mouseout', () => {
            if (hoveredShopId === `${shop.source}-${shop.id}`) {
              hoveredShopId = null;
            }
          });
          marker.on('click', () => {
            selectedShopId = `${shop.source}-${shop.id}`;
            highlightedShopId = `${shop.source}-${shop.id}`;
            if (highlightedShopIdTimeout) {
              clearTimeout(highlightedShopIdTimeout);
            }
            if (!routeGuidance.isOpen) {
              highlightedShopIdTimeout = setTimeout(() => {
                highlightedShopId = null;
              }, 3000);
            }
            const shopElement = document.getElementById(`shop-${shop.source}-${shop.id}`);
            if (shopElement && !(isMobile && routeGuidance.isOpen)) {
              shopElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          });
          marker.setMap(map);
        });

        map.setFitView();
      }
    });
  });

  $effect(() => {
    if (!map) return;
    map.setMapStyle(darkMode ? 'amap://styles/dark' : 'amap://styles/light');
  });

  $effect(() => {
    if (!amap || !data) return;
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
      const data = travelData[shopId];
      if (!data) return;
      data.route.setOptions(getRouteOptions(shopId));
    });
  });

  $effect(() => {
    // Update route colors when guidance state changes
    if (routeGuidance.shopId) {
      const routeData = travelData[routeGuidance.shopId];
      if (routeData) {
        routeData.route.setOptions(getRouteOptions(routeGuidance.shopId));
      }
    }
  });

  $effect(() => {
    if (selectedShopId) {
      untrack(() => {
        const route = travelData[selectedShopId!]?.route;
        if (route) {
          map?.setFitView([route]);
          routeGuidance.shopId = selectedShopId;
          openRouteGuidance();
        } else {
          map?.setZoomAndCenter(
            15,
            data.shops.find((s) => `${s.source}-${s.id}` === selectedShopId)!.location.coordinates
          );
        }
      });
    }
  });

  $effect(() => {
    if (transportMethod && selectedShopId && travelData[selectedShopId]?.routeData) {
      const selected = selectedShopId;
      untrack(() => {
        const result = travelData[selected]?.routeData;
        if (
          typeof result !== 'object' ||
          (!('plans' in result && result.plans.length > 0) &&
            !('routes' in result && result.routes.length > 0))
        ) {
          return;
        }
        const cacheKey = generateRouteCacheKey(
          data.location.latitude,
          data.location.longitude,
          selected,
          transportMethod
        );
        const cachedData = cachedRoutes[cacheKey];
        const selectedIndex = cachedData?.selectedRouteIndex ?? 0;

        routeGuidance = {
          isOpen: true,
          shopId: selected,
          selectedRouteIndex: selectedIndex
        };
        openRouteGuidance();
      });
    }
  });

  $effect(() => {
    const selected = selectedShopId;
    const hovered = hoveredShopId;
    untrack(() => {
      data.shops.forEach((shop) => {
        markers[`${shop.source}-${shop.id}`]?.marker.setzIndex(
          `${shop.source}-${shop.id}` === selected
            ? SELECTED_SHOP_INDEX
            : `${shop.source}-${shop.id}` === hovered
              ? HOVERED_SHOP_INDEX
              : markers[`${shop.source}-${shop.id}`].zIndex
        );
        const element = document.querySelector(
          `#shop-marker-${shop.source}-${shop.id}`
        ) as HTMLElement | null;
        if (element) {
          element.className = element.className.replace(
            /text-error|text-warning dark:text-info|text-info dark:text-success/g,
            ''
          );
          if (selected === `${shop.source}-${shop.id}`) {
            element.classList.add('text-error');
          } else if (hovered === `${shop.source}-${shop.id}`) {
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
    if (!amap || !map) return;
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

  $effect(() => {
    if (routeGuidance.isOpen && routeGuidance.shopId) {
      highlightedShopId = routeGuidance.shopId;
      return () => {
        highlightedShopId = null;
      };
    }
  });
</script>

<RouteGuidance
  bind:isOpen={routeGuidance.isOpen}
  shop={routeGuidance.shopId
    ? data.shops.find((s) => `${s.source}-${s.id}` === routeGuidance.shopId)
    : null}
  selectedRouteIndex={routeGuidance.selectedRouteIndex}
  routeData={routeGuidance.shopId ? travelData[routeGuidance.shopId]?.routeData : null}
  isLoading={!!routeGuidance.shopId && !travelData[routeGuidance.shopId]}
  {map}
  {amap}
  amapLink={routeLink}
  onClose={() => {
    routeGuidance.isOpen = false;
  }}
  onRouteSelected={(index) => {
    routeGuidance.selectedRouteIndex = index;

    // Update cache with new selected route index
    if (routeGuidance.shopId && transportMethod) {
      const cacheKey = generateRouteCacheKey(
        data.location.latitude,
        data.location.longitude,
        routeGuidance.shopId,
        transportMethod
      );
      const cachedData = cachedRoutes[cacheKey];
      if (cachedData) {
        setCachedRouteData(cacheKey, cachedData.routeData, index);
        cachedRoutes[cacheKey] = { ...cachedData, selectedRouteIndex: index };
      }
    }

    // Update the polyline on the map to show the selected route
    if (routeGuidance.shopId && transportMethod && amap && map) {
      const shopData = travelData[routeGuidance.shopId];
      if (shopData?.routeData) {
        const result = shopData.routeData;
        if (typeof result === 'object') {
          const routes = 'routes' in result ? result.routes : result.plans;
          const selectedRoute = routes[index];

          if (selectedRoute) {
            const path = convertPath(
              'path' in selectedRoute
                ? selectedRoute.path
                : ('steps' in selectedRoute ? selectedRoute.steps : selectedRoute.rides)
                    .map((step) => step.path)
                    .flat()
            );

            shopData.route.setPath(path);

            travelData[routeGuidance.shopId] = {
              ...shopData,
              time: selectedRoute.time ?? 0,
              distance: selectedRoute.distance ? selectedRoute.distance / 1000 : 0,
              path,
              route: shopData.route
            };
          }
        }
      }
    }
  }}
/>

<svelte:head>
  <title>
    {pageTitle(
      data.location.name
        ? m.arcades_near({
            name: data.location.name
          })
        : m.nearby_arcades()
    )}
  </title>
</svelte:head>

<div class="mx-auto pt-20 pb-8 sm:container sm:px-4">
  <div class="xs:flex-row mb-6 flex flex-col items-center justify-between gap-2 not-sm:px-2">
    <div class="not-xs:text-center">
      <h1 class="mb-2 text-3xl font-bold">{m.nearby_arcades()}</h1>
      <p class="text-base-content/70">
        {m.found_shops_near({
          count: data.shops.length,
          location:
            data.location.name ??
            `(${data.location.longitude.toFixed(6)}, ${data.location.latitude.toFixed(6)})`
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
    <div class="alert alert-soft alert-info mb-4 not-dark:hidden">
      <i class="fa-solid fa-circle-info fa-lg"></i>
      <span>{m.no_shops_found()}</span>
    </div>
    <div class="alert alert-info mb-4 dark:hidden">
      <i class="fa-solid fa-circle-info fa-lg"></i>
      <span>{m.no_shops_found()}</span>
    </div>
  {/if}
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
    class="mb-4 h-[50vh] w-full rounded-xl md:h-[60vh] {!amap
      ? 'bg-base-200 animate-pulse opacity-50'
      : ''}"
    bind:this={amapContainer}
  ></div>
  {#if data.shops.length > 0}
    <div class="overflow-x-auto">
      <table class="bg-base-200/30 dark:bg-base-200/60 table w-full overflow-hidden">
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
          {#each sortedShops as shop, i (i)}
            <tr
              id="shop-{shop.id}"
              class="group cursor-pointer transition-all select-none {highlightedShopId ===
              `${shop.source}-${shop.id}`
                ? 'bg-accent/8'
                : hoveredShopId === `${shop.source}-${shop.id}`
                  ? 'bg-base-300/30'
                  : ''}"
              onmouseenter={() => {
                hoveredShopId = `${shop.source}-${shop.id}`;
              }}
              onmouseleave={() => {
                if (hoveredShopId === `${shop.source}-${shop.id}`) {
                  hoveredShopId = null;
                }
              }}
              onclick={(event) => {
                if ((event.target as Element)?.closest('button, a')) return;
                selectedShopId = `${shop.source}-${shop.id}`;
                if (!(isMobile && routeGuidance.isOpen))
                  amapContainer?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            >
              <td>
                <div class="flex items-center space-x-3">
                  <div>
                    <div class="text-lg font-bold">{shop.name}</div>
                    <div
                      class="xs:not-dark:inline-flex xs:dark:block hidden text-sm opacity-50 not-dark:items-center not-dark:gap-1"
                    >
                      {#if transportMethod}
                        {@const hasTravelData =
                          travelData[`${shop.source}-${shop.id}`] !== undefined}
                        {@const distance =
                          travelData[`${shop.source}-${shop.id}`]?.distance ?? shop.distance}
                        <span>{shop.source.toUpperCase()} · {shop.id}</span>
                        <span class="not-dark:hidden"> · </span>
                        <span
                          class="not-dark:badge not-dark:badge-sm not-dark:badge-soft whitespace-nowrap {!hasTravelData
                            ? ''
                            : distance < avgTravelDistance / 1.5
                              ? 'not-dark:badge-success dark:text-success'
                              : distance < avgTravelDistance * 1.5
                                ? 'not-dark:badge-warning dark:text-warning'
                                : 'not-dark:badge-error dark:text-error'}"
                        >
                          {formatDistance(distance, 2)}
                        </span>
                      {:else}
                        {shop.source.toUpperCase()} · {shop.id}
                      {/if}
                    </div>
                  </div>
                </div>
              </td>
              <td class="text-center">
                {#if transportMethod}
                  {#if travelData[`${shop.source}-${shop.id}`] === undefined}
                    <span class="loading loading-spinner loading-sm"></span>
                  {:else}
                    <div
                      class="badge badge-soft badge-sm sm:badge-md lg:badge-lg whitespace-nowrap {travelData[
                        shop.id
                      ] === null
                        ? 'badge-neutral'
                        : travelData[`${shop.source}-${shop.id}`]!.time <
                            Math.max(avgTravelTime / 1.5, 1200)
                          ? 'badge-success'
                          : travelData[`${shop.source}-${shop.id}`]!.time <
                              Math.max(avgTravelTime * 1.5, 2400)
                            ? 'badge-warning'
                            : 'badge-error'}"
                    >
                      {formatTime(travelData[`${shop.source}-${shop.id}`]?.time)}
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
                    {@const id = `${shop.source}-${shop.id}`}
                    <div class="flex items-center justify-center gap-3">
                      <div
                        class="group-hover:text-accent flex items-center gap-1 text-sm transition-colors"
                      >
                        <i class="fas fa-desktop"></i>
                        {game.quantity}
                      </div>
                      {#if costs[id] && costs[id][game.id]}
                        {@const cost = costs[id][game.id]}
                        {#if cost.full === cost.preview}
                          <div
                            class="group-hover:text-warning flex items-center gap-1 text-sm transition-colors"
                          >
                            <i class="fa-solid fa-coins"></i>
                            {@html cost.full}
                          </div>
                        {:else}
                          <div class="tooltip">
                            <div class="tooltip-content">
                              {@html cost.full}
                            </div>
                            <div
                              class="group-hover:text-warning flex items-center gap-1 text-sm transition-colors"
                            >
                              <i class="fa-solid fa-coins"></i>
                              {@html cost.preview.substring(0, 25)}...
                            </div>
                          </div>
                        {/if}
                      {/if}
                    </div>
                  {:else}
                    <div class="text-base-content/40 text-xl">—</div>
                  {/if}
                </td>
              {/each}
              <td class="text-right">
                <div class="flex flex-col justify-center gap-2 xl:flex-row">
                  <a
                    class="btn btn-ghost btn-sm text-nowrap"
                    href="{shop.source === 'ziv'
                      ? 'https://zenius-i-vanisher.com/v5.2/arcade.php?id='
                      : 'https://map.bemanicn.com/shop/'}{shop.id}"
                    target="_blank"
                    onclick={() => handleShopClick(shop)}
                  >
                    <i class="fas fa-info-circle"></i>
                    {m.details()}
                  </a>
                  <a
                    class="btn btn-ghost btn-sm text-nowrap"
                    href={getRouteLink(shop)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onclick={() => handleShopClick(shop)}
                  >
                    <i class="fas fa-map-marked-alt"></i>
                    {m.route()}
                  </a>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
      <div class="stat bg-base-200/30 dark:bg-base-200/60 rounded-xl">
        <div class="stat-figure text-primary">
          <i class="fas fa-store text-3xl"></i>
        </div>
        <div class="stat-title">{m.total_shops()}</div>
        <div class="stat-value text-primary">{data.shops.length}</div>
        <div class="stat-desc">{m.in_this_area()}</div>
      </div>

      <div class="stat bg-base-200/30 dark:bg-base-200/60 rounded-xl">
        <div class="stat-figure text-secondary">
          <i class="fas fa-desktop text-3xl"></i>
        </div>
        <div class="stat-title">{m.total_machines()}</div>
        <div class="stat-value text-secondary">
          {machineCount}
        </div>
        <div class="stat-desc">{m.arcade_machines()}</div>
      </div>

      <div class="stat bg-base-200/30 dark:bg-base-200/60 rounded-xl">
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
