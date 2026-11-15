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
    isShopCurrentlyOpen
  } from '$lib/utils';
  import {
    buildMetroRouteData,
    fetchMetroFare,
    getMetroItinerary,
    getMetroBadgeTextColor,
    getMetroLocalizedName,
    getMetroShopLines,
    type MetroFare
  } from '$lib/utils/metro.client';
  import { fetchMapLink } from '$lib/utils/map-links.client';
  import { useCopyFeedback } from '$lib/utils/clipboard.svelte';
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
  import { orpc } from '$lib/api/client';
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
  const copyFeedback = useCopyFeedback();
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
  const isValidRouteData = (
    value: unknown
  ): value is { routes: import('$lib/types/routing').RouteResult[] } =>
    typeof value === 'object' &&
    value !== null &&
    'routes' in value &&
    Array.isArray((value as { routes: unknown }).routes) &&
    (value as { routes: unknown[] }).routes.every(
      (route) =>
        typeof route === 'object' &&
        route !== null &&
        'geometry' in route &&
        'durationSeconds' in route &&
        'legs' in route &&
        Array.isArray(route.legs)
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
          // Stored sorted, so the Directions panel's tab order — which indexes
          // this array directly — matches the `selectedRouteIndex` the map's
          // drawn path and the travel figures above are based on.
          routeData: { routes: sorted }
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
        const result = await orpc.geo.directions({
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
            // Shops persist in the datum carried on their stored location.
            coordinateSystem: shop.location.coordinateSystem
          },
          mode,
          language: getLocale()
        });
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
   * the label — marks the place. The chip sits to the right of the dot and
   * moves to its left when it would land on the origin's chip; how much of
   * it fits is decided by the declutter pass, which cuts and fades it where
   * the map runs out of room. `data-state` carries selection/hover, which the
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
    // The chip is masked and the cut is animated (see the stylesheet). The
    // animation is off until the map has measured every name once: a chip
    // that is cut for the first time has to *appear* cut, not grow out of
    // nothing.
    label.style.setProperty('--clip-anim-duration', '0s');
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
    // No `cursor-pointer`: the origin is not a target. It sits *above* the
    // shop markers so it can never be hidden by one, and it lets the pointer
    // through to the shop underneath (see the stylesheet) so the shop can
    // still be hovered and clicked when the origin is the same place.
    element.className = 'discover-marker discover-marker-origin';
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

  /** Glow the shop's table row for three seconds — the "this row is it" cue. */
  const highlightShopRow = (shopId: string) => {
    if (highlightedShopIdTimeout) {
      clearTimeout(highlightedShopIdTimeout);
      highlightedShopIdTimeout = null;
    }
    highlightedShopId = shopId;
    highlightedShopIdTimeout = setTimeout(() => {
      highlightedShopId = null;
      highlightedShopIdTimeout = null;
    }, 3000);
  };

  /**
   * Bring the shop's table row into view under the glow above. Only reachable
   * through the popup card's "view in list" button — a marker click no longer
   * scrolls on its own, so the card the click just opened stays on screen
   * (the old auto-scroll pushed the map, card included, out of view). Popups
   * only open from marker clicks and closed shops' markers are hidden, so the
   * target row is always rendered in the active-shops tbody.
   */
  const focusShopRow = (shopId: string) => {
    highlightShopRow(shopId);
    document.getElementById(`shop-${shopId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  };

  const popupContent = (shop: DiscoverShop, address: string): HTMLElement => {
    const container = document.createElement('div');
    // The popup receives maplibregl's default white background — that is the
    // first thing that does not match the dark theme. We carry the look
    // ourselves: a card coloured with theme tokens, a dim divider, and the
    // buttons use `btn-block`/`flex-1` so the bar fills the card's width
    // rather than hugging the icons.
    // There is no close button in the card — the card is dismissed by
    // clicking anywhere else on the map (or with Escape) — so nothing has to
    // reserve room in the top-right corner and the title gets the full width.
    // `discover-popup` also re-seeds the site font stack in CSS — maplibregl's
    // own `font: 12px/20px Helvetica Neue…` on `.maplibregl-map` would
    // otherwise leak into every popup and the card reads as a different site.
    //
    // No `backdrop-blur`: `bg-base-100` is opaque, so the blur had nothing to
    // sample — but its backdrop root still re-rasterised the text on every
    // animated frame, which is what made the whole card read soft.
    container.className =
      'discover-popup bg-base-100 text-base-content border-base-content/10 relative min-w-56 max-w-80 space-y-2 rounded-xl border p-3 shadow-lg';

    const header = document.createElement('div');
    header.className = 'space-y-1';
    const title = document.createElement('div');
    title.className = 'text-base-content text-base font-semibold leading-tight break-words';
    title.textContent = shop.name;
    header.append(title);
    if (address) {
      const addressLine = document.createElement('div');
      addressLine.className = 'text-base-content/65 text-xs leading-snug';
      addressLine.textContent = address;
      header.append(addressLine);
    }
    container.append(header);

    // Metro chip (line badges + station name) — only when the response
    // carries a worthwhile itinerary for the shop. Mirrors the inline cell
    // on the discover table so the popup never contradicts it.
    if (metroEnabled && shop.transit?.metro && data.metro) {
      const metroLines = getMetroShopLines(shop, data.metro);
      const stationLabel = getMetroLocalizedName(
        shop.transit.metro.names,
        shop.transit.metro.stationName,
        getLocale()
      );
      if (metroLines.length > 0 || stationLabel) {
        const metroRow = document.createElement('div');
        metroRow.className =
          'border-base-content/10 bg-base-200/60 inline-flex w-full max-w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs';
        metroRow.title = `${m.metro_station()}: ${stationLabel}`;
        if (metroLines.length > 0) {
          const lineGroup = document.createElement('span');
          lineGroup.className = 'inline-flex shrink-0 items-center gap-0.5';
          for (const line of metroLines) {
            const chip = document.createElement('span');
            const metroColor = line.color ?? '#64748b';
            chip.className =
              'min-w-5 rounded-sm px-1 text-center leading-5 font-bold whitespace-nowrap';
            chip.style.backgroundColor = metroColor;
            chip.style.color = getMetroBadgeTextColor(metroColor);
            chip.textContent = line.shortName;
            lineGroup.appendChild(chip);
          }
          metroRow.appendChild(lineGroup);
        }
        const stationText = document.createElement('span');
        stationText.className = 'text-base-content/85 min-w-0 truncate font-medium';
        stationText.textContent = stationLabel;
        metroRow.appendChild(stationText);
        container.append(metroRow);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'flex flex-wrap gap-2';

    /**
     * Jump to the shop's row in the table below — the explicit replacement
     * for the old marker-click auto-scroll, which pushed the page (and this
     * card with it) out of view right after the card opened. Closing goes
     * through `dismissPopupNow` — not the animated close — so the `close`
     * event fires *inside* the `popupReplacement` window (the animated path
     * fires it from a timer, after the flag has been reset): leaving for the
     * table is navigation, not a plain dismissal, and the selection must
     * survive it so re-clicking the marker still reopens the card.
     */
    const rowButton = document.createElement('button');
    rowButton.type = 'button';
    rowButton.className =
      'btn btn-sm border-base-content/15 bg-base-100 hover:bg-base-200 text-base-content btn-block flex-1 rounded-md border font-medium';
    const rowIcon = document.createElement('i');
    rowIcon.className = 'fa-solid fa-table-list';
    const rowText = document.createElement('span');
    rowText.className = 'truncate';
    rowText.textContent = m.view_in_list();
    rowButton.append(rowIcon, rowText);
    rowButton.onclick = () => {
      popupReplacement = true;
      dismissPopupNow();
      popupReplacement = false;
      focusShopRow(`${shop.id}`);
    };

    const link = document.createElement('button');
    link.type = 'button';
    link.className =
      'btn btn-sm border-base-content/15 bg-base-100 hover:bg-base-200 text-base-content btn-block flex-1 rounded-md border font-medium';
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-up-right-from-square';
    const text = document.createElement('span');
    text.className = 'truncate';
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
    actions.append(rowButton, link);
    container.append(actions);

    return container;
  };

  /**
   * Exit animation duration. Must stay in step with the `discover-popup-out`
   * keyframes in the stylesheet below — the timeout below is what actually
   * removes the node, so a drift here would clip the animation or leave a
   * transparent card stuck on the map.
   */
  const POPUP_EXIT_MS = 160;

  let popupCloseTimer: ReturnType<typeof setTimeout> | null = null;
  let popupEscapeHandler: ((event: KeyboardEvent) => void) | null = null;

  /** Drop the popup immediately, cancelling any in-flight exit animation. */
  const dismissPopupNow = () => {
    if (popupCloseTimer !== null) {
      clearTimeout(popupCloseTimer);
      popupCloseTimer = null;
    }
    if (popupEscapeHandler) {
      document.removeEventListener('keydown', popupEscapeHandler);
      popupEscapeHandler = null;
    }
    activePopup?.remove();
    activePopup = null;
  };

  /**
   * Close the popup with its exit animation.
   *
   * MapLibre's own close paths (its close button, `closeOnClick`, Escape) all
   * call `remove()` synchronously, which kills the card mid-frame — so they are
   * taken over here: `closeButton: false` and `closeOnClick: false`, plus a map
   * click handler and a document-level Escape listener, both routed through
   * this function. `is-closing` plays the keyframes; the timer then does the
   * actual `remove()`.
   */
  const dismissPopupAnimated = (onClosed?: () => void) => {
    const popup = activePopup;
    if (!popup) {
      onClosed?.();
      return;
    }
    if (popupCloseTimer !== null) return; // already animating out

    const wrapper = popup.getElement();
    if (!wrapper) {
      popup.remove();
      activePopup = null;
      onClosed?.();
      return;
    }

    wrapper.classList.add('is-closing');
    popupCloseTimer = setTimeout(() => {
      popupCloseTimer = null;
      if (popupEscapeHandler) {
        document.removeEventListener('keydown', popupEscapeHandler);
        popupEscapeHandler = null;
      }
      // `remove()` detaches content and container; clearing the reference first
      // keeps a mid-flight `activePopup?.remove()` from touching a dead node.
      if (activePopup === popup) activePopup = null;
      popup.remove();
      onClosed?.();
    }, POPUP_EXIT_MS);
  };

  /**
   * MapLibre attaches its `wheel` listener to `getCanvasContainer()`, but a
   * Popup is appended to `getContainer()` — a *different* element. Wheel events
   * over the card therefore never reached the scroll-zoom handler, so the page
   * scrolled instead of the map zooming. Forwarding the event to the canvas
   * container lets MapLibre's own handler run: it reads the client coordinates
   * off the event, so the zoom anchors under the cursor exactly as it does over
   * the bare map, and it calls `preventDefault()` itself, killing the page
   * scroll.
   *
   * `passive: false` is required — the forwarded dispatch has to be cancelable.
   */
  const forwardWheelToMap = (container: HTMLElement, canvasContainer: HTMLElement): void => {
    container.addEventListener(
      'wheel',
      (event) => {
        // Already handled natively: the pointer was over the canvas, not the card.
        if (event.defaultPrevented) return;
        canvasContainer.dispatchEvent(
          new WheelEvent('wheel', {
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaZ: event.deltaZ,
            deltaMode: event.deltaMode,
            clientX: event.clientX,
            clientY: event.clientY,
            screenX: event.screenX,
            screenY: event.screenY,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
            bubbles: false,
            cancelable: true
          })
        );
        // Whether or not the handler consumed it, the page must not scroll: the
        // pointer is over the map's own surface.
        event.preventDefault();
      },
      { passive: false }
    );
  };

  /**
   * True while a popup is being swapped for another one. The outgoing card's
   * `close` handler treats a plain dismissal as "defocus this shop", but a
   * replacement is not a dismissal — and the deselect must not fire before
   * `handleMarkerClick` reads the current selection, or a re-click on the
   * selected shop would forget it was selected at all.
   */
  let popupReplacement = false;

  const showShopPopup = (instance: maplibregl.Map, shop: DiscoverShop) => {
    // Any card still fading out would collide with the new one.
    popupReplacement = true;
    dismissPopupNow();
    popupReplacement = false;

    const address = formatShopAddress(shop);
    const card = popupContent(shop, address);

    const popup = new maplibregl.Popup({
      offset: 24,
      // MapLibre's own close affordances are taken over so the exit animation
      // can play: `closeOnClick` would remove the popup synchronously and
      // kill the animation, and the close button is not wanted at all — the
      // card is dismissed by clicking elsewhere on the map.
      closeButton: false,
      closeOnClick: false,
      // MapLibre focuses the first focusable element inside the card when it
      // opens, which puts a bright focus ring on the "open in maps app"
      // button the instant the card appears. The card is opened by a map
      // click rather than by keyboard navigation, so that ring is pure noise.
      focusAfterOpen: false
    })
      .setLngLat([shop.location.coordinates[0], shop.location.coordinates[1]])
      .setDOMContent(card)
      .addTo(instance);

    const wrapper = popup.getElement();
    if (wrapper) {
      wrapper.style.zIndex = '1200';
      forwardWheelToMap(wrapper, instance.getCanvasContainer());
    }

    /**
     * Clicking elsewhere on the map closes the card.
     *
     * This is MapLibre's `closeOnClick` behaviour, re-implemented: the
     * built-in one calls `remove()` synchronously, which would cut the exit
     * animation off mid-frame. Going through `dismissPopupAnimated` keeps
     * the card's own outro.
     *
     * The marker listeners stop the DOM event from propagating, so clicking
     * a *marker* never reaches the map's click handler — that click opens
     * the other shop's card instead. Clicking the card itself does not
     * reach it either: the popup lives in `map.getContainer()`, not in the
     * canvas container the map's handlers are bound to.
     */
    const onMapClick = () => {
      dismissPopupAnimated();
    };
    instance.on('click', onMapClick);

    popupEscapeHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      dismissPopupAnimated();
    };
    document.addEventListener('keydown', popupEscapeHandler);

    popup.on('close', () => {
      instance.off('click', onMapClick);
      if (popupEscapeHandler) {
        document.removeEventListener('keydown', popupEscapeHandler);
        popupEscapeHandler = null;
      }
      // A replacement popup taking over is not a dismissal: the selection
      // follows the new marker instead of dropping to none.
      if (popupReplacement) return;
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

    // Re-clicking the already-selected shop reopens its panel: the selection
    // effects only react to a *changed* selection, so without this the second
    // click would do nothing once the panel had been closed.
    if (wasSelected) {
      if (hasRoute) openDirections();
      return;
    }

    if (hasRoute) return;

    // No auto-scroll: a marker click means "look at the map", and yanking the
    // page down to the table hid the card the click just opened. The glow
    // still helps when the table is on screen beside the map (desktop).
    highlightShopRow(shopId);
  };

  // ── Map lifecycle ─────────────────────────────────────────────────────────

  const ROUTES_SOURCE_ID = 'shop-routes';
  const ROUTE_LINE_LAYER_ID = 'shop-routes-line';

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

  /**
   * The shop markers' DOM elements, keyed by shop id.
   *
   * Deliberately a plain `Map` and not a reactive one: these are imperative
   * handles that the marker listeners and the highlight pass below write to
   * directly, and a reactive collection would hand back wrapped elements
   * instead of the real nodes. The map lifecycle owns their lifetime (the
   * init effect clears the map when it tears the map down), so nothing here
   * needs to be reactive.
   */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Map on purpose, see above
  const shopMarkerElements = new Map<string, HTMLElement>();

  /**
   * The origin marker's element. Kept around for the label declutter pass:
   * the origin chip competes for the same pixels as the shop chips and has to
   * take part in the same collision resolution.
   */
  let originMarkerElement: HTMLElement | null = null;

  /**
   * Paint one marker's visual state.
   *
   * Two axes: `data-state` carries idle / hovered / selected, and the
   * orthogonal `data-route='on'` marks the shop whose metro itinerary is
   * drawn on the map. The route-active marker wins even when another shop is
   * hovered or selected, so the focused ride always reads as highlighted.
   * The stacking order follows from the same three flags.
   */
  const paintMarkerState = (
    element: HTMLElement,
    id: string,
    selected: string | null,
    hovered: string | null,
    routeActive: string | null
  ) => {
    element.dataset.state = selected === id ? 'selected' : hovered === id ? 'hovered' : 'idle';
    element.dataset.route = routeActive === id ? 'on' : '';
    element.style.zIndex =
      selected === id ? '650' : routeActive === id ? '600' : hovered === id ? '550' : '400';
  };

  /**
   * Repaint a marker from the current state.
   *
   * The marker listeners call this directly instead of waiting for the
   * highlight effect: the hover feedback has to land on the very next frame,
   * and a state write that has to travel through Svelte's effect queue is
   * either a frame late — or, if anything else in that queue throws, never
   * applied at all.
   */
  const repaintMarker = (element: HTMLElement, id: string) =>
    paintMarkerState(element, id, selectedShopId, hoveredShopId, selectedShopId);

  // ── Marker labels ─────────────────────────────────────────────────────────

  /**
   * The root font size in pixels. The minimum readable width of a name is
   * expressed in rem, so the JS side has to read the same scale to convert
   * between the two.
   */
  const rootRemPx = (): number => {
    const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(size) && size > 0 ? size : 16;
  };

  /**
   * Which side of its dot a chip sits on: `end` is to the right, `start` is to
   * the left. A chip starts on the right and moves aside when the origin's
   * chip is in the way — the origin is the user's own position and keeps its
   * place, so the shop that would sit under it steps aside.
   */
  type MarkerSide = 'end' | 'start';

  /**
   * Something a name has to stay clear of: a shop's dot, the origin's chip, or
   * the box a name already claimed. The id says whose it is, so a name can
   * recognise its own dot (see `clipWindow`).
   */
  type LabelObstacle = { id: string; rect: DOMRect };

  /**
   * How narrow a name may get before it stops being worth showing: a stub of
   * a few characters is noise, so the name is hidden and the shop keeps its
   * dot alone.
   */
  const MIN_NAME_WIDTH_REM = 8;

  /**
   * The gap between a chip and its dot, in rem. It has to match the
   * stylesheet, which places the chip with the same value.
   */
  const CHIP_GAP_REM = 0.4;

  /** A chip's box on the map. */
  type ChipBox = { left: number; right: number; top: number; bottom: number };

  /**
   * The box a chip occupies on a given side of its dot.
   *
   * The chip is anchored to the dot's box and slides across it when it
   * changes side, so both boxes can be derived from the dot's rect and the
   * chip's measured width — the DOM does not have to be laid out twice to
   * know whether the other side would fit.
   */
  const chipBox = (
    dot: DOMRect,
    chip: DOMRect,
    width: number,
    side: MarkerSide,
    rem: number
  ): ChipBox => {
    const gap = CHIP_GAP_REM * rem;
    const left = side === 'end' ? dot.right + gap : dot.left - gap - width;
    return { left, right: left + width, top: chip.top, bottom: chip.bottom };
  };

  /** Do two boxes overlap? */
  const boxesOverlap = (a: ChipBox, b: ChipBox): boolean =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  /**
   * The origin chip: a short, permanent label next to the user's position.
   *
   * It is placed *before* the shop chips and its box is reserved, so a shop
   * chip that would land on it steps aside instead of fighting it for the
   * same pixels. It is short: it either fits whole or it does not show at
   * all.
   *
   * The chip is hidden with `visibility` rather than `display` so that it
   * keeps its measured box and can reappear on the next pass.
   */
  const placeOriginLabel = (
    obstacles: LabelObstacle[],
    bounds: DOMRect,
    rem: number
  ): DOMRect | null => {
    const element = originMarkerElement;
    const label = element?.querySelector<HTMLElement>('.discover-marker-label');
    if (!element || !label) return null;

    const chip = label.getBoundingClientRect();
    // A chip that has never been laid out has no room to claim yet.
    if (chip.width === 0) return null;

    const dot = element.getBoundingClientRect();
    const box = chipBox(dot, chip, chip.width, 'end', rem);
    // The origin chip is not released from anything: it is short and it sits
    // on the user's own position.
    const window = clipWindow(box, obstacles, bounds, 'origin', 'end');
    if (window.to - window.from < chip.width - 0.5) {
      label.classList.add('is-colliding');
      return null;
    }
    label.classList.remove('is-colliding');
    applyClip(label, 'end', chip.width, 0);
    return new DOMRect(box.left, box.top, chip.width, chip.height);
  };

  /**
   * Where a name has to stop.
   *
   * Three kinds of obstacle bound a name: the map's own edge, another shop's
   * dot, and the names already placed. The dots count because they are drawn
   * *above* the names — a dot is the interactive target (clicking it opens the
   * shop card), so it has to stay visible and clickable. A name that ran
   * across a dot would be punched through by it.
   *
   * A name is never blocked by its *own* dot: the chip sits just beside it,
   * and anything that widened the chip — a scale, a longer name — would push
   * the chip's edge back over that dot, which would then cut the name to
   * nothing. A name has to be able to grow without losing itself.
   *
   * A chip on the right of its dot is cut at its right end, a chip on the
   * left at its left end; the cut fades out instead of ending hard (see
   * `applyClip`).
   */
  const clipWindow = (
    box: ChipBox,
    obstacles: LabelObstacle[],
    bounds: DOMRect,
    ownId: string,
    side: MarkerSide
  ): { from: number; to: number } => {
    let from = bounds.left;
    let to = bounds.right;
    for (const obstacle of obstacles) {
      // A name is never blocked by its own dot.
      if (obstacle.id === ownId) continue;
      const other = obstacle.rect;
      if (other.top >= box.bottom || other.bottom <= box.top) continue;
      if (side === 'end') {
        // The chip runs to the right: it stops at the first obstacle in its way.
        if (other.right <= box.left) continue;
        if (other.left < to) to = other.left;
      } else {
        // The chip runs to the left: it stops at the first obstacle in its way.
        if (other.left >= box.right) continue;
        if (other.right > from) from = other.right;
      }
    }
    return { from, to };
  };

  /**
   * Clip a name that was cut short.
   *
   * The name keeps its full box — only the part that leaves the free space
   * dissolves, and the cut end fades out instead of ending hard. The mask's
   * two stops are custom properties: where the cut is (`--clip-fade-end`,
   * measured from the cut end of the chip) and how wide the fade itself is
   * (`--clip-fade-size`).
   *
   * The mask is *always* on. A name that fits is covered by it completely,
   * so the mask never appears and disappears — and that is the whole point.
   * The stops used to be removed while a name was unclipped, which reset
   * them to their registered initial value of `0px`; the next cut therefore
   * grew the name out of nothing instead of clipping it, and a name that
   * already fitted was wiped out and drawn again from zero width.
   */
  const applyClip = (
    label: HTMLElement,
    side: MarkerSide,
    visibleWidth: number,
    fadeSize: number
  ): void => {
    label.style.setProperty('--clip-fade-end', `${visibleWidth}px`);
    label.style.setProperty('--clip-fade-size', `${fadeSize}px`);
    label.dataset.clip = side;
  };

  /**
   * Decide which names are readable and how much of each one fits.
   *
   * Every marker keeps its dot; only the names compete for room. A name is
   * cut where it meets an obstacle — the map's edge, another shop's dot, or a
   * name that was placed before it — and the cut fades out instead of ending
   * hard. There is no cap on how many names may show and no cap on how long a
   * name may be: the free space is the only limit.
   *
   * The layout is a pure function of the geometry: the order the chips are
   * placed in and the space each one claims do not depend on what is hovered
   * or selected. That is what keeps a hover from making an unrelated label
   * appear or disappear — the focused chip is the only one that changes, and
   * it only changes how it is drawn.
   *
   * A name with too little room left to read is hidden altogether; the shop
   * is still on the map through its dot. The focused one is always shown.
   *
   * Colliding names are hidden with `visibility`, never `display`, so their
   * boxes keep their measured size and the next pass can reclaim them without
   * a re-layout round trip.
   */
  const refreshMarkerLabels = () => {
    const instance = map;
    if (!instance) return;

    const container = instance.getContainer();
    const bounds = container.getBoundingClientRect();
    const rem = rootRemPx();
    const minWidth = MIN_NAME_WIDTH_REM * rem;
    // How wide the fade at a cut is. It matches the `2rem` the stylesheet's
    // mask ramp used before the ramp became a custom property.
    const fadePx = 2 * rem;
    const entries: { shop: DiscoverShop; label: HTMLElement; dot: DOMRect }[] = [];

    for (const shop of sortedShops) {
      const element = shopMarkerElements.get(`${shop.id}`);
      const label = element?.querySelector<HTMLElement>('.discover-marker-label');
      if (!element || !label) continue;
      // A hidden marker neither shows a label nor reserves room for one.
      if (shop.isClosed && !closedShopsExpanded) continue;
      entries.push({ shop, label, dot: element.getBoundingClientRect() });
    }

    // Read pass: one layout flush for every name on the map, then the dots
    // they have to stay clear of.
    const measured = entries.map((entry) => entry.label.getBoundingClientRect());
    const dots: LabelObstacle[] = [];
    for (const [id, element] of shopMarkerElements) {
      // A closed shop's dot is hidden, so it reserves nothing.
      if (element.style.visibility === 'hidden') continue;
      dots.push({ id, rect: element.getBoundingClientRect() });
    }
    if (originMarkerElement) {
      dots.push({ id: 'origin', rect: originMarkerElement.getBoundingClientRect() });
    }

    // The origin chip is placed first: the origin is the user's own position
    // and keeps its place, so its box is reserved before the shop chips are
    // placed against it.
    const originBox = placeOriginLabel(dots, bounds, rem);

    // The chips are placed in the table order, and it does not change with
    // the hover.
    //
    // The focused chips used to be moved to the end of that order, so that
    // they could float above the rest without claiming any space. But a chip
    // that gives up its space is a hole in the layout: the chip that took
    // its place grew into it, which pushed the next one along, and the one
    // after that — so a hover on one end of the map could hide a label at
    // the other end. The order is fixed now and every chip claims the same
    // space whether it is focused or not, so the layout is a pure function
    // of the geometry and a hover can only change the chip it touches.
    const keep = new Array<boolean>(entries.length).fill(false);
    // The dots, plus the boxes the placed names claimed.
    const obstacles: LabelObstacle[] = [...dots];
    if (originBox) obstacles.push({ id: 'origin', rect: originBox });

    for (const [index, entry] of entries.entries()) {
      const chip = measured[index]!;
      // A chip that has never been laid out has no room to claim yet.
      if (chip.width === 0) continue;

      const ownId = `${entry.shop.id}`;
      const focused = ownId === hoveredShopId || ownId === selectedShopId;

      // Which side of its dot the chip sits on. It starts on the right; when
      // that would put it on top of the origin's chip — and the other side is
      // free — it moves to the left. The move itself is animated by the
      // stylesheet.
      let side: MarkerSide = 'end';
      const endBox = chipBox(entry.dot, chip, chip.width, 'end', rem);
      if (originBox && boxesOverlap(endBox, originBox)) {
        const startBox = chipBox(entry.dot, chip, chip.width, 'start', rem);
        if (!boxesOverlap(startBox, originBox) && startBox.left >= bounds.left) {
          side = 'start';
        }
      }
      const box = side === 'end' ? endBox : chipBox(entry.dot, chip, chip.width, 'start', rem);

      // Where the name has to stop: the map's edge, the first dot in its way,
      // or a name that was placed before it. The focused chip is placed
      // against the same obstacles as everybody else — it only draws itself
      // differently (see below).
      const limit = clipWindow(box, obstacles, bounds, ownId, side);
      // The visible part is what the name claims from the map; the rest of
      // its box is cut away and claims nothing.
      const visibleWidth = side === 'end' ? limit.to - box.left : box.right - limit.from;
      const cut = visibleWidth < chip.width - 0.5;
      // A cut name needs enough left to still be worth reading — below that
      // it is hidden and the shop keeps its dot alone.
      const roomless = cut && visibleWidth < minWidth;

      if (roomless && !focused) {
        // The name is not readable where it stands: it is hidden and claims
        // nothing. A focused chip is always shown, but it claims the same
        // (nothing) either way, so the layout is the same.
        continue;
      }

      // The claim: the space this chip holds on the map. It is the same
      // whether the chip is focused or not — a focused chip that opens up
      // does not take that extra space away from its neighbours.
      if (!roomless) {
        obstacles.push({
          id: ownId,
          rect: new DOMRect(box.left, box.top, visibleWidth, box.bottom - box.top)
        });
      }

      keep[index] = true;
      // The side is a data attribute, so the stylesheet can slide the chip
      // across its dot.
      const element = shopMarkerElements.get(ownId);
      if (element && element.dataset.side !== side) element.dataset.side = side;
      // How the chip is drawn: a focused chip opens up to its full width —
      // it is the user's attention, and a name that is cut short is a name
      // nobody can read — and it floats above the rest. The others keep the
      // cut the layout gave them. The space the chip *claims* is the same
      // either way, so opening it up never moves the layout.
      const displayWidth = focused
        ? side === 'end'
          ? Math.min(box.right, bounds.right) - box.left
          : box.right - Math.max(box.left, bounds.left)
        : visibleWidth;
      const displayCut = displayWidth < chip.width - 0.5;
      // The fade is as wide as the last stretch of the name; a name that is
      // not cut at all needs none.
      applyClip(entry.label, side, Math.max(0, displayWidth), displayCut ? fadePx : 0);
    }

    for (const [index, entry] of entries.entries()) {
      entry.label.classList.toggle('is-colliding', !keep[index]);
      // A name that is fading out keeps the clip it had: dropping the clip
      // first would flash the whole name for a frame before the opacity fade.
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

  /**
   * Turn the chip animations on or off.
   *
   * While the map is moving the chips have to react *now*: a chip that has
   * to move to the other side of its dot, or a name that has to be cut
   * shorter, cannot wait for a transition — the map would carry on moving
   * while the chip lagged behind it. So the map's own motion turns both
   * animations off for as long as it lasts, and the settled state turns them
   * back on.
   */
  const setLabelAnimations = (enabled: boolean) => {
    const container = map?.getContainer();
    if (!container) return;
    if (enabled) container.style.removeProperty('--map-motion-duration');
    else container.style.setProperty('--map-motion-duration', '0s');
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
        const { profile, style: servedStyle } = await orpc.geo.mapStyle({
          longitude: data.location.longitude,
          latitude: data.location.latitude,
          theme,
          locale: getLocale(),
          scope: 'regional'
        });
        // The surface datum of the resolved profile is what the origin and the
        // returned shops are already drawn in.
        datumOfOrigin =
          (profile as { coordinateSystem?: 'WGS84' | 'GCJ02' }).coordinateSystem ?? 'WGS84';
        if (cancelled || !mapContainer) return;

        const adapter = createMapLibreAdapter(profile as never, {
          localFonts: { stacks: ['Sora', 'Noto'], baseUrl: fromPath('/') },
          // Built tiles persist in the browser's Cache API: a repeat visit
          // paints from disk with neither the combo fetch nor the decode —
          // the repeat-visit speed the SDK gets for free from its cacheable
          // GET tiles, which the POST-based combo can never have.
          persistentTileCache: { maxEntries: 2048 }
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
          attributionControl: { compact: true, customAttribution: '' }
        });
        // Recorded before `map` is assigned: the theme effect reads it in the
        // same flush and must see the style's theme to skip its redundant
        // first run.
        styleTheme = theme;
        map = instance;
        // The adapter keeps the attribution in step with this map's view.
        adapter.observeMap(instance);
        const activeMap: maplibregl.Map = instance;
        instance.addControl(new maplibregl.NavigationControl(), 'top-right');

        // The focused metro itinerary, the drawn shop routes and the traffic
        // overlay can only be added once a style has finished loading —
        // MapLibre throws `Style is not done loading.` before that. `load`
        // covers the initial style; `style.load` fires again after every
        // theme swap, whose setStyle drops all three from the map.
        instance.on('load', handleStyleReady);
        instance.on('style.load', handleStyleReady);

        // Origin marker. MapLibre orders markers by DOM order, but the
        // highlight effect manages stacking through each element's z-index
        // style. The origin sits *above* the shop markers: it is the user's
        // own position and it must never be swallowed by a shop that happens
        // to be in the same place. It does not take the pointer, though —
        // `pointer-events: none` lets the shop underneath be hovered and
        // clicked through it.
        const originMarker = new maplibregl.Marker({
          element: createOriginMarkerElement()
        })
          .setLngLat([data.location.longitude, data.location.latitude])
          .addTo(instance);
        originMarkerElement = originMarker.getElement();
        originMarkerElement.style.zIndex = '700';

        // Shop markers with metro line chips and names.
        for (const shop of data.shops) {
          const marker = new maplibregl.Marker({
            element: createShopMarkerElement(shop)
          })
            .setLngLat(shop.location.coordinates as [number, number])
            .addTo(instance);
          const element = marker.getElement();
          const id = `${shop.id}`;
          element.style.zIndex = '400';
          element.addEventListener('mouseenter', () => {
            hoveredShopId = id;
            repaintMarker(element, id);
          });
          element.addEventListener('mouseleave', () => {
            if (hoveredShopId === id) hoveredShopId = null;
            repaintMarker(element, id);
          });
          element.addEventListener('click', (event) => {
            event.stopPropagation();
            // `showShopPopup` dismisses the previous card itself; doing it here
            // too would race the exit timer against the new popup.
            showShopPopup(activeMap, shop);
            handleMarkerClick(id);
            repaintMarker(element, id);
          });
          if (shop.isClosed) {
            element.style.visibility = 'hidden';
          }
          // Paint the initial state, so a marker that is already selected or
          // focused (a selection made before the map finished loading) shows
          // it right away.
          paintMarkerState(element, id, selectedShopId, hoveredShopId, selectedShopId);
          shopMarkerElements.set(id, element);
        }

        activePopup = null;
        fitToShops(instance);

        // Labels are placed against the settled viewport, and re-placed
        // whenever the map moves or resizes. The passes that define the
        // *settled* state run synchronously rather than through a frame:
        // `requestAnimationFrame` is throttled hard in a background or
        // occluded tab, and the labels should be decluttered before the map is
        // first painted anyway. Only the drag-time pass is frame-paced, since
        // it exists to keep up with motion.
        //
        // While the map is moving the chip animations are switched off: a
        // chip that has to move aside or be cut shorter has to do it *now*,
        // not trail the map. The settled pass then re-enables them.
        instance.on('movestart', () => setLabelAnimations(false));
        instance.on('move', scheduleMarkerLabels);
        instance.on('moveend', () => {
          refreshMarkerLabels();
          setLabelAnimations(true);
        });
        instance.on('resize', refreshMarkerLabels);
        instance.once('idle', refreshMarkerLabels);
        refreshMarkerLabels();
        // The cut animation is armed only once the map has measured every
        // name: before that a chip that is cut for the first time has to
        // *appear* cut rather than grow out of nothing.
        requestAnimationFrame(() => {
          for (const element of shopMarkerElements.values()) {
            element
              .querySelector<HTMLElement>('.discover-marker-label')
              ?.style.removeProperty('--clip-anim-duration');
          }
        });
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
      dismissPopupNow();
      shopMarkerElements.clear();
      originMarkerElement = null;
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
        const element = shopMarkerElements.get(`${shop.id}`);
        if (element) element.style.visibility = expanded ? '' : 'hidden';
      }
      scheduleMarkerLabels();
    });
  });

  // Theme changes re-select the style for the current surface. The initial
  // style is already built for the current theme (the map init effect loads
  // it), so the effect must skip its first run: re-applying the same style
  // would tear down every tile and re-fetch the whole basemap for nothing —
  // the double style load that made startup tile rendering twice as slow as
  // the SDK's, and stretched `isStyleLoaded() === false` across the window
  // every early route draw gave up in.
  let styleTheme: 'dark' | 'light' | null = null;
  /**
   * Bumped every time a style finishes loading — once at map init and again
   * after each theme swap. Effects that add sources/layers track it, because
   * `setStyle` drops them: a redraw that only listened for data changes would
   * never repaint after a theme change.
   */
  let mapStyleEpoch = $state(0);

  const handleStyleReady = () => {
    mapStyleEpoch += 1;
  };

  $effect(() => {
    if (!map || darkMode === undefined) return;
    const theme = darkMode ? 'dark' : 'light';
    if (styleTheme === theme) return;
    untrack(async () => {
      try {
        const { profile, style: servedStyle } = await orpc.geo.mapStyle({
          longitude: data.location.longitude,
          latitude: data.location.latitude,
          theme,
          locale: getLocale(),
          scope: 'regional'
        });
        const adapter = createMapLibreAdapter(profile as never, {
          localFonts: { stacks: ['Sora', 'Noto'], baseUrl: fromPath('/') }
        });
        const style = (await adapter.loadStyle(
          servedStyle
        )) as unknown as maplibregl.StyleSpecification;
        mapAdapter = adapter;
        styleTheme = theme;
        // The replacement adapter must re-attach to the live map.
        if (map) adapter.observeMap(map);
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

  // ── Route layers: the resting overview lines ──────────────────────────────
  // One knob decides what the map shows: the selected shop. Its route is the
  // active itinerary (drawn by <Directions>); every other shop's route is a
  // thin resting blue line here. No hover, selection or panel feature states —
  // those were a second, disagreeing source of truth.

  /** The map instance the route line's click/hover listeners are bound to. */
  let routeLayerListenersOn: maplibregl.Map | null = null;

  const clearShopRoutes = () => {
    const instance = map;
    if (!instance) return;
    removeLayerAndSource(instance, ROUTE_LINE_LAYER_ID);
    removeLayerAndSource(instance, ROUTES_SOURCE_ID);
  };

  $effect(() => {
    const instance = map;
    // `travelData` is read before any early return on purpose: Svelte tracks
    // only what an effect *run* actually read, so an effect that bails on an
    // unready style before this line would never hear about the routes that
    // arrive afterwards — and with the style taking tens of seconds to settle
    // (or being replaced wholesale by a theme swap), that was every run.
    const routeEntries = Object.entries(travelData).filter(
      ([, travel]) => travel?.path && travel.path.length >= 2
    );
    // Re-run after every style (re)load as well: `setStyle` drops the source,
    // so a redraw that only listened for data changes never repainted after a
    // theme swap.
    const epoch = mapStyleEpoch;
    // The selected shop's route does not draw here at all: the active
    // itinerary drawing replaces it.
    const selected = selectedShopId;
    if (!instance) return;
    untrack(() => {
      const overviewEntries = routeEntries.filter(([shopId]) => shopId !== selected);
      if (overviewEntries.length === 0) {
        if (instance.getSource(ROUTES_SOURCE_ID)) clearShopRoutes();
        return;
      }
      const features = overviewEntries.map(([shopId, travel]) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: travel!.path },
        id: shopId,
        properties: { shopId }
      }));
      // Feed the existing source first, whatever the style's transaction
      // state: `setData` is always safe, while `isStyleLoaded()` is false
      // even after this effect's own `addSource` until the next render frame
      // — gating every run on it dropped all but the first route.
      let source = instance.getSource(ROUTES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source) {
        // Before the style's first load completes `addSource` throws; the
        // epoch bump on `style.load` re-runs this effect when it does.
        if (epoch === 0) return;
        instance.addSource(ROUTES_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features }
        });
        // Overview lines sit UNDER the active itinerary (`directions-route-*`,
        // owned by <Directions>): when they are re-added while it is already
        // on the map, appending would stack the thin lines on top of it.
        const beforeId = instance.getLayer('directions-route-casing')
          ? 'directions-route-casing'
          : undefined;
        instance.addLayer(
          {
            id: ROUTE_LINE_LAYER_ID,
            type: 'line',
            source: ROUTES_SOURCE_ID,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              // One quiet colour for every resting route; the active itinerary
              // is the only line that speaks.
              'line-color': '#38bdf8',
              'line-width': 3,
              'line-opacity': 0.4
            }
          },
          beforeId
        );
        // Map-level listeners survive `setStyle`, but the layer does not: bind
        // them once per map instance, or every redraw after a theme swap would
        // stack another copy of each handler.
        if (routeLayerListenersOn !== instance) {
          routeLayerListenersOn = instance;
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
      }
      source = instance.getSource(ROUTES_SOURCE_ID) as maplibregl.GeoJSONSource;
      source.setData({ type: 'FeatureCollection', features });
    });
  });

  // ── The one knob: the selected shop ───────────────────────────────────────
  // Everything the map draws and the panel shows follows `selectedShopId`.
  // `directions` mirrors it for the panel: the shop, the route index (reset
  // on a shop change so one shop's tab choice never applies to another), and
  // the open state (a panel without a selection is meaningless). Closing the
  // panel, by contrast, must NOT clear the selection — the active route
  // stays on the map.

  $effect(() => {
    const selected = selectedShopId;
    if (directions.shopId !== selected) {
      directions.shopId = selected;
      directions.selectedRouteIndex = selected
        ? (travelData[selected]?.selectedRouteIndex ?? 0)
        : 0;
    }
    if (!selected && handledSelectionShopId) {
      // Deselected: the next selection of the same shop must fit and open
      // again, so forget that it was handled.
      handledSelectionShopId = null;
      handledSelectionSource = null;
    }
    if (!selected && directions.isOpen) directions.isOpen = false;
  });

  // Selection drives the camera and opens the Directions panel.
  /**
   * What the selection has already been handled with: the shop id and the
   * data source ('route' = a live routed path, 'metro' = the reconstructed
   * itinerary). Guards the camera fit and the panel open against the
   * re-runs every travel-data mutation causes, while still upgrading a metro
   * handling to a route fit when the live path arrives.
   */
  let handledSelectionShopId: string | null = null;
  let handledSelectionSource: 'route' | 'metro' | null = null;
  $effect(() => {
    const selected = selectedShopId;
    if (!selected || !map) return;
    const instance = map;
    // Both reads sit outside `untrack` on purpose: Svelte re-runs an effect
    // only for dependencies its last run actually read, so a route that
    // arrives *after* the selection must be seen here to fit the camera and
    // open the panel at all.
    const route = travelData[selected]?.path;
    const hasMetroItinerary = Boolean(shopRouteData[selected]);
    untrack(() => {
      const shop = data.shops.find((s) => `${s.id}` === selected);
      if (!shop) return;
      const handled = handledSelectionShopId === selected ? handledSelectionSource : null;
      // A first handling opens the panel; later ones only upgrade the drawing
      // and the camera — the user may have closed the panel meanwhile, and a
      // passive arrival must not pop it back open.
      const firstHandling = handled === null;
      if (route && route.length >= 2) {
        if (handled === 'route') return;
        handledSelectionShopId = selected;
        handledSelectionSource = 'route';
        const bounds = new maplibregl.LngLatBounds();
        for (const [lng, lat] of route) bounds.extend([lng, lat]);
        instance.fitBounds(bounds, { padding: 72, duration: 600, maxZoom: 16 });
        if (firstHandling || directions.isOpen) openDirections();
      } else if (hasMetroItinerary) {
        // No live route for this shop, but the server supplied a metro
        // itinerary, so the panel can open without waiting.
        if (handled === 'metro') return;
        handledSelectionShopId = selected;
        handledSelectionSource = 'metro';
        if (firstHandling || directions.isOpen) openDirections();
      } else {
        // Neither has arrived yet: settle the camera on the shop. When the
        // route lands it re-runs this effect into the fit branch above.
        instance.easeTo({
          center: shop.location.coordinates as [number, number],
          zoom: Math.max(instance.getZoom(), 15),
          duration: 600
        });
      }
    });
  });

  // Marker highlight follows hover/selection; the selected shop's marker
  // wears the route-active styling, since its itinerary is what the map
  // draws.
  //
  // The marker listeners repaint their own marker immediately (see
  // `repaintMarker`); this effect keeps every *other* marker in sync when the
  // selection or the hover changes.
  $effect(() => {
    const selected = selectedShopId;
    const hovered = hoveredShopId;
    const routeActiveId = selected;
    untrack(() => {
      for (const shop of data.shops) {
        const element = shopMarkerElements.get(`${shop.id}`);
        if (!element) continue;
        paintMarkerState(element, `${shop.id}`, selected, hovered, routeActiveId);
      }
      // The hovered and selected shops outrank the rest for a label.
      scheduleMarkerLabels();
    });
  });

  // Traffic overlay for the modes that benefit from it.
  $effect(() => {
    const instance = map;
    const adapter = mapAdapter;
    // Re-added after every style (re)load: `setStyle` drops the layer.
    const epoch = mapStyleEpoch;
    if (!instance || !adapter || !epoch) return;
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
  {mapLink}
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
      const sorted = [...result.routes].sort((a, b) => a.durationSeconds - b.durationSeconds);
      const selectedRoute = sorted[index];
      if (selectedRoute) {
        travelData[`${directions.shopId}`] = {
          time: selectedRoute.durationSeconds,
          distance: selectedRoute.distanceMeters / 1000,
          path: selectedRoute.geometry,
          selectedRouteIndex: index,
          routeData: { routes: sorted }
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
       toggle individual classes instead, so MapLibre's own class survives.

       `isolate` is the load-bearing one. It makes this box its own stacking
       context, so everything MapLibre puts inside it — the markers (z-index
       up to 650), the popup card (1200), the nav controls — is painted
       *inside* the map and can never spill out over the page's own overlays.
       Without it those z-index values compete in the root stacking context,
       and the map's chips float on top of the settings dropdown (z-50) and
       the Directions panel (z-1000) — which is exactly the "the map covers
       the page's modal" bug. With it, the map is just page content: it is
       painted below every positioned overlay the page puts on top of it. -->
  <div
    id="map-container"
    class="isolate mb-4 h-[50vh] w-full rounded-xl md:h-[60vh]"
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
          {@const nameCopied = copyFeedback.copiedKey === `${shop.id}`}
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
                  <div class="flex items-center gap-1.5">
                    <div class="text-lg font-bold">{shop.name}</div>
                    <!-- Copy shop name. `type="button"` + the row's own
                         `closest('button, a')` guard keep this from selecting
                         the shop or scrolling the map. -->
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs btn-circle shrink-0 transition-opacity {nameCopied
                        ? 'text-success opacity-100'
                        : 'opacity-40 hover:opacity-100'}"
                      onclick={() => copyFeedback.copy(shop.name, `${shop.id}`)}
                      title={m.copy()}
                      aria-label={m.copy()}
                    >
                      <i class="fa-solid {nameCopied ? 'fa-check' : 'fa-copy'} text-xs"></i>
                    </button>
                  </div>
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
     Tailwind alone, which does not know the daisyUI palette.

     ⚠ `.discover-marker` is the element MapLibre itself transforms:
     `marker.ts` writes `element.style.transform = "translate(x, y)"` on every
     `move`. A `transition: transform` here therefore eases the marker's
     *position* too, which reads as markers lagging behind the basemap while
     the user pans. So: **no transition on `.discover-marker`**, and no
     `transform` on it at all — every animated property lives on the inner dot
     and label instead. `will-change: transform` is deliberately NOT set,
     because the same compositor layer that makes position updates cheap also
     pins the rasterised dot and blurs it.

     ── One palette, four states ────────────────────────────────────────────
     Every state is a single hue (`--marker-hue`) that the dot *and* the chip
     around it are drawn from, plus two weights (`--marker-tint` for the
     chip's background, `--marker-edge` for its border). The states therefore
     differ in *strength*, not in kind: a resting marker is a soft blue, the
     hovered one a bright amber, the selected one a strong red, and the shop
     the drawn ride ends at a green. Nothing about the map's palette is
     invented here — the hues are daisyUI's own semantic colours, so they
     follow the light and the dark theme.

     The dot carries a soft halo in its own hue rather than a hard ring. A
     ring in the page's background colour drew a black ring around every
     marker in the dark theme, which was the loudest thing on the map. */
  :global(.discover-marker) {
    /* The marker's own geometry, shared with the chip that sits beside it. */
    --marker-size: 0.875rem;
    --chip-gap: 0.4rem;
    /* The state defaults to "a place on the map": a blue that is pulled a
       little towards the page's own background, so a resting marker recedes
       instead of competing with the hovered one. */
    --marker-hue: color-mix(in oklab, var(--color-info) 85%, var(--color-base-100) 15%);
    --marker-tint: 6%;
    --marker-edge: 28%;
    --marker-halo: 22%;
  }

  /* The hovered marker is the one that has to be seen first. Amber is a pale
     colour, and on the light theme a pale yellow on a pale map disappears —
     so it is mixed with the theme's text colour, which pulls it down on the
     light theme and up on the dark one. */
  :global(.discover-marker[data-state='hovered']) {
    --marker-hue: color-mix(in oklab, var(--color-warning) 80%, var(--color-base-content) 20%);
    --marker-tint: 12%;
    --marker-edge: 52%;
    --marker-halo: 38%;
  }

  /* Route-active: the shop the drawn itinerary terminates at. */
  :global(.discover-marker[data-route='on']) {
    --marker-hue: var(--color-success);
    --marker-tint: 12%;
    --marker-edge: 50%;
    --marker-halo: 36%;
  }

  /* Declared after route-active so the selection always wins: the selected
     shop is also the route's shop while the pointer is on it. */
  :global(.discover-marker[data-state='selected']) {
    --marker-hue: var(--color-error);
    --marker-tint: 14%;
    --marker-edge: 58%;
    --marker-halo: 42%;
  }

  :global(.discover-marker) {
    @apply flex cursor-pointer items-center justify-center;
    /* The marker's own size. The chip is placed with a transform measured
       against it (see below), so the two live in one variable and cannot
       drift apart. */
    height: var(--marker-size);
    width: var(--marker-size);
  }

  /* The dot carries all of the motion. Transitions are declared here so they
     apply on the first paint too — otherwise the initial `idle` state would
     be set before any transition exists and the first hover snaps. */
  :global(.discover-marker-dot) {
    @apply block h-2.5 w-2.5 rounded-full;
    background-color: var(--marker-hue);
    box-shadow:
      0 0 0 1.5px color-mix(in oklab, var(--marker-hue) 45%, transparent),
      0 0 0 4.5px color-mix(in oklab, var(--marker-hue) var(--marker-halo), transparent);
    transition:
      scale 200ms cubic-bezier(0.34, 1.56, 0.64, 1),
      background-color 160ms ease,
      box-shadow 200ms ease;
  }

  /* Origin marker: larger, and in the accent palette so it never loses
     against a shop dot. It also lets the pointer through to the shop
     underneath — the origin is often the very place a shop is, and the shop
     still has to be hoverable and clickable there. */
  :global(.discover-marker-origin) {
    --marker-hue: color-mix(in oklab, var(--color-accent) 88%, var(--color-base-content) 12%);
    --marker-tint: 0%;
    --marker-edge: 0%;
    --marker-halo: 34%;
    pointer-events: none;
  }

  :global(.discover-marker-origin .discover-marker-dot) {
    @apply h-3 w-3;
    background-color: var(--marker-hue);
    box-shadow:
      0 0 0 1.5px color-mix(in oklab, var(--marker-hue) 55%, transparent),
      0 0 0 5.5px color-mix(in oklab, var(--marker-hue) var(--marker-halo), transparent);
  }

  /* `scale` is used as its own property rather than inside `transform`: it
     composes with MapLibre's inline transform instead of overwriting it. */
  :global(.discover-marker[data-state='hovered'] .discover-marker-dot) {
    scale: 1.45;
  }

  :global(.discover-marker[data-state='selected'] .discover-marker-dot) {
    scale: 1.6;
    animation: discover-marker-pulse 2s ease-in-out infinite;
  }

  /* Only the ring breathes — animating `box-shadow` repaints, but this runs
     on one tiny element, so it stays off the critical path. */
  @keyframes discover-marker-pulse {
    0%,
    100% {
      box-shadow:
        0 0 0 1.5px color-mix(in oklab, var(--marker-hue) 45%, transparent),
        0 0 0 5px color-mix(in oklab, var(--marker-hue) 34%, transparent);
    }
    50% {
      box-shadow:
        0 0 0 1.5px color-mix(in oklab, var(--marker-hue) 45%, transparent),
        0 0 0 9px color-mix(in oklab, var(--marker-hue) 8%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.discover-marker[data-state='selected'] .discover-marker-dot) {
      animation: none;
    }
    :global(.discover-marker-dot) {
      transition: background-color 160ms ease;
    }
  }

  /* The chip is as long as the shop name — no width cap, no ellipsis. It sits
     next to its dot and grows to the right; when it runs out of room it is
     cut and the cut fades out (see the mask rules below).

     The chip is placed with a *transform*, not with `left`/`right`: the
     transform is the only thing that can be transitioned, so it is what
     makes the move from one side of the dot to the other animate. The
     translate is measured against the marker's own box, hence
     `--marker-size`; the chip's gap from the dot is `--chip-gap`.

     `font-family` is re-seeded here explicitly: maplibregl-gl.css hardcodes
     `font: 12px/20px Helvetica Neue,…` on `.maplibregl-map`, and every marker
     lives inside it — so without this the names fall back to the user-agent
     sans instead of the site's stack (the popup card re-seeds it the same way).

     No `backdrop-filter` and no `box-shadow`: the chip is masked (see
     below), and a mask clips everything the element paints outside its own
     box — a shadow would be cut off at the mask's edge, so the chips that
     were cut looked different from the ones that were not. The border and
     the background carry the separation instead. */
  :global(.discover-marker-label) {
    @apply pointer-events-none absolute top-1/2 left-0 flex -translate-y-1/2 items-center gap-x-1.5 rounded-full border px-2 text-xs leading-5 font-medium whitespace-nowrap;
    transform: translateX(calc(var(--marker-size) + var(--chip-gap)));
    background-color: color-mix(
      in oklab,
      var(--marker-hue) var(--marker-tint),
      var(--color-base-100)
    );
    border-color: color-mix(in oklab, var(--marker-hue) var(--marker-edge), transparent);
    /* The name always reads in the page's own text colour. Tinting the text
       with the state colour looked tidy on the dark theme and was unreadable
       on the light one — amber on a near-white chip. */
    color: var(--color-base-content);
    font-family: 'Sora Variable', 'Noto Sans SC Variable', sans-serif;
    transition-property:
      opacity, visibility, background-color, border-color, color, transform, --clip-fade-end,
      --clip-fade-size;
    transition-duration:
      150ms, 150ms, 160ms, 160ms, 160ms, var(--map-motion-duration, 200ms),
      var(--clip-anim-duration, var(--map-motion-duration, 200ms)),
      var(--clip-anim-duration, var(--map-motion-duration, 200ms));
    transition-timing-function:
      ease, ease, ease, ease, ease, cubic-bezier(0.4, 0, 0.2, 1), ease, ease;
  }

  /* The chip on the left of its dot. It slides across the dot, which is what
     the transition on `transform` is for. */
  :global(.discover-marker[data-side='start'] .discover-marker-label) {
    transform: translateX(calc(-100% - var(--chip-gap)));
  }

  /* ── Clipped-edge fades ────────────────────────────────────────────────────
     A name that runs out of room is cut, and a hard cut reads as a bug — so
     the cut end fades out instead. The mask's two stops are custom
     properties so the cut can *move*: a hovered name is released from the
     dots and the other names and opens up to its full width, and the name
     that was cut collapses back to its cut width when the pointer leaves.

     `--clip-fade-end` is the width of the part that is still shown, measured
     from the chip's cut end; `--clip-fade-size` is how wide the fade itself
     is (zero when there is nothing to fade). */
  @property --clip-fade-end {
    syntax: '<length>';
    inherits: false;
    initial-value: 0px;
  }

  @property --clip-fade-size {
    syntax: '<length>';
    inherits: false;
    initial-value: 0px;
  }

  /* The mask is present for as long as the chip is: a name that fits is
     covered by it completely, so the mask never appears or disappears. That
     is the whole point — the stops used to be removed while a name was
     unclipped, which reset them to `0px`, and the next cut then grew the
     name out of nothing instead of clipping it. */
  :global(.discover-marker-label[data-clip='end']) {
    -webkit-mask-image: linear-gradient(
      to right,
      #000 0,
      #000 calc(var(--clip-fade-end) - var(--clip-fade-size)),
      transparent var(--clip-fade-end)
    );
    mask-image: linear-gradient(
      to right,
      #000 0,
      #000 calc(var(--clip-fade-end) - var(--clip-fade-size)),
      transparent var(--clip-fade-end)
    );
  }

  /* The same cut, on a chip that sits to the left of its dot. */
  :global(.discover-marker-label[data-clip='start']) {
    -webkit-mask-image: linear-gradient(
      to left,
      #000 0,
      #000 calc(var(--clip-fade-end) - var(--clip-fade-size)),
      transparent var(--clip-fade-end)
    );
    mask-image: linear-gradient(
      to left,
      #000 0,
      #000 calc(var(--clip-fade-end) - var(--clip-fade-size)),
      transparent var(--clip-fade-end)
    );
  }

  /* The hover and selection feedback lives on the dot — it grows and changes
     colour — and on the chip's border and background, which carry the same
     hue in a slightly stronger weight. The name deliberately does not scale:
     a name is placed against the space its own box claims, so a scaled chip
     claims room it does not have, and on a long name it pushes the chip's
     edge back over its own dot — which would cut the name to nothing. */

  /* Overlapped chips fade out but keep their box: the next declutter pass
     measures them, and a `display: none` chip would measure as zero. */
  :global(.discover-marker-label.is-colliding) {
    opacity: 0;
    visibility: hidden;
  }

  /* The origin's chip is the one solid, saturated label on the map: it says
     "you are here" and nothing else has to compete with it. */
  :global(.discover-marker-label-static) {
    @apply border-transparent font-semibold;
    background-color: var(--color-accent);
    color: var(--color-accent-content);
  }

  :global(.discover-marker-name) {
    @apply min-w-0;
  }

  :global(.discover-marker-lines) {
    @apply flex shrink-0 items-center gap-0.5;
  }

  :global(.discover-marker-line) {
    @apply min-w-5 shrink-0 rounded-sm px-1 text-center leading-5 font-bold whitespace-nowrap;
  }

  /* ── Discover shop popup ─────────────────────────────────────────────────
     The card itself (.discover-popup) carries its own theme-aware
     background and border; maplibreg's own wrapper still defaults to white
     and would otherwise flash through any transparency. The close button
     + tip must reach out of the popup wrapper too.

     `font-family` is re-seeded here explicitly: maplibreg-gl.css hardcodes
     `font: 12px/20px Helvetica Neue,…` on `.maplibregl-map`, and every popup
     lives inside it — so without this the card silently falls back to the
     user-agent sans (looks nothing like the rest of the app, which uses
     Sora / Noto Sans SC from `app.css`).

     `z-index: 1200` puts the popup above the `.discover-marker` layer (which
     maxes out at 650), so the card never sits under a sibling shop chip.
     These values are scoped to the map: the map container is an isolated
     stacking context (`isolate`), so they order the map's own layers and
     never lift the card over the page's overlays.

     ── Blur ──────────────────────────────────────────────────────────────
     Two stacked effects were making the card text look soft, and both are
     fixed here rather than worked around:

       1. `backdrop-filter` on the card. The card is `bg-base-100` — fully
          opaque — so the blur had nothing to sample, but it still forced a
          backdrop root that re-rasterised the text at every animated frame.
          Removed (`backdrop-blur-md` dropped from the class list in JS).
       2. `animation-fill-mode: both` parked the finished keyframe, i.e. a
          residual `transform: scale(1)`. MapLibre's `.maplibregl-popup`
          also declares `will-change: transform`, which promotes the popup to
          its own compositor layer; a live transform on that layer makes
          Chrome rasterise text once at the *animated* scale and never refine
          it. With fill-mode `none` the transform drops back to `none` after
          the animation and the text re-renders through the normal path.

     The entrance therefore animates `opacity` + `translateY` only (no
     `scale`), and never leaves a transform behind. */

  :global(.maplibregl-popup) {
    z-index: 1200;
  }

  /* MapLibre promotes markers and popups to their own compositor layers
     (`will-change: transform`) and moves them with a transform on every
     pan/zoom frame. Chrome keeps such a layer's raster while the transform
     changes, so DOM text turns soft until the layer is re-rasterised. Without
     the hint, text is repainted crisp at the final position. */
  :global(.maplibregl-marker),
  :global(.maplibregl-popup) {
    will-change: auto;
  }

  :global(.maplibregl-popup .maplibregl-popup-content) {
    background: transparent;
    box-shadow: none;
    padding: 0;
    /* Re-seed the site font: maplibreg's own `.maplibregl-map` shorthand
       overrides the body font for every descendant it contains. */
    font-family: 'Sora Variable', 'Noto Sans SC Variable', sans-serif;
    /* Entrance. `fill-mode` is deliberately NOT `both` — see above. */
    animation: discover-popup-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* Exit. `showShopPopup` adds `is-closing` on the wrapper, waits for this
     animation, then calls `popup.remove()`. Duration is read in JS from the
     constant below so the two never drift apart. The card's tail is a child
     of the card, so it leaves with it. */
  :global(.maplibregl-popup.is-closing .maplibregl-popup-content) {
    animation: discover-popup-out 160ms cubic-bezier(0.4, 0, 1, 1) forwards;
  }

  @keyframes discover-popup-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes discover-popup-out {
    from {
      opacity: 1;
      transform: translateY(0);
    }
    to {
      opacity: 0;
      transform: translateY(4px);
    }
  }

  /* ── The popup's tail ───────────────────────────────────────────────────
     MapLibre ships a `.maplibregl-popup-tip`: a border-triangle that lives
     *beside* the card, as a separate element painted before it. It cannot
     join ours. Our card is rounded and shadowed, so the triangle's straight
     base never meets the card's rounded corner — a wedge of basemap shows
     through between the two — and the card's drop shadow falls across the
     triangle's base anyway. That seam is the gap in the screenshot.

     So MapLibre's tip is hidden and the tail is drawn as part of the card
     itself: a square rotated 45°, centred on the card's edge. Half of it
     overlaps the card — same element, same colour — so the only thing left
     to see is the half that sticks out, and the card and its tail read as
     one continuous shape. Being a child of the card also puts the tail
     above the card's shadow, so no shadow line can cut across it either.

     MapLibre picks the anchor dynamically — the card flips to whichever
     side has room — and puts the matching `maplibregl-popup-anchor-*` class
     on its wrapper, so the tail follows the card to whichever edge the
     point is on. The corner anchors put the tail right on the corner, where
     it points at the point diagonally; it is bigger there, because the
     card's corner is rounded and the tail has to cover that radius (see
     the note on the corner rules below). */
  :global(.maplibregl-popup-tip) {
    display: none;
  }

  :global(.discover-popup::after) {
    content: '';
    position: absolute;
    width: 14px;
    height: 14px;
    background-color: var(--color-base-100);
    transform: rotate(45deg);
  }

  /* The card hangs below the point → the tail points up at it. */
  :global(.maplibregl-popup-anchor-top .discover-popup::after) {
    top: -7px;
    left: 50%;
    margin-left: -7px;
  }

  /* The card sits above the point → the tail points down at it. */
  :global(.maplibregl-popup-anchor-bottom .discover-popup::after) {
    bottom: -7px;
    left: 50%;
    margin-left: -7px;
  }

  /* The card sits to the right of the point → the tail points left. */
  :global(.maplibregl-popup-anchor-left .discover-popup::after) {
    left: -7px;
    top: 50%;
    margin-top: -7px;
  }

  /* The card sits to the left of the point → the tail points right. */
  :global(.maplibregl-popup-anchor-right .discover-popup::after) {
    right: -7px;
    top: 50%;
    margin-top: -7px;
  }

  /* Corner anchors: the card's own corner is the pointer. That corner is
     squared off and no tail is drawn, so the card stays one clean shape
     with its border instead of a diamond poking out of a rounded corner. */
  :global(.maplibregl-popup-anchor-top-left .discover-popup),
  :global(.maplibregl-popup-anchor-top-right .discover-popup),
  :global(.maplibregl-popup-anchor-bottom-left .discover-popup),
  :global(.maplibregl-popup-anchor-bottom-right .discover-popup) {
    &::after {
      display: none;
    }
  }

  :global(.maplibregl-popup-anchor-top-left .discover-popup) {
    border-top-left-radius: 0;
  }

  :global(.maplibregl-popup-anchor-top-right .discover-popup) {
    border-top-right-radius: 0;
  }

  :global(.maplibregl-popup-anchor-bottom-left .discover-popup) {
    border-bottom-left-radius: 0;
  }

  :global(.maplibregl-popup-anchor-bottom-right .discover-popup) {
    border-bottom-right-radius: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.maplibregl-popup .maplibregl-popup-content),
    :global(.maplibregl-popup.is-closing .maplibregl-popup-content) {
      animation: none;
    }
  }
</style>
