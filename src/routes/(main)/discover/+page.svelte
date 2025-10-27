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
    formatDuration,
    generateRouteCacheKey,
    getCachedRouteData,
    setCachedRouteData,
    clearRouteCache,
    convertPath,
    pageTitle,
    sanitizeHTML,
    formatShopAddress,
    getGameName,
    adaptiveNewTab,
    getShopOpeningHours
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
    HOVERED_SHOP_INDEX,
    GAMES,
    ShopSource
  } from '$lib/constants';
  import { PUBLIC_GOOGLE_MAPS_MAP_ID } from '$env/static/public';
  import { isDarkMode } from '$lib/utils/scoped';
  import AttendanceReportBlame from '$lib/components/AttendanceReportBlame.svelte';

  let { data } = $props();

  let screenWidth = $state(0);

  let now = $state(new Date());

  // Determine if all shops are from 'ziv' source to enable Google Maps
  const useGoogleMaps = $derived(
    data.shops.length > 0 && data.shops.every((shop) => shop.source === ShopSource.ZIV)
  );

  const amapContext = getContext<AMapContext>('amap');
  let amap = $derived(amapContext?.amap);
  let amapError = $derived(amapContext?.error ?? null);

  let mapContainer: HTMLDivElement | undefined = $state(undefined);
  let map: AMap.Map | google.maps.Map | undefined = $state(undefined); // AMap.Map | google.maps.Map
  let markers: Record<
    string,
    {
      marker: AMap.Marker | google.maps.marker.AdvancedMarkerElement;
      infoWindow?: google.maps.InfoWindow;
      zIndex: number;
    }
  > = $state({}); // AMap.Marker | google.maps.marker.AdvancedMarkerElement

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
  let discoveryInteractionThreshold = $derived(
    user?.autoDiscovery?.discoveryInteractionThreshold ?? 5
  ); // Default to 5 clicks
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
      newCount >= discoveryInteractionThreshold &&
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
          localStorage.removeItem(`nearcade-shop-${shop.source}-${shop.id}-count`);
          shopClickCounts = { ...shopClickCounts, [`${shop.source}-${shop.id}`]: 0 };
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

  let isMobileView = $derived.by(() => {
    return browser && screenWidth < 768;
  });

  const getRouteLink = (shop: Shop | undefined) => {
    if (!data || !shop) return '';
    const useGoogleMaps = shop.source === ShopSource.ZIV;
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
    if (isMobileView) {
      mapContainer?.scrollIntoView({
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

          (map as AMap.Map).add(routeLine);
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

    if (!routeGuidance.isOpen && map && 'setFitView' in map) map.setFitView();
  };

  const findGame = (games: Game[], titleId: number): Game | null => {
    return games?.find((game) => game.titleId === titleId) || null;
  };

  const allGames = GAMES.map((game) => ({
    id: game.id,
    name: getGameName(game.key)
  }));

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
    screenWidth = window.innerWidth;
    window.addEventListener('resize', handleResize);
    window.addEventListener('amap-loaded', assignAMap);

    const interval = setInterval(() => {
      now = new Date();
    }, 1000);

    // Load Google Maps if needed
    if (
      useGoogleMaps &&
      'loadGoogleMaps' in window &&
      typeof window.loadGoogleMaps === 'function'
    ) {
      window.loadGoogleMaps().catch((error: Error) => {
        console.error('Failed to load Google Maps:', error);
      });
    }

    Promise.all(
      data.shops.flatMap((shop) => {
        costs[`${shop.source}-${shop.id}`] = {};
        shop.games.map(async (game) => {
          costs[`${shop.source}-${shop.id}`][game.titleId] = {
            preview: await sanitizeHTML(game.cost.substring(0, 30)),
            full: await sanitizeHTML(game.cost)
          };
        });
      })
    );

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('amap-loaded', assignAMap);
      clearInterval(interval);
    };
  });

  const createIcon = (id: string, icon: string, origin = false) => {
    const element = document.createElement('div');
    element.id = id;
    element.className = 'cursor-pointer relative';
    const inner = document.createElement('div');
    inner.className = `absolute left-1/2 -translate-x-1/2 ${origin ? 'top-1/2 -translate-y-1/2' : 'bottom-0 text-info dark:text-success hover:text-warning hover:dark:text-info'} text-lg`;
    const iconEl = document.createElement('i');
    iconEl.className = icon;
    inner.appendChild(iconEl);
    element.appendChild(inner);
    return element;
  };

  const createShopInfoWindowContent = (shop: Shop): string => {
    const address = formatShopAddress(shop);
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.name} ${address}`)}`;

    return `
      <div class="mt-2 min-w-48 max-w-80 space-y-2">
        <div class="space-y-0.25">
          <div class="font-semibold text-lg text-slate-800">
            ${shop.name}
          </div>
          <div class="text-sm text-slate-600">
            ${address}
          </div>
        </div>
        <div class="flex gap-2">
          <a 
            href="${googleMapsUrl}" 
            target="_blank" 
            rel="noopener noreferrer"
            class="btn btn-dash btn-neutral"
          >
            <i class="fas fa-external-link-alt"></i>
            ${m.view_in_google_maps()}
          </a>
        </div>
      </div>
    `;
  };

  $effect(() => {
    if (!mapContainer || !data || darkMode === undefined) return;

    const shops = data.shops.filter(
      (shop) =>
        selectedTitleIds.length === 0 ||
        selectedTitleIds.every((id) => shop.games.some((g) => g.titleId === id))
    );
    if (useGoogleMaps && google.maps) {
      // Initialize Google Maps
      untrack(async () => {
        if (!google.maps) return;
        await Promise.all(['core', 'maps', 'marker'].map((lib) => google.maps.importLibrary(lib)));

        const googleMap = new google.maps.Map(mapContainer!, {
          mapId: PUBLIC_GOOGLE_MAPS_MAP_ID,
          zoom: 10,
          center: { lat: data.location.latitude, lng: data.location.longitude },
          colorScheme: isDarkMode() ? 'DARK' : 'LIGHT'
        });

        map = googleMap;

        const originMarker = new google.maps.marker.AdvancedMarkerElement({
          position: { lat: data.location.latitude, lng: data.location.longitude },
          map: googleMap,
          title: m.origin(),
          content: createIcon('origin-marker', 'fa-solid fa-location-crosshairs fa-xl', true),
          zIndex: ORIGIN_INDEX
        });

        // Create info window for origin
        const originInfoWindow = new google.maps.InfoWindow({
          content: `<div class="text-sm font-medium">${m.origin()}</div>`
        });

        originMarker.addListener('click', () => {
          originInfoWindow.open(googleMap, originMarker);
        });

        // Create shop markers
        if (shops.length > 0) {
          shops.forEach((shop) => {
            const minLat = Math.min(...data.shops.map((s) => s.location.coordinates[1]));
            const maxLat = Math.max(...data.shops.map((s) => s.location.coordinates[1]));
            const minLng = Math.min(...data.shops.map((s) => s.location.coordinates[0]));
            const maxLng = Math.max(...data.shops.map((s) => s.location.coordinates[0]));

            const normalizedLat = (shop.location.coordinates[1] - minLat) / (maxLat - minLat) || 0;
            const normalizedLng = (shop.location.coordinates[0] - minLng) / (maxLng - minLng) || 0;
            const zIndex =
              Math.floor((1 - normalizedLat) * 700 + (1 - normalizedLng) * 300) + SHOP_INDEX;

            const marker = new google.maps.marker.AdvancedMarkerElement({
              position: { lat: shop.location.coordinates[1], lng: shop.location.coordinates[0] },
              map: googleMap,
              title: shop.name,
              content: createIcon(
                `shop-marker-${shop.source}-${shop.id}`,
                'fa-solid fa-location-dot fa-lg'
              ),
              zIndex
            });

            const infoWindow = new google.maps!.InfoWindow({
              content: createShopInfoWindowContent(shop)
            });
            infoWindow.addListener('closeclick', () => {
              if (selectedShopId === `${shop.source}-${shop.id}`) {
                selectedShopId = null;
              }
            });

            markers[`${shop.source}-${shop.id}`] = { marker, infoWindow, zIndex };

            marker.addListener('mouseover', () => {
              hoveredShopId = `${shop.source}-${shop.id}`;
            });

            marker.addListener('mouseout', () => {
              if (hoveredShopId === `${shop.source}-${shop.id}`) {
                hoveredShopId = null;
              }
            });

            marker.addListener('click', () => {
              selectedShopId = `${shop.source}-${shop.id}`;
              highlightedShopId = `${shop.source}-${shop.id}`;
              Object.values(markers).forEach((markerInfo) => {
                markerInfo.infoWindow?.close();
              });
              infoWindow.open(googleMap, marker);

              if (highlightedShopIdTimeout) {
                clearTimeout(highlightedShopIdTimeout);
              }

              highlightedShopIdTimeout = setTimeout(() => {
                highlightedShopId = null;
              }, 3000);

              const shopElement = document.getElementById(`shop-${shop.source}-${shop.id}`);
              if (shopElement && !(isMobileView && routeGuidance.isOpen)) {
                shopElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            });
          });

          // Fit bounds to show all markers
          const bounds = new google.maps.LatLngBounds();
          bounds.extend({ lat: data.location.latitude, lng: data.location.longitude });
          data.shops.forEach((shop) => {
            bounds.extend({ lat: shop.location.coordinates[1], lng: shop.location.coordinates[0] });
          });
          googleMap.fitBounds(bounds);
        }
      });
    } else if (!useGoogleMaps && amap) {
      // Initialize AMap (existing code)
      untrack(() => {
        if (!amap) return;
        map = new amap.Map('amap-container', {
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
        if (shops.length > 0) {
          shops.forEach((shop) => {
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
              if (shopElement && !(isMobileView && routeGuidance.isOpen)) {
                shopElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            });
            marker.setMap(map as AMap.Map);
          });

          if (map && 'setFitView' in map) map.setFitView();
        }
      });
    }
  });

  $effect(() => {
    if (!map || useGoogleMaps) return;
    if (map && 'setMapStyle' in map) {
      map.setMapStyle(darkMode ? 'amap://styles/dark' : 'amap://styles/light');
    }
  });

  $effect(() => {
    if (!map || useGoogleMaps) return; // Skip for Google Maps
    if (transportMethod) {
      untrack(async () => {
        await calculateTravelData(transportMethod!);
      });
      return () => {
        Object.keys(travelData).forEach((shopId) => {
          const route = travelData[shopId]?.route;
          if (route && map && (map as { remove?: (route: unknown) => void }).remove) {
            (map as { remove: (route: unknown) => void }).remove(route);
          }
        });
      };
    } else {
      travelData = {};
    }
  });

  $effect(() => {
    if (useGoogleMaps) return; // Skip for Google Maps
    Object.keys(travelData).forEach((shopId) => {
      const data = travelData[shopId];
      if (!data || !data.route.setOptions) return;
      data.route.setOptions(getRouteOptions(shopId));
    });
  });

  $effect(() => {
    // Update route colors when guidance state changes
    if (routeGuidance.shopId && !useGoogleMaps) {
      const routeData = travelData[routeGuidance.shopId];
      if (routeData && routeData.route.setOptions) {
        routeData.route.setOptions(getRouteOptions(routeGuidance.shopId));
      }
    }
  });

  $effect(() => {
    if (selectedShopId) {
      untrack(() => {
        if (useGoogleMaps && map && 'setZoom' in map) {
          // For Google Maps, just center on the shop
          const shop = data.shops.find((s) => `${s.source}-${s.id}` === selectedShopId);
          if (shop) {
            map.setZoom(15);
            (map as google.maps.Map).panTo({
              lat: shop.location.coordinates[1],
              lng: shop.location.coordinates[0]
            });
          }
        } else {
          const route = travelData[selectedShopId!]?.route;
          if (route && map && 'setFitView' in map) {
            map.setFitView([route]);
            routeGuidance.shopId = selectedShopId;
            openRouteGuidance();
          } else {
            const shop = data.shops.find((s) => `${s.source}-${s.id}` === selectedShopId);
            if (shop && map && 'setZoomAndCenter' in map) {
              map.setZoomAndCenter(15, shop.location.coordinates);
            }
          }
        }
      });
    }
  });

  $effect(() => {
    if (
      transportMethod &&
      selectedShopId &&
      travelData[selectedShopId]?.routeData &&
      !useGoogleMaps
    ) {
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
        const markerId = `${shop.source}-${shop.id}`;
        const markerData = markers[markerId];
        if (!markerData) return;

        if (useGoogleMaps) {
          const marker = markerData.marker as google.maps.marker.AdvancedMarkerElement;
          const isSelected = markerId === selected;
          const isHovered = markerId === hovered;

          if (isSelected) {
            Object.values(markers).forEach((markerInfo) => {
              markerInfo.infoWindow?.close();
            });
            markerData.infoWindow?.open(map as google.maps.Map, marker);
          }

          marker.zIndex = isSelected
            ? SELECTED_SHOP_INDEX
            : isHovered
              ? HOVERED_SHOP_INDEX
              : markerData.zIndex;
        } else {
          const marker = markerData.marker as AMap.Marker;
          if (marker.setzIndex)
            marker.setzIndex(
              markerId === selected
                ? SELECTED_SHOP_INDEX
                : markerId === hovered
                  ? HOVERED_SHOP_INDEX
                  : markerData.zIndex
            );
        }

        const element = document.querySelector(
          `#shop-marker-${shop.source}-${shop.id}`
        ) as HTMLElement | null;
        if (element) {
          element.className = element.className.replace(
            /text-error|text-warning dark:text-info|text-info dark:text-success/g,
            ''
          );
          if (selected === markerId) {
            element.classList.add('text-error');
          } else if (hovered === markerId) {
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
    if (!amap || !map || useGoogleMaps) return;
    if (['transit', 'riding', 'driving'].includes(transportMethod!)) {
      if (!trafficLayer && amap.TileLayer) {
        trafficLayer = new amap.TileLayer.Traffic({
          zIndex: 1000,
          autoRefresh: true,
          opacity: 0.5
        });
        if (trafficLayer.setMap) trafficLayer.setMap(map as AMap.Map);
      }
    } else {
      if (trafficLayer && trafficLayer.setMap) trafficLayer.setMap(null);
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

  let selectedTitleIds = $state<number[]>([]);

  const handleTitleFilterChange = (titleId: number) => {
    if (selectedTitleIds.includes(titleId)) {
      selectedTitleIds = selectedTitleIds.filter((id) => id !== titleId);
    } else {
      selectedTitleIds = [...selectedTitleIds, titleId];
    }
  };
</script>

<RouteGuidance
  bind:isOpen={routeGuidance.isOpen}
  shop={routeGuidance.shopId
    ? data.shops.find((s) => `${s.source}-${s.id}` === routeGuidance.shopId)
    : null}
  selectedRouteIndex={routeGuidance.selectedRouteIndex}
  routeData={routeGuidance.shopId ? travelData[routeGuidance.shopId]?.routeData : null}
  isLoading={!!routeGuidance.shopId && !travelData[routeGuidance.shopId]}
  map={map as AMap.Map}
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
      <div class="mb-2 inline-flex items-center gap-2">
        <h1 class="text-3xl font-bold">{m.nearby_arcades()}</h1>
        <div class="dropdown not-sm:dropdown-center">
          <button
            type="button"
            tabindex="0"
            class="btn btn-soft hover:btn-accent btn-sm"
            class:btn-primary={selectedTitleIds.length > 0}
            aria-label={m.filter_by_game_titles()}
          >
            <i class="fa-solid fa-filter"></i>
            {#if selectedTitleIds.length > 0}
              <span class="badge badge-sm">{selectedTitleIds.length}</span>
            {/if}
          </button>
          <div
            role="menu"
            tabindex="-1"
            class="card dropdown-content bg-base-200 text-base-content z-10 mt-2 w-fit font-normal shadow-md"
          >
            <div class="card-body p-4">
              <h3 class="card-title justify-between text-base text-nowrap">
                {m.filter_by_game_titles()}
                <button
                  class="btn btn-sm btn-ghost hover:btn-error"
                  onclick={() => (selectedTitleIds = [])}
                >
                  <i class="fa-solid fa-trash"></i>
                  {m.clear_filters()}
                </button>
              </h3>
              <div class="space-y-2">
                {#each GAMES as game (game.id)}
                  <label class="flex cursor-pointer items-center gap-2 text-nowrap">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm checked:checkbox-success hover:checkbox-accent border-2 transition-colors"
                      checked={selectedTitleIds.includes(game.id)}
                      onchange={() => handleTitleFilterChange(game.id)}
                    />
                    <span class="text-sm">{getGameName(game.key)}</span>
                  </label>
                {/each}
              </div>
            </div>
          </div>
        </div>
      </div>
      <p class="text-base-content/70">
        {m.found_shops_near({
          count: data.shops.length,
          location:
            data.location.name ??
            `(${data.location.longitude.toFixed(6)}, ${data.location.latitude.toFixed(6)})`
        })}
      </p>
    </div>
    <div class="flex flex-col gap-1 {useGoogleMaps ? 'hidden' : ''}">
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
  {#if amapError && !useGoogleMaps}
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
    class="mb-4 h-[50vh] w-full rounded-xl md:h-[60vh] {!useGoogleMaps && !amap
      ? 'bg-base-200 animate-pulse opacity-50'
      : ''}"
    bind:this={mapContainer}
  ></div>
  {#if data.shops.length > 0}
    <div class="overflow-x-auto">
      <table class="bg-base-200/30 dark:bg-base-200/60 table w-full overflow-hidden">
        <thead>
          <tr>
            <th class="text-left">
              {m.shop()}
            </th>
            <th class="text-center not-sm:hidden">
              {m.realtime_attendance()}
            </th>
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
          {#each sortedShops.filter((shop) => selectedTitleIds.length === 0 || selectedTitleIds.every( (id) => shop.games.some((g) => g.titleId === id) )) as shop (shop._id)}
            {@const openingHours = getShopOpeningHours(shop)}
            {@const isShopOpen =
              openingHours &&
              now >= openingHours.openTolerated &&
              now <= openingHours.closeTolerated}
            {#snippet attendance(klass = 'text-sm')}
              {#if isShopOpen}
                {@const currentAttendance = shop.totalAttendance || 0}
                {@const reportedAttendance = shop.currentReportedAttendance}
                {#if reportedAttendance}
                  <AttendanceReportBlame
                    reportedAttendance={{
                      ...reportedAttendance,
                      reportedBy: reportedAttendance.reporter
                    }}
                    class="tooltip-right"
                  >
                    <div class="text-accent not-sm:hidden {klass}">
                      {m.in_attendance({ count: currentAttendance })}
                    </div>
                    <div class="text-accent sm:hidden {klass}">
                      <i class="fa-solid fa-user"></i>
                      {currentAttendance}
                    </div>
                  </AttendanceReportBlame>
                {:else}
                  <div
                    class="text-base-content/60 not-sm:hidden {klass}"
                    class:text-primary={currentAttendance > 0}
                  >
                    {m.in_attendance({ count: currentAttendance })}
                  </div>
                  <div
                    class="text-base-content/60 sm:hidden {klass}"
                    class:text-primary={currentAttendance > 0}
                  >
                    <i class="fa-solid fa-user"></i>
                    {currentAttendance}
                  </div>
                {/if}
              {:else}
                <div class="text-error {klass}">{m.closed()}</div>
              {/if}
            {/snippet}
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
                if (!(isMobileView && routeGuidance.isOpen))
                  mapContainer?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            >
              <td>
                <div class="flex items-center space-x-3">
                  <div>
                    <div class="text-lg font-bold">{shop.name}</div>
                    <span class="text-sm">
                      <span class="opacity-50">{shop.source.toUpperCase()} #{shop.id}</span>
                      <span class="opacity-50 sm:hidden">·</span>
                      <span
                        class="inline-flex whitespace-nowrap transition-opacity not-hover:opacity-50 sm:hidden"
                      >
                        {@render attendance('text-xs')}
                      </span>
                      {#if transportMethod}
                        {@const hasTravelData =
                          travelData[`${shop.source}-${shop.id}`] !== undefined}
                        {@const distance =
                          travelData[`${shop.source}-${shop.id}`]?.distance ?? shop.distance}
                        <span class="opacity-50">·</span>
                        <span
                          class="whitespace-nowrap transition-opacity not-hover:opacity-50 {!hasTravelData
                            ? ''
                            : distance < avgTravelDistance / 1.5
                              ? 'text-success'
                              : distance < avgTravelDistance * 1.5
                                ? 'text-warning'
                                : 'text-error'}"
                        >
                          {formatDistance(distance, 2)}
                        </span>
                      {/if}
                    </span>
                  </div>
                </div>
              </td>
              <td class="text-center not-sm:hidden">
                {@render attendance()}
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
                      {formatDuration(travelData[`${shop.source}-${shop.id}`]?.time)}
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
                      {#if costs[id] && costs[id][game.titleId]}
                        {@const cost = costs[id][game.titleId]}
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
                    href={resolve('/(main)/shops/[source]/[id]', {
                      source: shop.source,
                      id: shop.id.toString()
                    })}
                    target={adaptiveNewTab()}
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

  :global(.gm-style-iw-d) {
    @apply overflow-visible!;
  }

  :global(.gm-ui-hover-effect) {
    @apply transition dark:bg-zinc-300!;
  }

  :global(.gm-ui-hover-effect:hover) {
    @apply dark:bg-zinc-900!;
  }
</style>
