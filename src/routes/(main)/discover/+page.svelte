<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import type { Game, ShopApi, TransportMethod } from '$lib/types';
  import type { TransportSearchResult } from '$lib/types/routing';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { onMount, untrack } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import '$lib/styles/maplibre.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import { SvelteSet } from 'svelte/reactivity';
  import InlineAlert from '$lib/components/InlineAlert.svelte';
  import {
    formatDistance,
    formatDuration,
    generateRouteCacheKey,
    getCachedRouteData,
    setCachedRouteData,
    clearRouteCache,
    pageTitle,
    sanitizeHTML,
    formatShopAddress,
    getGameName,
    adaptiveNewTab,
    isShopCurrentlyOpen,
    regionDatum
  } from '$lib/utils';
  import {
    buildMetroOverlay,
    buildMetroRouteData,
    fetchMetroFare,
    getMetroItinerary,
    getMetroBadgeTextColor,
    getMetroLocalizedName,
    getMetroShopLines,
    type MetroFare,
    METRO_WALK_COLOR
  } from '$lib/utils/metro.client';
  import { fetchMapLink } from '$lib/utils/map-links.client';
  import { getTravelIcon, inferTravelSeconds } from '$lib/utils/travel';
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Directions from '$lib/components/Directions.svelte';
  import {
    GAME_TITLES,
    RADIUS_OPTIONS,
    LIMIT_OPTIONS,
    DISCOVER_TIME_PRIMARY_KEY,
    getTravelBudgetMinutes
  } from '$lib/constants';
  import { createMapLibreAdapter } from 'unified-geo-client/maplibre';
  import { isDarkMode, fromPath } from '$lib/utils/scoped';
  import AttendanceReportBlame from '$lib/components/AttendanceReportBlame.svelte';
  import ShopFilterPanel from '$lib/components/ShopFilterPanel.svelte';
  import { emptyShopFilterState, type ShopFilterState } from '$lib/schemas/shop-filter';
  import {
    countActiveFilters,
    parseShopFilterParam,
    serializeShopFilterState,
    withoutGeoFilter
  } from '$lib/utils/shops/filter';

  maplibregl.setWorkerUrl(workerUrl);

  let { data } = $props();

  let screenWidth = $state(0);

  let now = $state(new Date());

  let mapContainer: HTMLDivElement | undefined = $state(undefined);
  let map: maplibregl.Map | undefined = $state(undefined);
  let mapError = $state('');
  // The origin's map adapter: owns the profile-driven style, its request
  // rewrites, and the traffic overlay.
  let mapAdapter: ReturnType<typeof createMapLibreAdapter> | null = $state(null);

  let hoveredShopId: string | null = $state(null);
  let selectedShopId: string | null = $state(null);
  let highlightedShopId: string | null = $state(null);
  let highlightedShopIdTimeout: ReturnType<typeof setTimeout> | null = $state(null);
  let darkMode = $derived(browser ? isDarkMode() : undefined);
  let transportMethod = $state<TransportMethod>(undefined); // 'transit', 'walking', 'riding', 'driving'
  let discoverRadius = $derived(data.radius ?? 10);
  let discoverLimit = $derived(data.limit ?? 20);
  /**
   * Live routing results per shop: the mode's best route (time, distance,
   * geometry for the map) plus the full response for the Directions panel.
   */
  let travelData = $state<
    Record<
      string,
      {
        time: number;
        distance: number;
        path: [number, number][];
        selectedRouteIndex: number;
        routeData?: TransportSearchResult;
      } | null
    >
  >({});
  let directions = $state<{ isOpen: boolean; shopId: string | null; selectedRouteIndex: number }>({
    isOpen: false,
    shopId: null,
    selectedRouteIndex: 0
  });
  let cachedRoutes = $state<
    Record<string, { routeData: TransportSearchResult; selectedRouteIndex: number }>
  >({}); // cacheKey -> cached route data

  let costs: Record<string, Record<string, { preview: string; full: string }>> = $state({});
  let discoverTableContainer: HTMLDivElement | undefined = $state(undefined);

  /**
   * Metro features render whenever the response carries a metro block: only
   * origins whose nearby shops have metro assignments produce one.
   */
  let metroEnabled = $derived(Boolean(data.metro));

  /**
   * A shop as returned by the discover endpoint: the persisted shop plus the
   * server's distance, and a travel estimate only when the metro genuinely
   * beats walking there.
   */
  type DiscoverShop = (typeof data.shops)[number];

  /** The server's metro estimate for a shop, when it has one. */
  const shopTravelSeconds = (shop: DiscoverShop): number | null => shop.travel?.seconds ?? null;

  /**
   * Whether the travel column leads with time rather than distance. Persisted
   * so the choice survives reloads and navigation.
   */
  let timePrimary = $state(true);

  $effect(() => {
    if (!browser) return;
    const stored = localStorage.getItem(DISCOVER_TIME_PRIMARY_KEY);
    if (stored !== null) timePrimary = stored === 'true';
  });

  const setTimePrimary = (value: boolean) => {
    timePrimary = value;
    if (browser) localStorage.setItem(DISCOVER_TIME_PRIMARY_KEY, String(value));
  };

  /**
   * Every shop's displayed travel figure, resolved once and shared by the
   * table, the sort, and the color ramps:
   *
   *  1. a live routed result from the location service (the most accurate),
   *  2. the server's metro estimate (a real itinerary),
   *  3. a straight-line inference (rough, but it means the column can show a
   *     time for every row rather than leaving most of them blank).
   *
   * `source` records which of the three produced the value, so the UI can mark
   * inferred figures and the Directions panel can prefer the accurate ones.
   */
  type TravelInfo = {
    seconds: number;
    distanceKm: number;
    source: 'route' | 'metro' | 'inferred';
  };

  let travelInfoById = $derived.by(() => {
    const result: Record<string, TravelInfo> = {};

    for (const shop of data.shops) {
      const id = `${shop.id}`;
      const live = travelData[id];

      if (live && live.time) {
        result[id] = { seconds: live.time, distanceKm: live.distance, source: 'route' };
        continue;
      }

      const metroSeconds = shopTravelSeconds(shop);
      if (metroSeconds !== null) {
        result[id] = { seconds: metroSeconds, distanceKm: shop.distance, source: 'metro' };
        continue;
      }

      result[id] = {
        seconds: inferTravelSeconds(shop.distance),
        distanceKm: shop.distance,
        source: 'inferred'
      };
    }

    return result;
  });

  /** Travel figure for a shop; every shop has one. */
  const shopTravel = (shop: DiscoverShop): TravelInfo =>
    travelInfoById[`${shop.id}`] ?? {
      seconds: inferTravelSeconds(shop.distance),
      distanceKm: shop.distance,
      source: 'inferred'
    };

  /**
   * Itineraries are static for a given response, so each shop's reconstructed
   * metro route is built once and reused by the Directions panel and the hover
   * overlay. Fares (the only live openmetro call) are layered on top.
   */
  let metroFares = $state<Record<string, MetroFare | null>>({});
  const metroFareRequests = new SvelteSet<string>();

  /**
   * Route data for metro-reachable shops, keyed by id, in the shape
   * `<Directions>` and the hover overlay expect. Shops without a worthwhile
   * metro trip get no entry — the panel then falls back to the live route (or
   * shows nothing), exactly as before metro existed.
   */
  let shopRouteData = $derived.by(() => {
    const result: Record<string, TransportSearchResult> = {};
    if (!metroEnabled) return result;
    for (const shop of data.shops) {
      if (!shop.travel) continue;
      const routeData = buildMetroRouteData(shop, data.metro);
      if (routeData) result[`${shop.id}`] = routeData;
    }
    return result;
  });

  /**
   * Whether a shop's metro itinerary — not a live route — is what the
   * Directions panel should show. A live route wins whenever one arrived,
   * because a real routed path beats a straight-line-derived estimate.
   */
  const prefersMetroItinerary = (shopId: string): boolean =>
    Boolean(shopRouteData[shopId]) && !travelData[shopId]?.routeData;

  const shopTravelIcon = (shop: DiscoverShop): string => {
    const travel = shopTravel(shop);
    if (travel.source === 'metro') return 'fa-train-subway';
    if (travel.source === 'inferred') return getTravelIcon(undefined);
    const route = travelData[`${shop.id}`];
    return getTravelIcon(transportMethod, route?.routeData, route?.selectedRouteIndex);
  };

  const travelTimeLevel = (seconds: number): 'success' | 'warning' | 'error' => {
    if (seconds < Math.max(avgTravelTime / 1.5, 1200)) return 'success';
    if (seconds < Math.max(avgTravelTime * 1.5, 2400)) return 'warning';
    return 'error';
  };

  const travelDistanceLevel = (distanceKm: number): 'success' | 'warning' | 'error' => {
    if (distanceKm < avgTravelDistance / 1.5) return 'success';
    if (distanceKm < avgTravelDistance * 1.5) return 'warning';
    return 'error';
  };

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
        const stored = localStorage.getItem(`nearcade-shop-${shop.id}-count`);
        if (stored) {
          newCounts[`${shop.id}`] = parseInt(stored, 10) || 0;
        }
      });
      shopClickCounts = newCounts;
    }
  });

  // Function to handle shop interaction clicks (details/route buttons)
  const handleShopClick = async (shop: ShopApi) => {
    if (!browser || !user) return;

    const currentCount = shopClickCounts[`${shop.id}`] || 0;
    const newCount = currentCount + 1;

    // Update localStorage and state
    localStorage.setItem(`nearcade-shop-${shop.id}-count`, newCount.toString());
    shopClickCounts = { ...shopClickCounts, [`${shop.id}`]: newCount };

    // Check if threshold is reached and user isn't already frequenting this arcade
    if (newCount >= discoveryInteractionThreshold && !user.frequentingArcades?.includes(shop.id)) {
      try {
        // Submit form to add arcade automatically
        const formData = new FormData();
        formData.append('arcadeId', shop.id.toString());

        const response = await fetch(
          resolve('/(main)/settings/frequenting-arcades') + '?/addArcade',
          {
            method: 'POST',
            body: formData
          }
        );

        if (response.ok) {
          localStorage.removeItem(`nearcade-shop-${shop.id}-count`);
          shopClickCounts = { ...shopClickCounts, [`${shop.id}`]: 0 };
        }
      } catch (error) {
        console.error('Failed to auto-add arcade:', error);
      }
    }
  };

  let avgTravelTime = $derived.by(() => {
    // Only figures we can stand behind drive the colour ramp: the straight-line
    // inferences are uniformly spread and would only flatten the comparison.
    const times = data.shops
      .map((shop) => shopTravel(shop))
      .filter((travel) => travel.source !== 'inferred')
      .map((travel) => travel.seconds);
    return times.length > 0 ? times.reduce((sum, time) => sum + time, 0) / times.length : 0;
  });

  let avgTravelDistance = $derived.by(() => {
    return data.shops.reduce((sum, shop) => sum + shop.distance, 0) / data.shops.length;
  });

  let sortedShops = $derived.by(() => {
    // Always sort by the current primary metric so the table order matches
    // what the travel column leads with. Time-first is the default: a
    // straight-line distance says very little about how long the trip
    // actually takes, but a real figure (routed/metro) beats an inferred one —
    // `shopTravel` already encodes that precedence.
    return [...data.shops].sort((a, b) => {
      if (timePrimary) {
        const timeA = shopTravel(a).seconds;
        const timeB = shopTravel(b).seconds;
        if (timeA !== timeB) return timeA - timeB;
      }
      const distanceA = shopTravel(a).distanceKm;
      const distanceB = shopTravel(b).distanceKm;
      if (distanceA !== distanceB) return distanceA - distanceB;
      return a.id - b.id;
    });
  });

  let activeShops = $derived(sortedShops.filter((shop) => !shop.isClosed));
  let closedShops = $derived(sortedShops.filter((shop) => shop.isClosed));
  let closedShopsExpanded = $state(false);

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

  /**
   * "Open in maps app" affordance for a shop: the link resolves per platform
   * through /api/geo/links, so the handler opens whatever the user's device
   * understands — no provider URLs live in the client.
   */
  const openExternalRoute = async (shop: DiscoverShop) => {
    const link = await fetchMapLink({
      longitude: shop.location.coordinates[0],
      latitude: shop.location.coordinates[1],
      name: shop.name,
      mode: 'navigation',
      travelMode:
        transportMethod === 'walking'
          ? 'walking'
          : transportMethod === 'riding'
            ? 'cycling'
            : transportMethod === 'driving'
              ? 'driving'
              : 'transit'
    });
    if (browser && link) window.open(link, '_blank', 'noopener,noreferrer');
  };

  /** Per-platform external link for the open Directions panel. */
  let mapLink = $state<string | null>(null);

  const showDirections = () => {
    if (directions.isOpen || !directions.shopId || directions.shopId !== selectedShopId) return;
    openDirections();
  };

  const openDirections = () => {
    directions.isOpen = true;
    if (isMobileView) {
      mapContainer?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  };

  /** The discover origin's datum: the map surface it was captured on. */
  let datumOfOrigin: 'WGS84' | 'GCJ02' = 'WGS84';

  /** Cache entries from the previous engine carry incompatible shapes. */
  const isValidRouteData = (value: unknown): value is { routes: import('$lib/types/routing').RouteResult[] } =>
    typeof value === 'object' &&
    value !== null &&
    'routes' in value &&
    Array.isArray((value as { routes: unknown }).routes) &&
    (value as { routes: unknown[] }).routes.every(
      (route) =>
        typeof route === 'object' &&
        route !== null &&
        'geometry' in route &&
        'durationSeconds' in route
    );

  /**
   * Live travel times for every shop through the routing proxy. The server
   * caches and rate-limits upstream; results draw as route layers and feed
   * the Directions panel. Selected shop first, the rest in table order.
   */
  const calculateTravelData = async (method: Exclude<TransportMethod, undefined>) => {
    if (!data || data.shops.length === 0) return;
    travelData = {};

    const { quota, usage } = await navigator.storage.estimate();
    if (quota && usage && usage > quota * 0.94) {
      await clearRouteCache(data.shops.length);
    } else {
      await clearRouteCache();
    }

    const mode = method === 'riding' ? 'cycling' : method;

    const processShop = async (shop: ShopApi): Promise<void> => {
      const applyRouteData = (result: TransportSearchResult, selectedIndex: number) => {
        if (!isValidRouteData(result)) return;
        const sorted = [...result.routes].sort((a, b) => a.durationSeconds - b.durationSeconds);
        const selectedRoute = sorted[selectedIndex];
        if (!selectedRoute) return;

        travelData[`${shop.id}`] = {
          time: selectedRoute.durationSeconds,
          distance: selectedRoute.distanceMeters / 1000,
          path: selectedRoute.geometry,
          selectedRouteIndex: selectedIndex,
          routeData: { routes: result.routes }
        };
      };

      const cacheKey = generateRouteCacheKey(
        data.location.latitude,
        data.location.longitude,
        `${shop.id}`,
        method
      );

      // Check cache first
      const cachedData = await getCachedRouteData(cacheKey);
      if (cachedData && isValidRouteData(cachedData.routeData)) {
        cachedRoutes[cacheKey] = cachedData;
        applyRouteData(cachedData.routeData, cachedData.selectedRouteIndex);
        return;
      }

      try {
        const response = await fetch('/api/geo/directions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            origin: {
              longitude: data.location.longitude,
              latitude: data.location.latitude,
              // The discover origin arrives in the map surface's datum (the
              // globe or picker sent it that way); keep it labeled so routes
              // come back drawable on this map without conversion.
              coordinateSystem: datumOfOrigin
            },
            destination: {
              longitude: shop.location.coordinates[0],
              latitude: shop.location.coordinates[1],
              // Shops persist in their region's storage datum.
              coordinateSystem: regionDatum(shop.address?.region ?? [])
            },
            mode,
            language: getLocale()
          })
        });
        if (!response.ok) throw new Error(`routing failed: ${response.status}`);
        const result = (await response.json()) as TransportSearchResult;
        if (isValidRouteData(result)) {
          setCachedRouteData(cacheKey, result, 0);
          cachedRoutes[cacheKey] = { routeData: result, selectedRouteIndex: 0 };
          applyRouteData(result, 0);
        } else {
          travelData[`${shop.id}`] = null;
        }
      } catch (error) {
        console.error(`Error calculating travel data for shop ${shop.id}:`, error);
        travelData[`${shop.id}`] = null;
      }
    };

    for (const shop of [
      ...data.shops.filter((entry) => `${entry.id}` === selectedShopId),
      ...data.shops.filter((entry) => `${entry.id}` !== selectedShopId)
    ]) {
      await processShop(shop);
    }
  };

  const findGame = (games: Game[], titleId: number): Game | null => {
    return games?.find((game) => game.titleId === titleId) || null;
  };

  const allGames = GAME_TITLES.map((game) => ({
    id: game.id,
    name: getGameName(game.key)
  }));
  const gameOrder = new Map(allGames.map((game, index) => [game.id, index]));

  // Structured shop filter (URL `f` param); legacy `gameTitleIds` seed it so
  // old links keep working. `selectedTitleIds` stays as the ordered title list
  // derived from the expression (it drives the game-column ordering).
  // `geo` is stripped: this page's own `longitude`/`latitude`/`radius` are the
  // distance truth here (they also drive metro routing), so a geo filter on
  // discover would be a control that quietly does nothing.
  let filterPanelOpen = $state(false);
  // Initial capture is intentional: the seed runs once at init and the URL
  // `f` param is the source of truth afterwards (applyDiscoverFilter).
  // svelte-ignore state_referenced_locally
  let filterState = $state<ShopFilterState>(
    withoutGeoFilter(
      parseShopFilterParam(page.url.searchParams.get('f')) ??
        (data.gameTitleIds && data.gameTitleIds.length > 0
          ? {
              v: 1,
              games: {
                op: 'and',
                children: data.gameTitleIds.map((titleId) => ({ titleIds: [titleId] }))
              }
            }
          : emptyShopFilterState())
    )
  );
  const selectedTitleIds = $derived.by(() => {
    const ids: number[] = [];
    const walk = (expr: NonNullable<ShopFilterState['games']>): void => {
      for (const child of expr.children) {
        if ('op' in child) walk(child);
        else {
          for (const titleId of child.titleIds ?? []) {
            if (!ids.includes(titleId)) ids.push(titleId);
          }
        }
      }
    };
    if (filterState.games) walk(filterState.games);
    return ids;
  });
  let showAbsentGames = $state(false);

  const applyDiscoverFilter = (state: ShopFilterState) => {
    // Belt and braces: the panel already drops geo, so a hand-built state
    // cannot reintroduce a radius this page does not apply.
    filterState = withoutGeoFilter(state);
    filterPanelOpen = false;

    if (browser) {
      const url = new URL(window.location.href);
      if (countActiveFilters(state) > 0) {
        url.searchParams.set('f', serializeShopFilterState(state));
      } else {
        url.searchParams.delete('f');
      }
      // The structured filter supersedes the legacy game-title parameter.
      url.searchParams.delete('gameTitleIds');
      goto(url.toString(), { replaceState: true, keepFocus: true, noScroll: true });
    }
  };

  let visibleGameIds = $derived.by(() => {
    const ids = [...selectedTitleIds];

    sortedShops.forEach((shop) => {
      shop.games.forEach((game) => {
        if (!ids.includes(game.titleId)) {
          ids.push(game.titleId);
        }
      });
    });

    return ids;
  });

  let hiddenAbsentGames = $derived.by(() => {
    return allGames.filter((game) => !visibleGameIds.includes(game.id));
  });

  let displayedGames = $derived.by(() => {
    const baseGames = showAbsentGames
      ? allGames
      : allGames.filter((game) => visibleGameIds.includes(game.id));

    return [...baseGames].sort((gameA, gameB) => {
      const selectedIndexA = selectedTitleIds.indexOf(gameA.id);
      const selectedIndexB = selectedTitleIds.indexOf(gameB.id);

      if (selectedIndexA !== -1 || selectedIndexB !== -1) {
        if (selectedIndexA === -1) return 1;
        if (selectedIndexB === -1) return -1;
        return selectedIndexA - selectedIndexB;
      }

      return (gameOrder.get(gameA.id) ?? 0) - (gameOrder.get(gameB.id) ?? 0);
    });
  });

  const handleResize = () => {
    screenWidth = window.innerWidth;
  };

  onMount(() => {
    screenWidth = window.innerWidth;
    window.addEventListener('resize', handleResize);

    const interval = setInterval(() => {
      now = new Date();
    }, 1000);

    Promise.all(
      data.shops.flatMap((shop) => {
        costs[`${shop.id}`] = {};
        shop.games.map(async (game) => {
          costs[`${shop.id}`][game.titleId] = {
            preview: await sanitizeHTML(game.cost.substring(0, 30)),
            full: await sanitizeHTML(game.cost)
          };
        });
      })
    );

    return () => {
      window.removeEventListener('resize', handleResize);
      clearInterval(interval);
    };
  });

  /**
   * A shop marker: a dot that sits on the shop's coordinate plus a name chip
   * that floats beside it. MapLibre centres the marker's own box on the
   * coordinate and the chip is positioned outside that box, so the dot — not
   * the label — marks the place. `data-side` flips the chip to the dot's left
   * near the map's right edge; `data-state` carries selection/hover, which the
   * stylesheet turns into the dot's colour.
   */
  const createShopMarkerElement = (shop: DiscoverShop) => {
    const element = document.createElement('div');
    element.id = `shop-marker-${shop.id}`;
    element.className = 'discover-marker cursor-pointer';
    element.dataset.state = 'idle';
    element.dataset.side = 'end';

    const dot = document.createElement('span');
    dot.className = 'discover-marker-dot';
    element.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'discover-marker-label';
    if (metroEnabled && shop.transit?.metro) {
      const lineGroup = document.createElement('span');
      lineGroup.className = 'discover-marker-lines';
      for (const line of getMetroShopLines(shop, data.metro)) {
        const chip = document.createElement('span');
        chip.className = 'discover-marker-line';
        const color = line.color ?? '#64748b';
        chip.style.backgroundColor = color;
        chip.style.color = getMetroBadgeTextColor(color);
        chip.textContent = line.shortName;
        lineGroup.appendChild(chip);
      }
      label.appendChild(lineGroup);
    }
    const name = document.createElement('span');
    name.className = 'discover-marker-name';
    // DOM text nodes escape external names; no HTML interpolation.
    name.textContent = shop.name;
    label.appendChild(name);
    element.appendChild(label);
    return element;
  };

  const createOriginMarkerElement = () => {
    const element = document.createElement('div');
    element.className = 'discover-marker discover-marker-origin cursor-pointer';
    element.dataset.state = 'origin';
    element.dataset.side = 'end';

    const dot = document.createElement('span');
    dot.className = 'discover-marker-dot';
    element.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'discover-marker-label discover-marker-label-static';
    label.textContent = m.origin();
    element.appendChild(label);
    return element;
  };

  let activePopup: maplibregl.Popup | null = null;

  const popupContent = (shop: DiscoverShop, address: string): HTMLElement => {
    const container = document.createElement('div');
    container.className = 'mt-2 min-w-48 max-w-80 space-y-2';
    const header = document.createElement('div');
    header.className = 'space-y-0.25';
    const title = document.createElement('div');
    title.className = 'font-semibold text-lg';
    title.textContent = shop.name;
    const addressLine = document.createElement('div');
    addressLine.className = 'text-sm opacity-70';
    addressLine.textContent = address;
    header.append(title, addressLine);
    const actions = document.createElement('div');
    actions.className = 'flex gap-2';
    const link = document.createElement('button');
    link.className = 'btn btn-dash btn-neutral';
    const icon = document.createElement('i');
    icon.className = 'fas fa-external-link-alt';
    const text = document.createElement('span');
    text.textContent = m.open_in_maps_app();
    link.append(icon, text);
    link.onclick = async () => {
      const target = await fetchMapLink({
        longitude: shop.location.coordinates[0],
        latitude: shop.location.coordinates[1],
        name: shop.name
      });
      if (target) window.open(target, '_blank', 'noopener,noreferrer');
    };
    actions.appendChild(link);
    container.append(header, actions);
    return container;
  };

  const showShopPopup = (instance: maplibregl.Map, shop: DiscoverShop) => {
    const address = formatShopAddress(shop);
    const popup = new maplibregl.Popup({ offset: 24, closeButton: true })
      .setLngLat([shop.location.coordinates[0], shop.location.coordinates[1]])
      .setDOMContent(popupContent(shop, address))
      .addTo(instance);
    popup.on('close', () => {
      if (selectedShopId === `${shop.id}`) selectedShopId = null;
    });
    activePopup = popup;
  };

  const handleMarkerClick = (shopId: string) => {
    const wasSelected = selectedShopId === shopId;
    const hasRoute = Boolean(travelData[shopId]?.routeData || shopRouteData[shopId]);
    selectedShopId = shopId;

    if (highlightedShopIdTimeout) {
      clearTimeout(highlightedShopIdTimeout);
      highlightedShopIdTimeout = null;
    }
    highlightedShopId = null;

    if (hasRoute && !wasSelected) return;

    highlightedShopId = shopId;
    highlightedShopIdTimeout = setTimeout(() => {
      highlightedShopId = null;
      highlightedShopIdTimeout = null;
    }, 3000);
    document.getElementById(`shop-${shopId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  };

  // ── Map lifecycle ─────────────────────────────────────────────────────────

  const ROUTES_SOURCE_ID = 'shop-routes';
  const ROUTE_LINE_LAYER_ID = 'shop-routes-line';
  const METRO_SOURCE_ID = 'metro-overlay';
  const METRO_LAYER_ID = 'metro-overlay-line';

  const removeLayerAndSource = (instance: maplibregl.Map, id: string) => {
    try {
      if (instance.getLayer(id)) instance.removeLayer(id);
      if (instance.getSource(id)) instance.removeSource(id);
    } catch {
      // Map may already be destroyed during navigation.
    }
  };

  const fitToShops = (instance: maplibregl.Map) => {
    const bounds = new maplibregl.LngLatBounds();
    bounds.extend([data.location.longitude, data.location.latitude]);
    for (const shop of data.shops) {
      if (shop.isClosed) continue;
      bounds.extend(shop.location.coordinates as [number, number]);
    }
    if (!bounds.isEmpty()) {
      instance.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 0 });
    }
  };

  let shopMarkerElements: Record<string, HTMLElement> = $state({});

  // ── Marker labels ─────────────────────────────────────────────────────────

  /** Label placement order: the selection, then the hover, then table order. */
  const markerLabelPriority = (shopId: string): number => {
    if (shopId === selectedShopId) return 0;
    if (shopId === hoveredShopId) return 1;
    return 2;
  };

  /**
   * How many name chips the map may show at once: fewer on a phone-sized
   * viewport, more as the map zooms in — a city-wide view keeps only its
   * leading shops labelled, a street-level view can afford most of them.
   */
  const markerLabelBudget = (zoom: number): number => {
    const base = isMobileView ? 3 : 6;
    const perZoom = isMobileView ? 1.5 : 2.5;
    return Math.round(base + Math.max(0, zoom - 10) * perZoom);
  };

  const rectsOverlap = (a: DOMRect, b: DOMRect, padding: number): boolean =>
    a.left - padding < b.right &&
    a.right + padding > b.left &&
    a.top - padding < b.bottom &&
    a.bottom + padding > b.top;

  /**
   * Decide which name chips are readable. Every marker keeps its dot; only the
   * chips compete for room, so a chip that would overlap a chip with a stronger
   * claim fades out instead of fighting over the same pixels. The selected and
   * hovered shops always keep theirs.
   *
   * Colliding chips are hidden with `visibility`, never `display`, so their
   * boxes keep their measured size and the next pass can reclaim them without
   * a re-layout round trip.
   */
  const refreshMarkerLabels = () => {
    const instance = map;
    if (!instance) return;

    const width = instance.getContainer().clientWidth;
    const entries: { shop: DiscoverShop; label: HTMLElement }[] = [];

    for (const shop of sortedShops) {
      const element = shopMarkerElements[`${shop.id}`];
      const label = element?.querySelector<HTMLElement>('.discover-marker-label');
      if (!element || !label) continue;
      // A hidden marker neither shows a label nor reserves room for one.
      if (shop.isClosed && !closedShopsExpanded) continue;
      // Write before measuring: a flipped chip must be laid out on its new side.
      const side =
        instance.project(shop.location.coordinates as [number, number]).x > width * 0.72
          ? 'start'
          : 'end';
      if (element.dataset.side !== side) element.dataset.side = side;
      entries.push({ shop, label });
    }

    // Read pass: one layout flush for every chip on the map.
    const measured = entries.map((entry) => entry.label.getBoundingClientRect());

    const order = entries
      .map((entry, index) => ({
        index,
        rect: measured[index]!,
        priority: markerLabelPriority(`${entry.shop.id}`)
      }))
      .sort((a, b) => a.priority - b.priority);
    const budget = markerLabelBudget(instance.getZoom());
    const placed: DOMRect[] = [];
    const keep = new Array<boolean>(entries.length).fill(false);
    let shown = 0;

    for (const { index, rect, priority } of order) {
      // A chip that has never been laid out has no room to claim yet.
      if (rect.width === 0) continue;
      if (priority > 1) {
        if (shown >= budget) continue;
        if (placed.some((other) => rectsOverlap(other, rect, 4))) continue;
      }
      placed.push(rect);
      keep[index] = true;
      shown++;
    }

    for (const [index, entry] of entries.entries()) {
      entry.label.classList.toggle('is-colliding', !keep[index]);
    }
  };

  let markerLabelFrame: number | null = null;

  /** Coalesce the bursts of `move`/`zoom`/`resize` events into one pass a frame. */
  const scheduleMarkerLabels = () => {
    if (markerLabelFrame !== null) return;
    markerLabelFrame = requestAnimationFrame(() => {
      markerLabelFrame = null;
      refreshMarkerLabels();
    });
  };

  $effect(() => {
    if (!mapContainer || !data || darkMode === undefined || mapError) return;

    let cancelled = false;
    let instance: maplibregl.Map | undefined;

    void (async () => {
      try {
        const theme = darkMode ? 'dark' : 'light';
        // The style is selected per origin point by the location service; the
        // adapter normalizes it, wires non-standard tile sources through its
        // protocol, and exposes the traffic overlay for this surface.
        const styleResponse = await fetch(
          fromPath(
            `/api/geo/map-style?longitude=${data.location.longitude}&latitude=${data.location.latitude}&theme=${theme}&locale=${getLocale()}&scope=regional`
          )
        );
        if (!styleResponse.ok) throw new Error(`Map style request failed: ${styleResponse.status}`);
        const { profile, style: servedStyle } = (await styleResponse.json()) as {
          profile: Record<string, unknown>;
          style: unknown;
        };
        // The surface datum of the resolved profile is what the origin and the
        // returned shops are already drawn in.
        datumOfOrigin =
          (profile as { coordinateSystem?: 'WGS84' | 'GCJ02' }).coordinateSystem ?? 'WGS84';
        if (cancelled || !mapContainer) return;

        const adapter = createMapLibreAdapter(profile as never, {
          localFonts: { stacks: ['Sora', 'Noto'], baseUrl: fromPath('/') }
        });
        adapter.registerProtocols();
        const style = await adapter.loadStyle(servedStyle);
        if (cancelled || !mapContainer) return;
        mapAdapter = adapter;

        instance = new maplibregl.Map({
          container: mapContainer,
          style: style as unknown as maplibregl.StyleSpecification,
          center: [data.location.longitude, data.location.latitude],
          zoom: 10,
          transformRequest: adapter.transformRequest,
          attributionControl: { compact: true }
        });
        map = instance;
        const activeMap: maplibregl.Map = instance;
        instance.addControl(new maplibregl.NavigationControl(), 'top-right');

        // Origin marker. MapLibre orders markers by DOM order; the highlight
        // effect manages stacking through the element's z-index style.
        const originMarker = new maplibregl.Marker({
          element: createOriginMarkerElement()
        })
          .setLngLat([data.location.longitude, data.location.latitude])
          .addTo(instance);
        originMarker.getElement().style.zIndex = '500';

        // Shop markers with metro line chips and names.
        const elements: Record<string, HTMLElement> = {};
        for (const shop of data.shops) {
          const marker = new maplibregl.Marker({
            element: createShopMarkerElement(shop)
          })
            .setLngLat(shop.location.coordinates as [number, number])
            .addTo(instance);
          const element = marker.getElement();
          element.style.zIndex = '400';
          element.addEventListener('mouseenter', () => {
            hoveredShopId = `${shop.id}`;
          });
          element.addEventListener('mouseleave', () => {
            if (hoveredShopId === `${shop.id}`) hoveredShopId = null;
          });
          element.addEventListener('click', (event) => {
            event.stopPropagation();
            activePopup?.remove();
            showShopPopup(activeMap, shop);
            handleMarkerClick(`${shop.id}`);
          });
          if (shop.isClosed) {
            element.style.visibility = 'hidden';
          }
          elements[`${shop.id}`] = element;
        }
        shopMarkerElements = elements;

        activePopup = null;
        fitToShops(instance);

        // Labels are placed against the settled viewport, and re-placed
        // whenever the map moves or resizes. The passes that define the
        // *settled* state run synchronously rather than through a frame:
        // `requestAnimationFrame` is throttled hard in a background or
        // occluded tab, and the labels should be decluttered before the map is
        // first painted anyway. Only the drag-time pass is frame-paced, since
        // it exists to keep up with motion.
        instance.on('move', scheduleMarkerLabels);
        instance.on('moveend', refreshMarkerLabels);
        instance.on('resize', refreshMarkerLabels);
        instance.once('idle', refreshMarkerLabels);
        refreshMarkerLabels();
        if (typeof document !== 'undefined' && document.fonts) {
          void document.fonts.ready.then(() => refreshMarkerLabels());
        }
      } catch (error) {
        console.error('Failed to initialize the discover map:', error);
        if (!cancelled) mapError = String(error);
      }
    })();

    return () => {
      cancelled = true;
      if (markerLabelFrame !== null) {
        cancelAnimationFrame(markerLabelFrame);
        markerLabelFrame = null;
      }
      activePopup?.remove();
      activePopup = null;
      shopMarkerElements = {};
      instance?.remove();
      if (map === instance) {
        map = undefined;
        mapAdapter = null;
      }
    };
  });

  // Closed-shop visibility follows the expand toggle; the labels they free up
  // are handed to the shops still on the map.
  $effect(() => {
    const expanded = closedShopsExpanded;
    untrack(() => {
      for (const shop of data.shops) {
        if (!shop.isClosed) continue;
        const element = shopMarkerElements[`${shop.id}`];
        if (element) element.style.visibility = expanded ? '' : 'hidden';
      }
      scheduleMarkerLabels();
    });
  });

  // Theme changes re-select the style for the current surface.
  $effect(() => {
    if (!map || darkMode === undefined) return;
    const theme = darkMode ? 'dark' : 'light';
    untrack(async () => {
      try {
        const response = await fetch(
          fromPath(
            `/api/geo/map-style?longitude=${data.location.longitude}&latitude=${data.location.latitude}&theme=${theme}&locale=${getLocale()}&scope=regional`
          )
        );
        if (!response.ok) return;
        const { profile, style: servedStyle } = (await response.json()) as {
          profile: Record<string, unknown>;
          style: unknown;
        };
        const adapter = createMapLibreAdapter(profile as never, {
          localFonts: { stacks: ['Sora', 'Noto'], baseUrl: fromPath('/') }
        });
        const style = (await adapter.loadStyle(servedStyle)) as unknown as maplibregl.StyleSpecification;
        mapAdapter = adapter;
        map?.setStyle(style, { diff: false });
      } catch {
        // Keep the current style; the next full reload picks the theme up.
      }
    });
  });

  // Live routing per selected transport method.
  $effect(() => {
    if (!map) return;
    if (transportMethod) {
      const method = transportMethod;
      untrack(async () => {
        await calculateTravelData(method);
      });
      return () => {
        clearShopRoutes();
      };
    }
    travelData = {};
  });

  // ── Route layers: one GeoJSON source restyled per hover/selection ─────────

  const clearShopRoutes = () => {
    const instance = map;
    if (!instance) return;
    removeLayerAndSource(instance, ROUTE_LINE_LAYER_ID);
    removeLayerAndSource(instance, ROUTES_SOURCE_ID);
  };

  $effect(() => {
    const instance = map;
    if (!instance || !instance.isStyleLoaded()) return;
    const routeEntries = Object.entries(travelData).filter(
      ([, travel]) => travel?.path && travel.path.length >= 2
    );
    untrack(() => {
      if (routeEntries.length === 0) {
        clearShopRoutes();
        return;
      }
      const features = routeEntries.map(([shopId, travel]) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: travel!.path },
        id: shopId,
        properties: { shopId }
      }));
      const source = instance.getSource(ROUTES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData({ type: 'FeatureCollection', features });
      } else {
        instance.addSource(ROUTES_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features }
        });
        instance.addLayer({
          id: ROUTE_LINE_LAYER_ID,
          type: 'line',
          source: ROUTES_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              '#00ff00',
              ['boolean', ['feature-state', 'hovered'], false],
              '#ffa500',
              '#00e5ff'
            ],
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              3.8,
              ['boolean', ['feature-state', 'hovered'], false],
              4.2,
              3
            ],
            'line-opacity': [
              'case',
              ['boolean', ['feature-state', 'faded'], false],
              0,
              ['boolean', ['feature-state', 'highlighted'], false],
              1,
              0.4
            ]
          }
        });
        instance.on('click', ROUTE_LINE_LAYER_ID, (event) => {
          const shopId = event.features?.[0]?.properties?.shopId;
          if (shopId) {
            selectedShopId = `${shopId}`;
            showDirections();
          }
        });
        instance.on('mouseenter', ROUTE_LINE_LAYER_ID, () => {
          instance.getCanvas().style.cursor = 'pointer';
        });
        instance.on('mouseleave', ROUTE_LINE_LAYER_ID, () => {
          instance.getCanvas().style.cursor = '';
        });
      }
      // Push hover/selection into feature state.
      for (const [shopId] of routeEntries) {
        instance.setFeatureState(
          { source: ROUTES_SOURCE_ID, id: shopId },
          {
            selected: selectedShopId === shopId,
            hovered: hoveredShopId === shopId,
            faded: directions.isOpen && directions.shopId === shopId,
            highlighted:
              (selectedShopId === shopId || hoveredShopId === shopId) &&
              !(directions.isOpen && directions.shopId === shopId)
          }
        );
      }
    });
  });

  // Selection drives the camera and opens the Directions panel.
  $effect(() => {
    if (!selectedShopId || !map) return;
    const instance = map;
    untrack(() => {
      const shop = data.shops.find((s) => `${s.id}` === selectedShopId);
      if (!shop) return;
      const route = travelData[selectedShopId!]?.path;
      if (route && route.length >= 2) {
        const bounds = new maplibregl.LngLatBounds();
        for (const [lng, lat] of route) bounds.extend([lng, lat]);
        instance.fitBounds(bounds, { padding: 72, duration: 600, maxZoom: 16 });
        directions.shopId = selectedShopId;
        openDirections();
      } else if (shopRouteData[selectedShopId!]) {
        // No live route for this shop, but the server supplied a metro
        // itinerary, so the panel can open without waiting.
        directions.shopId = selectedShopId;
        openDirections();
      } else {
        instance.easeTo({
          center: shop.location.coordinates as [number, number],
          zoom: Math.max(instance.getZoom(), 15),
          duration: 600
        });
      }
    });
  });

  /**
   * Opening the panel for the selection always falls back to the metro
   * itinerary when there is one; the live-route effect above handles the case
   * where a route exists (it runs with the route already in hand).
   */
  $effect(() => {
    if (!selectedShopId) return;
    const selected = selectedShopId;
    if (!shopRouteData[selected]) return;
    // A live route takes precedence and opens the panel via its own effect.
    if (travelData[selected]?.routeData) return;
    untrack(() => {
      directions = { isOpen: true, shopId: selected, selectedRouteIndex: 0 };
      openDirections();
    });
  });

  // Marker highlight follows hover/selection.
  $effect(() => {
    const selected = selectedShopId;
    const hovered = hoveredShopId;
    untrack(() => {
      for (const shop of data.shops) {
        const element = shopMarkerElements[`${shop.id}`];
        if (!element) continue;
        element.dataset.state =
          selected === `${shop.id}` ? 'selected' : hovered === `${shop.id}` ? 'hovered' : 'idle';
        element.style.zIndex =
          selected === `${shop.id}` ? '600' : hovered === `${shop.id}` ? '550' : '400';
      }
      // The hovered and selected shops outrank the rest for a label.
      scheduleMarkerLabels();
    });
  });

  // Traffic overlay for the modes that benefit from it.
  $effect(() => {
    const instance = map;
    const adapter = mapAdapter;
    if (!instance || !adapter) return;
    if (['transit', 'riding', 'driving'].includes(transportMethod ?? '')) {
      untrack(() => adapter.addTrafficOverlay(instance, { opacity: 0.5 }));
    } else {
      untrack(() => {
        try {
          if (instance.getLayer('ug-traffic')) instance.removeLayer('ug-traffic');
          if (instance.getSource('ug-traffic')) instance.removeSource('ug-traffic');
        } catch {
          // Map may already be destroyed during navigation.
        }
      });
    }
  });

  // ── Ambient metro overlay ────────────────────────────────────────────────
  // Always on, independent of the transport method: hovering (or selecting) a
  // shop paints its openmetro itinerary from the response alone — solid ride
  // legs in official line colors, dashed grey walks. The overlay is hidden
  // while a Directions panel is open because the panel draws its own.

  const clearMetroOverlay = () => {
    const instance = map;
    if (!instance) return;
    removeLayerAndSource(instance, METRO_LAYER_ID);
    removeLayerAndSource(instance, `${METRO_LAYER_ID}-solid`);
    removeLayerAndSource(instance, METRO_SOURCE_ID);
  };

  const drawMetroOverlay = (shopId: string, emphasized: boolean) => {
    const instance = map;
    if (!instance) return;
    const shop = data.shops.find((entry) => `${entry.id}` === shopId);
    if (!shop) return;

    // Only metro shops have an itinerary to paint. A shop with no metro
    // advantage shows no overlay at all, exactly as before metro existed.
    const segments = shop.travel ? buildMetroOverlay(shop, data.metro) : [];
    if (segments.length === 0) return;

    const features = segments.map((segment) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: segment.path },
      properties: {
        color: segment.color ?? METRO_WALK_COLOR,
        dashed: segment.dashed ? 1 : 0,
        weight: emphasized ? segment.weight + 1 : segment.weight
      }
    }));
    instance.addSource(METRO_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features }
    });
    instance.addLayer({
      id: METRO_LAYER_ID,
      type: 'line',
      source: METRO_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'weight'],
        'line-opacity': emphasized ? 1 : 0.85,
        'line-dasharray': [2, 2]
      },
      filter: ['get', 'dashed']
    });
    instance.addLayer({
      id: `${METRO_LAYER_ID}-solid`,
      type: 'line',
      source: METRO_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'weight'],
        'line-opacity': emphasized ? 1 : 0.85
      },
      filter: ['!', ['get', 'dashed']]
    });
  };

  /**
   * Shop id whose overlay should be painted: the hovered shop wins, otherwise
   * the selected one (so the route stays visible after clicking).
   */
  let metroOverlayShopId = $derived.by(() => {
    if (!metroEnabled) return null;
    if (hoveredShopId) return hoveredShopId;
    if (selectedShopId) return selectedShopId;
    return null;
  });

  $effect(() => {
    const shopId = metroOverlayShopId;
    const directionsOpen = directions.isOpen;
    untrack(() => {
      clearMetroOverlay();
      if (!shopId || directionsOpen) return;
      // A live route for this shop draws itself; the metro overlay would
      // double-draw a different path on top of it.
      if (travelData[shopId]?.path) return;
      drawMetroOverlay(shopId, hoveredShopId === shopId);
    });
  });

  /**
   * The openmetro fare for the shop whose metro itinerary is displayed, once it
   * arrives. `null` means "not available" — either still pending (the panel
   * shows a skeleton) or never published (the panel drops the column).
   */
  let activeDirectionsFare = $derived.by(() => {
    const shopId = directions.shopId;
    if (!shopId || !prefersMetroItinerary(shopId)) return null;
    const fare = metroFares[shopId];
    return fare && Number.isFinite(fare.amount) && fare.amount >= 0 ? fare.amount : null;
  });

  let activeDirectionsFareCurrency = $derived.by(() => {
    const shopId = directions.shopId;
    return shopId && prefersMetroItinerary(shopId) ? (metroFares[shopId]?.currency ?? null) : null;
  });

  /**
   * Route data feeding `<Directions>`. A live routed result always wins — it
   * is a real routed path, whereas the metro itinerary is reconstructed from
   * straight-line walks. The metro plan is the fallback when routing has
   * nothing (no transport method selected, or the request failed).
   */
  let activeDirectionsRouteData = $derived.by(() => {
    const shopId = directions.shopId;
    if (!shopId) return null;
    return travelData[shopId]?.routeData ?? shopRouteData[shopId] ?? null;
  });

  let activeDirectionsLoading = $derived.by(() => {
    const shopId = directions.shopId;
    if (!shopId) return false;
    if (travelData[shopId]) return false;
    if (shopRouteData[shopId]) return false;
    // A transport method is selected and its result has not arrived yet.
    return Boolean(transportMethod);
  });

  /**
   * True when the panel is showing a **metro itinerary** rather than a live
   * route. Only then is the fare fetched from openmetro and shown with a
   * skeleton — a live plan reports its own cost and must not be masked by
   * a request that is still in flight.
   */
  let activeDirectionsIsMetro = $derived.by(() => {
    const shopId = directions.shopId;
    if (!shopId) return false;
    return prefersMetroItinerary(shopId);
  });

  /** True while the openmetro fare for the displayed metro itinerary loads. */
  let activeDirectionsFareLoading = $derived.by(() => {
    const shopId = directions.shopId;
    if (!shopId || !activeDirectionsIsMetro) return false;
    if (!data.metro) return false;
    const shop = data.shops.find((entry) => `${entry.id}` === shopId);
    if (!shop?.travel || !shop.transit?.metro) return false;
    if (getMetroItinerary(data.metro, shopId) === null) return false;
    return metroFares[shopId] === undefined;
  });

  /**
   * Live fare enrichment (§3.5) — openmetro traffic beyond the discover call.
   * Runs only when the **metro itinerary** is what the panel shows; a live
   * plan reports its own cost, so querying openmetro then would be wasted
   * traffic. Failures are silent (the fare column is simply omitted).
   */
  $effect(() => {
    if (!directions.isOpen || !directions.shopId || !data.metro) return;
    const shopId = directions.shopId;
    if (!prefersMetroItinerary(shopId)) return;
    const shop = data.shops.find((entry) => `${entry.id}` === shopId);
    if (!shop?.travel) return;
    if (!shop.transit?.metro) return;
    if (getMetroItinerary(data.metro, shopId) === null) return;
    if (metroFares[shopId] !== undefined || metroFareRequests.has(shopId)) return;

    metroFareRequests.add(shopId);
    const block = data.metro;
    untrack(() => {
      fetchMetroFare(block, shop.transit!.metro).then((fare) => {
        // A null fare still clears the pending state: the panel then drops the
        // fare column rather than showing a skeleton forever.
        metroFares = { ...metroFares, [shopId]: fare };
      });
    });
  });

  /** Per-platform external link for the open Directions panel. */
  $effect(() => {
    if (!directions.isOpen || !directions.shopId) {
      mapLink = null;
      return;
    }
    const shop = data.shops.find((entry) => `${entry.id}` === directions.shopId);
    if (!shop) return;
    untrack(async () => {
      const link = await fetchMapLink({
        longitude: shop.location.coordinates[0],
        latitude: shop.location.coordinates[1],
        name: shop.name,
        mode: 'navigation',
        travelMode:
          transportMethod === 'walking'
            ? 'walking'
            : transportMethod === 'riding'
              ? 'cycling'
              : transportMethod === 'driving'
                ? 'driving'
                : 'transit'
      });
      mapLink = link;
    });
  });

  const updateDiscoverSettings = () => {
    if (browser) {
      const url = new URL(window.location.href);
      url.searchParams.set('radius', discoverRadius.toString());
      url.searchParams.set('limit', discoverLimit.toString());
      goto(url.toString(), { replaceState: true, keepFocus: true, noScroll: true });
    }
  };

  /**
   * Radius options double as the travel-time budget: each distance carries the
   * time it typically implies, so the label reads "5 km · 45 分" and the user
   * picks a range rather than a separate time control.
   */
  const radiusLabel = (km: number): string => {
    const budget = getTravelBudgetMinutes(km);
    return budget === null ? `${km} km` : `${km} km · ${formatDuration(budget * 60)}`;
  };

  $effect(() => {
    const selectedTitleSignature = selectedTitleIds.join(':');

    if (!browser || !discoverTableContainer || !selectedTitleSignature) return;

    const frame = requestAnimationFrame(() => {
      if ((discoverTableContainer?.scrollLeft ?? 0) > 24) {
        discoverTableContainer?.scrollTo({ left: 0, behavior: 'smooth' });
      }
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  });
</script>

<Directions
  bind:isOpen={directions.isOpen}
  shop={directions.shopId ? data.shops.find((s) => `${s.id}` === directions.shopId) : null}
  selectedRouteIndex={directions.selectedRouteIndex}
  routeData={activeDirectionsRouteData}
  isLoading={activeDirectionsLoading}
  isMetro={activeDirectionsIsMetro}
  fareLoading={activeDirectionsFareLoading}
  fare={activeDirectionsFare}
  fareCurrency={activeDirectionsFareCurrency}
  map={map ?? null}
  mapLink={mapLink}
  onClose={() => {
    directions.isOpen = false;
  }}
  onRouteSelected={(index) => {
    directions.selectedRouteIndex = index;

    // Reconstructed metro itineraries have a single route, so there is
    // nothing to re-select or re-cache.
    if (prefersMetroItinerary(directions.shopId ?? '')) return;

    // Update cache with new selected route index
    if (directions.shopId && transportMethod) {
      const cacheKey = generateRouteCacheKey(
        data.location.latitude,
        data.location.longitude,
        directions.shopId,
        transportMethod
      );
      const cachedData = cachedRoutes[cacheKey];
      if (cachedData) {
        setCachedRouteData(cacheKey, cachedData.routeData, index);
        cachedRoutes[cacheKey] = { ...cachedData, selectedRouteIndex: index };
      }
    }

    // The travel figure follows the newly selected route.
    const shopData = directions.shopId ? travelData[directions.shopId] : undefined;
    const result = shopData?.routeData;
    if (shopData && result && isValidRouteData(result)) {
      const selectedRoute = [...result.routes].sort(
        (a, b) => a.durationSeconds - b.durationSeconds
      )[index];
      if (selectedRoute) {
        travelData[`${directions.shopId}`] = {
          time: selectedRoute.durationSeconds,
          distance: selectedRoute.distanceMeters / 1000,
          path: selectedRoute.geometry,
          selectedRouteIndex: index,
          routeData: result
        };
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
    {#snippet settings()}
      <!-- Narrow screens: dropdown with all settings -->
      <div class="flex md:hidden">
        <div class="dropdown dropdown-end">
          <button
            type="button"
            tabindex="0"
            class="btn btn-soft hover:btn-accent btn-sm"
            aria-label={m.settings()}
          >
            <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>
          <div
            role="menu"
            tabindex="-1"
            class="card dropdown-content bg-base-200 text-base-content z-50 mt-2 w-72 font-normal shadow-md"
          >
            <div class="card-body gap-4 p-4">
              <div class="flex flex-col gap-1">
                <span class="label text-xs">{m.transport_method()}</span>
                <div class="flex flex-wrap gap-1">
                  <button
                    class="btn btn-xs"
                    class:btn-primary={transportMethod === undefined}
                    onclick={() => (transportMethod = undefined)}>{m.not_specified()}</button
                  >
                  <button
                    class="btn btn-xs"
                    class:btn-primary={transportMethod === 'transit'}
                    onclick={() => (transportMethod = 'transit')}>{m.public_transport()}</button
                  >
                  <button
                    class="btn btn-xs"
                    class:btn-primary={transportMethod === 'walking'}
                    onclick={() => (transportMethod = 'walking')}>{m.walking()}</button
                  >
                  <button
                    class="btn btn-xs"
                    class:btn-primary={transportMethod === 'riding'}
                    onclick={() => (transportMethod = 'riding')}>{m.riding()}</button
                  >
                  <button
                    class="btn btn-xs"
                    class:btn-primary={transportMethod === 'driving'}
                    onclick={() => (transportMethod = 'driving')}>{m.driving()}</button
                  >
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <span class="label text-xs">{m.search_radius()}</span>
                <div class="flex flex-wrap gap-1">
                  {#each RADIUS_OPTIONS as r (r)}
                    <button
                      class="btn btn-xs"
                      class:btn-primary={discoverRadius === r}
                      onclick={() => {
                        discoverRadius = r;
                        updateDiscoverSettings();
                      }}>{radiusLabel(r)}</button
                    >
                  {/each}
                  <button
                    class="btn btn-xs"
                    class:btn-primary={discoverRadius === 0}
                    onclick={() => {
                      discoverRadius = 0;
                      updateDiscoverSettings();
                    }}>{m.unlimited()}</button
                  >
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <span class="label text-xs">{m.result_count()}</span>
                <div class="flex flex-wrap gap-1">
                  {#each LIMIT_OPTIONS as l (l)}
                    <button
                      class="btn btn-xs"
                      class:btn-primary={discoverLimit === l}
                      onclick={() => {
                        discoverLimit = l;
                        updateDiscoverSettings();
                      }}>{l}</button
                    >
                  {/each}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    {/snippet}
    <div class="not-xs:text-center">
      <div class="not-xs:flex-col xs:flex-wrap mb-2 flex items-center gap-2">
        <h1 class="ss:text-3xl text-2xl font-bold">{m.nearby_arcades()}</h1>
        <div class="xs:flex-wrap flex items-center gap-2">
          <button
            type="button"
            class="btn btn-soft hover:btn-accent btn-sm"
            class:btn-primary={countActiveFilters(filterState) > 0}
            aria-label={m.filter_title()}
            onclick={() => (filterPanelOpen = true)}
          >
            <i class="fa-solid fa-filter"></i>
            {#if countActiveFilters(filterState) > 0}
              <span class="badge badge-sm">{countActiveFilters(filterState)}</span>
            {/if}
          </button>
          <div class="xs:hidden">{@render settings()}</div>
        </div>
      </div>
      <p class="ss:text-base text-base-content/70 text-sm">
        {m.found_shops_near({
          count: data.shops.length,
          location:
            data.location.name ??
            `(${data.location.longitude.toFixed(6)}, ${data.location.latitude.toFixed(6)})`
        })}
      </p>
    </div>
    <div class="not-xs:hidden flex flex-col gap-1">
      <!-- Wide screens: all selects inline -->
      <div class="hidden md:flex md:items-end md:gap-2">
        <div class="flex flex-col gap-1">
          <label class="label" for="transport-select-wide">
            <span class="label-text">{m.transport_method()}</span>
          </label>
          <select
            id="transport-select-wide"
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
        <div class="flex flex-col gap-1">
          <label class="label" for="radius-select-wide">
            <span class="label-text">{m.search_radius()}</span>
          </label>
          <select
            id="radius-select-wide"
            class="select select-bordered w-full pe-8"
            value={discoverRadius}
            onchange={(e) => {
              discoverRadius = Number((e.target as HTMLSelectElement).value);
              updateDiscoverSettings();
            }}
          >
            {#each RADIUS_OPTIONS as r (r)}
              <option value={r}>{radiusLabel(r)}</option>
            {/each}
            <option value={0}>{m.unlimited()}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="label" for="limit-select-wide">
            <span class="label-text">{m.result_count()}</span>
          </label>
          <select
            id="limit-select-wide"
            class="select select-bordered w-full pe-8"
            value={discoverLimit}
            onchange={(e) => {
              discoverLimit = Number((e.target as HTMLSelectElement).value);
              updateDiscoverSettings();
            }}
          >
            {#each LIMIT_OPTIONS as l (l)}
              <option value={l}>{l}</option>
            {/each}
          </select>
        </div>
      </div>
      {@render settings()}
    </div>
  </div>
  {#if data.shops.length === 0}
    <InlineAlert type="info" soft class="mb-4 not-dark:hidden">{m.no_shops_found()}</InlineAlert>
    <InlineAlert type="info" class="mb-4 dark:hidden">{m.no_shops_found()}</InlineAlert>
  {/if}
  {#if mapError}
    <InlineAlert type="error" icon="fa-circle-xmark" class="mb-4">
      {m.map_failure({
        error: mapError
      })}
    </InlineAlert>
  {/if}
  <!-- The class attribute here must never be dynamic: MapLibre tags its
       container with `maplibregl-map` when the map is constructed, and a
       template expression makes Svelte rewrite `className` wholesale on the
       next update, which drops that class and with it the `position: relative`
       that pins the canvas and controls to this box. `class:` directives
       toggle individual classes instead, so MapLibre's own class survives. -->
  <div
    id="map-container"
    class="mb-4 h-[50vh] w-full rounded-xl md:h-[60vh]"
    class:bg-base-200={!map}
    class:animate-pulse={!map}
    class:opacity-50={!map}
    bind:this={mapContainer}
  ></div>
  <div class="mb-2 flex flex-wrap items-center gap-1">
    <button
      type="button"
      class="btn btn-ghost btn-xs not-hover:text-current/60"
      class:btn-active={timePrimary}
      aria-pressed={timePrimary}
      title={timePrimary ? m.travel_time() : m.distance()}
      onclick={() => setTimePrimary(!timePrimary)}
    >
      <i class="fa-solid {timePrimary ? 'fa-clock' : 'fa-ruler-horizontal'}"></i>
      {#if timePrimary}
        {m.travel_time()}
      {:else}
        {m.distance()}
      {/if}
    </button>
    {#if hiddenAbsentGames.length > 0}
      <button
        type="button"
        class="btn btn-ghost btn-xs not-hover:text-current/60"
        class:btn-active={showAbsentGames}
        aria-pressed={showAbsentGames}
        onclick={() => {
          showAbsentGames = !showAbsentGames;
        }}
      >
        <i class={`fa-solid ${showAbsentGames ? 'fa-eye-slash' : 'fa-eye'}`}></i>
        {#if showAbsentGames}
          {m.hide_absent_game_titles()}
        {:else}
          {m.show_hidden_absent_game_titles({ count: hiddenAbsentGames.length })}
        {/if}
      </button>
    {/if}
  </div>
  {#if data.shops.length > 0}
    <div class="discover-table-wrap overflow-x-auto rounded-xl" bind:this={discoverTableContainer}>
      <table class="discover-table bg-base-200/30 dark:bg-base-200/60 table">
        <thead>
          <tr>
            <th class="discover-header discover-sticky discover-sticky-shop text-left">
              {m.shop()}
            </th>
            <th
              class="discover-header discover-sticky discover-sticky-attendance text-center not-xl:hidden"
            >
              {m.realtime_attendance()}
            </th>
            <th
              class="discover-header discover-sticky discover-sticky-travel hidden text-center md:table-cell"
            >
              {#if timePrimary}
                {m.travel_time()}
              {:else}
                {m.distance()}
              {/if}
            </th>
            {#each displayedGames as game (game.id)}
              <th id="game-{game.id}" class="discover-game-column discover-header text-center">
                {game.name}
              </th>
            {/each}
            <th class="discover-header discover-sticky discover-sticky-actions text-center">
              {m.actions()}
            </th>
          </tr>
        </thead>
        {#snippet discoverShopRow(shop: DiscoverShop)}
          {@const isShopOpen = isShopCurrentlyOpen(shop, now)}
          {#snippet attendance(klass = 'text-sm')}
            {#if shop.isClosed}
              <div class="text-error {klass}">{m.shop_mark_as_closed()}</div>
            {:else if isShopOpen}
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
                  <div class="text-accent not-xl:hidden {klass}">
                    {m.in_attendance({ count: currentAttendance })}
                  </div>
                  <div class="text-accent xl:hidden {klass}">
                    <i class="fa-solid fa-user"></i>
                    {currentAttendance}
                  </div>
                </AttendanceReportBlame>
              {:else}
                <div
                  class="text-base-content/60 not-xl:hidden {klass}"
                  class:text-primary={currentAttendance > 0}
                >
                  {m.in_attendance({ count: currentAttendance })}
                </div>
                <div
                  class="text-base-content/60 xl:hidden {klass}"
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
            `${shop.id}`
              ? 'bg-accent/8'
              : hoveredShopId === `${shop.id}`
                ? 'bg-base-300/30'
                : ''}"
            onmouseenter={() => {
              hoveredShopId = `${shop.id}`;
            }}
            onmouseleave={() => {
              if (hoveredShopId === `${shop.id}`) {
                hoveredShopId = null;
              }
            }}
            onclick={(event) => {
              if ((event.target as Element)?.closest('button, a')) return;
              selectedShopId = `${shop.id}`;
              if (!(isMobileView && directions.isOpen))
                mapContainer?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          >
            <td class="discover-cell discover-sticky discover-sticky-shop">
              <div class="flex items-center space-x-3">
                <div>
                  <div class="text-lg font-bold">{shop.name}</div>
                  {#if metroEnabled && shop.transit?.metro}
                    {@const metroLines = getMetroShopLines(shop, data.metro)}
                    {@const stationLabel = getMetroLocalizedName(
                      shop.transit.metro.names,
                      shop.transit.metro.stationName,
                      getLocale()
                    )}
                    <div class="mt-1 flex max-w-full flex-wrap items-center">
                      <span
                        class="border-base-content/15 bg-base-200 text-base-content inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border p-0.5 pr-1.5 text-xs"
                        title="{m.metro_station()}: {stationLabel}"
                      >
                        <div class="inline-flex max-w-full flex-wrap items-center gap-0.25">
                          {#each metroLines as line (line.id)}
                            {@const metroColor = line.color ?? '#64748b'}
                            <span
                              class="min-w-5 shrink-0 rounded-sm px-1 text-center leading-5 font-bold whitespace-nowrap"
                              style="background-color: {metroColor}; color: {getMetroBadgeTextColor(
                                metroColor
                              )}">{line.shortName}</span
                            >
                          {/each}
                        </div>
                        {stationLabel}
                      </span>
                    </div>
                  {/if}
                  <span
                    class="inline-flex whitespace-nowrap transition-opacity not-hover:opacity-50 xl:hidden"
                  >
                    {@render attendance('text-xs')}
                  </span>
                </div>
              </div>
            </td>
            <td
              class="discover-cell discover-sticky discover-sticky-attendance text-center not-xl:hidden"
            >
              {@render attendance()}
            </td>
            <td
              class="discover-cell discover-sticky discover-sticky-travel hidden text-center md:table-cell"
            >
              {#if timePrimary}
                {@const travel = shopTravel(shop)}
                {@const icon = shopTravelIcon(shop)}
                <!-- Time leads. Every row has one: a live routed time, the
                       server's metro estimate, or a straight-line inference. -->
                <div class="flex flex-col items-center gap-0.5">
                  <div
                    class="badge badge-soft badge-sm sm:badge-md lg:badge-lg whitespace-nowrap badge-{travelTimeLevel(
                      travel.seconds
                    )}"
                    title={travel.source === 'inferred' ? m.distance_based_estimate() : undefined}
                  >
                    {formatDuration(travel.seconds)}
                  </div>
                  <span class="text-base-content/60 text-xs">
                    {formatDistance(travel.distanceKm, 2)}
                    <i class="fa-solid {icon} ml-0.5"></i>
                  </span>
                </div>
              {:else}
                {@const travel = shopTravel(shop)}
                {@const icon = shopTravelIcon(shop)}
                <!-- Distance leads. -->
                <div class="flex flex-col items-center gap-0.5">
                  <div
                    class="badge badge-soft badge-sm sm:badge-md lg:badge-lg whitespace-nowrap badge-{travelDistanceLevel(
                      travel.distanceKm
                    )}"
                  >
                    {formatDistance(travel.distanceKm, 2)}
                  </div>
                  <span
                    class="text-base-content/60 text-xs"
                    title={travel.source === 'inferred' ? m.distance_based_estimate() : undefined}
                  >
                    {formatDuration(travel.seconds)}
                    <i class="fa-solid {icon} ml-0.5"></i>
                  </span>
                </div>
              {/if}
            </td>
            {#each displayedGames as gameInfo (gameInfo.id)}
              {@const game = findGame(shop.games, gameInfo.id)}
              <td class="discover-cell discover-game-column text-center">
                {#if game}
                  {@const id = `${shop.id}`}
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
            <td class="discover-cell discover-sticky discover-sticky-actions text-center">
              <div class="flex flex-col justify-center gap-1 xl:flex-row xl:gap-2">
                <a
                  class="btn btn-ghost btn-sm px-1 text-nowrap sm:px-2 md:px-4"
                  href={resolve('/(main)/shops/[id]', {
                    id: shop.id.toString()
                  })}
                  target={adaptiveNewTab()}
                  onclick={() => handleShopClick(shop)}
                >
                  <i class="fas fa-info-circle"></i>
                  <span class="hidden md:inline">{m.details()}</span>
                </a>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm px-1 text-nowrap sm:px-2 md:px-4"
                  onclick={() => {
                    handleShopClick(shop);
                    void openExternalRoute(shop);
                  }}
                >
                  <i class="fas fa-map-marked-alt"></i>
                  <span class="hidden md:inline">{m.route()}</span>
                </button>
              </div>
            </td>
          </tr>
        {/snippet}
        <tbody>
          {#each activeShops as shop (shop.id)}
            {@render discoverShopRow(shop)}
          {/each}
        </tbody>
        {#if closedShops.length > 0}
          <tbody>
            <tr class="hover:bg-transparent">
              <td class="discover-cell discover-sticky discover-sticky-shop p-0">
                <button
                  type="button"
                  class="btn btn-ghost h-auto min-h-0 w-full justify-start gap-2 rounded-none px-3 py-3 text-sm font-medium"
                  onclick={() => (closedShopsExpanded = !closedShopsExpanded)}
                  aria-expanded={closedShopsExpanded}
                >
                  <i
                    class="fa-solid {closedShopsExpanded
                      ? 'fa-chevron-down'
                      : 'fa-chevron-right'} text-xs"
                  ></i>
                  {m.discover_closed_shops({ count: closedShops.length })}
                </button>
              </td>
              <td colspan="100" class="p-0"></td>
            </tr>
            {#if closedShopsExpanded}
              {#each closedShops as shop (shop.id)}
                {@render discoverShopRow(shop)}
              {/each}
            {/if}
          </tbody>
        {/if}
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

      {#if data.radius > 0}
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
      {/if}
    </div>
  {/if}
</div>

<ShopFilterPanel
  bind:open={filterPanelOpen}
  applied={filterState}
  regionLabels={data.regionLabels}
  allowGeo={false}
  onapply={applyDiscoverFilter}
  onclose={() => (filterPanelOpen = false)}
/>

<style lang="postcss">
  @reference "tailwindcss";

  .discover-table-wrap {
    --discover-shop-width: 9rem;
    --discover-attendance-width: 0rem;
    --discover-travel-width: 0rem;
    --discover-title-width: 10rem;
    --discover-actions-width: 3.5rem;
  }

  @media (min-width: 640px) {
    .discover-table-wrap {
      --discover-shop-width: 12rem;
      --discover-title-width: 11rem;
      --discover-actions-width: 4rem;
    }
  }

  @media (min-width: 768px) {
    .discover-table-wrap {
      --discover-travel-width: 8rem;
      --discover-actions-width: 9rem;
    }
  }

  @media (min-width: 1280px) {
    .discover-table-wrap {
      --discover-attendance-width: 8rem;
      --discover-title-width: 12rem;
      --discover-actions-width: 10rem;
    }
  }

  .discover-table {
    width: max-content;
    min-width: 100%;
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
  }

  .discover-cell {
    @apply align-middle;
  }

  .discover-header {
    background-color: var(--color-base-200);
  }

  .discover-sticky {
    position: sticky;
  }

  .discover-table th.discover-sticky {
    z-index: 30;
  }

  .discover-table td.discover-sticky {
    z-index: 20;
    background-color: var(--color-base-100);
  }

  .discover-sticky-shop {
    left: 0;
    width: var(--discover-shop-width);
    min-width: var(--discover-shop-width);
  }

  .discover-sticky-attendance {
    left: var(--discover-shop-width);
    width: var(--discover-attendance-width);
    min-width: var(--discover-attendance-width);
  }

  .discover-sticky-travel {
    left: calc(var(--discover-shop-width) + var(--discover-attendance-width));
    width: var(--discover-travel-width);
    min-width: var(--discover-travel-width);
  }

  @media (min-width: 768px) {
    .discover-sticky-travel {
      box-shadow: 10px 0 16px -16px hsl(var(--bc) / 0.7);
    }
  }

  .discover-sticky-actions {
    right: 0;
    width: var(--discover-actions-width);
    min-width: var(--discover-actions-width);
    box-shadow: -10px 0 16px -16px hsl(var(--bc) / 0.7);
  }

  .discover-game-column {
    width: var(--discover-title-width);
    min-width: var(--discover-title-width);
    white-space: normal;
  }

  /* ── Discover map markers ─────────────────────────────────────────────────
     A marker is a dot centred on the shop's coordinate plus a name chip that
     floats beside it. The chip is positioned outside the marker's box, so it
     neither drags the dot off the coordinate nor widens the click target —
     and it is `pointer-events: none` for the same reason: with chips this
     wide, a clickable one would swallow clicks aimed at the dots it covers.
     Theme colours come in as `var(--color-*)` because this block references
     Tailwind alone, which does not know the daisyUI palette. */
  :global(.discover-marker) {
    @apply flex h-3.5 w-3.5 items-center justify-center;
  }

  :global(.discover-marker-dot) {
    @apply block h-2.5 w-2.5 rounded-full;
    background-color: var(--color-info);
    box-shadow: 0 0 0 2px var(--color-base-100);
    transition: scale 150ms ease;
  }

  :global(.discover-marker-origin .discover-marker-dot) {
    @apply h-3 w-3;
    background-color: var(--color-accent);
    box-shadow: 0 0 0 3px var(--color-base-100);
  }

  :global(.discover-marker[data-state='hovered'] .discover-marker-dot) {
    @apply scale-150;
    background-color: var(--color-warning);
  }

  :global(.discover-marker[data-state='selected'] .discover-marker-dot) {
    @apply scale-150;
    background-color: var(--color-error);
  }

  :global(.discover-marker-label) {
    @apply pointer-events-none absolute top-1/2 left-[calc(100%+0.4rem)] flex max-w-44 -translate-y-1/2 items-center gap-x-1.5 rounded-full border px-2 text-xs leading-5 font-medium whitespace-nowrap shadow-md backdrop-blur-md;
    background-color: color-mix(in oklab, var(--color-base-100) 90%, transparent);
    border-color: color-mix(in oklab, var(--color-base-content) 10%, transparent);
    color: var(--color-base-content);
    transition:
      opacity 150ms ease,
      visibility 150ms ease;
  }

  /* Near the right edge of the map the chip flips to the dot's left. */
  :global(.discover-marker[data-side='start'] .discover-marker-label) {
    @apply right-[calc(100%+0.4rem)] left-auto;
  }

  /* Overlapped chips fade out but keep their box: the next declutter pass
     measures them, and a `display: none` chip would measure as zero. */
  :global(.discover-marker-label.is-colliding) {
    opacity: 0;
    visibility: hidden;
  }

  :global(.discover-marker-label-static) {
    @apply border-transparent font-semibold;
    background-color: color-mix(in oklab, var(--color-accent) 90%, transparent);
    color: var(--color-accent-content);
  }

  :global(.discover-marker-name) {
    @apply min-w-0 overflow-hidden text-ellipsis;
  }

  :global(.discover-marker-lines) {
    @apply flex shrink-0 items-center gap-0.5;
  }

  :global(.discover-marker-line) {
    @apply min-w-5 shrink-0 rounded-sm px-1 text-center leading-5 font-bold whitespace-nowrap;
  }

  @media (max-width: 767px) {
    :global(.discover-marker-label) {
      @apply max-w-32;
    }
  }

  :global(.maplibregl-popup-content) {
    @apply rounded-xl;
  }
</style>
