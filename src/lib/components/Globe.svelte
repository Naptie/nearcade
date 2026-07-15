<script lang="ts">
  import { base, resolve } from '$app/paths';
  import { goto, invalidate } from '$app/navigation';
  import { onMount, untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import '$lib/styles/maplibre.css';
  import { SvelteMap } from 'svelte/reactivity';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import ShopCard from '$lib/components/ShopCard.svelte';
  import { isTouchscreen, getGameName, getAddressParts } from '$lib/utils';
  import { GAME_TITLES } from '$lib/constants';
  import type { GlobeShop } from '$lib/types';
  import {
    GlobeVisualsLayer,
    DEFAULT_CLOUD_SHADOW_OPACITY,
    type GlobeLayerName
  } from '$lib/utils/globe/visuals';
  import { FpsMonitor, runGlobeBenchmark, type BenchmarkResult } from '$lib/utils/globe/benchmark';
  import { type ThemeMode } from '$lib/utils/theme';
  import {
    applyBingDarkMode,
    bingTransformRequest,
    fixBingStyleUrls,
    getBingStyleUrl,
    prefetchBingTiles
  } from '$lib/utils/globe/bing';

  // ---- Props ----
  type Props = {
    mode: 'landing' | 'fullscreen';
    shopData?: Promise<GlobeShop[]> | null;
  };
  let { mode, shopData }: Props = $props();

  // ---- Imperative visual mode ----
  // Use direct DOM manipulation instead of reactive state to avoid Svelte's
  // expensive flush cycle (~400ms) when the visual mode changes.
  // The sidebar, bottom gradient, etc. are shown/hidden via getElementById.
  let visualModeTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- Globe layer/source IDs ----
  const GLOBE_DATA_ENDPOINT = `${base}/api/globe/data`;
  const SHOPS_SOURCE_ID = 'shops';
  const SHOPS_LAYER_ID = 'shops-circles';
  const SHOPS_ACTIVE_LAYER_ID = 'shops-circles-active';
  const SHOPS_PINNED_LAYER_ID = 'shops-circles-pinned';
  const SHOPS_NAME_LAYER_ID = 'shops-names';
  const FONT_STACK = ['Sora Regular', 'Noto Sans CJK SC Regular'];

  const LANDING_ZOOM = 3.2;
  const LANDING_PITCH = 15;
  const LANDING_BEARING = 10 + Math.random() * 10;
  const LANDING_ROTATION_SPEED = 0.03; // degrees per second
  const LANDING_LONGITUDE = 80; // starting longitude
  const LANDING_LATITUDE = 15; // starting latitude
  const VISUAL_TEXTURE_TRANSCODER_PATH = `${base}/globe/basis/`;
  const VISUAL_TEXTURE_HIGH_RES_PREFETCH_ZOOM = 3.8;
  const VISUAL_TEXTURE_HIGH_RES_SWAP_ZOOM = 4.2;
  const VISUAL_TEXTURE_HIGH_RES_RELEASE_ZOOM = 3.6;
  /**
   * Cap the rendering resolution on high-DPR devices. Modern phones report 2.5x–3x
   * DPR, which makes the full-screen globe render several times more pixels than
   * necessary and is a major source of heat and battery drain.
   */
  const GLOBE_MAX_PIXEL_RATIO = 2;
  const getGlobePixelRatio = () => Math.min(window.devicePixelRatio || 1, GLOBE_MAX_PIXEL_RATIO);

  type EnsureMapLayersOptions = {
    deferVisuals?: boolean;
  };

  const VISUAL_TEXTURE_URLS = {
    low: {
      cloud: `${base}/globe/clouds_4k.ktx2`,
      nightLights: `${base}/globe/nightlights_4k.ktx2`,
      specular: `${base}/globe/specular_map_4k.ktx2`,
      normal: `${base}/globe/normal_map_4k.ktx2`,
      dayMap: `${base}/globe/day_map.ktx2`
    },
    high: {
      cloud: `${base}/globe/clouds.ktx2`,
      nightLights: `${base}/globe/nightlights.ktx2`,
      specular: `${base}/globe/specular_map.ktx2`,
      normal: `${base}/globe/normal_map_4k.ktx2`,
      dayMap: `${base}/globe/day_map_4k.ktx2`
    }
  };

  const DENSITY_COLOR_EXPR: maplibregl.ExpressionSpecification = [
    'match',
    ['get', 'density'],
    1,
    '#22c55e',
    2,
    '#eab308',
    3,
    '#f97316',
    4,
    '#ef4444',
    '#6b7280'
  ];

  // ---- Map state ----
  let mapContainer = $state<HTMLDivElement | undefined>();
  let map = $state<maplibregl.Map | undefined>();
  let navigationControl: maplibregl.NavigationControl | null = null;
  let currentLocale = $derived(getLocale());
  let currentTheme = $state<ThemeMode>('light');
  let isMapStyleLoading = $state(false);
  let visualsLayer: GlobeVisualsLayer | null = null;
  let dayMapLayer: GlobeVisualsLayer | null = null;
  let viewTime = $state(new Date());
  let labelLayersEnabled = $state(false);

  // ---- Dev-only performance monitoring ----
  let sidebarEnabled = $state(true);
  let fpsMonitor: FpsMonitor | null = $state(null);
  let currentFps = $state(0);
  let avgFps = $state(0);
  let benchmarkRunning = $state(false);
  let benchmarkProgress = $state(0);
  let benchmarkResult: BenchmarkResult | null = $state(null);
  let benchmarkAbortController: AbortController | null = null;
  let startBenchmark: (() => void) | null = null;
  let stopBenchmark: (() => void) | null = null;

  // ---- Shop location pick mode ----
  let shopLocationPickMode = $state(false);
  let pendingShopCoords = $state<{ lat: number; lng: number } | null>(null);
  let shopPickMarker: maplibregl.Marker | null = null;

  // ---- Globe feature settings ----
  type GlobeFeatureSettings = {
    visualLayers: {
      specular: boolean;
      nightLights: boolean;
      atmosphere: boolean;
      clouds: boolean;
      cloudShadows: boolean;
      cloudShadowOpacity: number;
      dayMap: boolean;
    };
    mapOverlays: {
      shopMarkers: boolean;
    };
  };

  let globeFeatureSettings = $state<GlobeFeatureSettings>({
    visualLayers: {
      specular: true,
      nightLights: true,
      atmosphere: true,
      clouds: true,
      cloudShadows: true,
      cloudShadowOpacity: DEFAULT_CLOUD_SHADOW_OPACITY,
      dayMap: true
    },
    mapOverlays: {
      shopMarkers: true
    }
  });

  const updateGlobeFeatureSettings = (
    update: (current: GlobeFeatureSettings) => GlobeFeatureSettings
  ) => {
    globeFeatureSettings = update(globeFeatureSettings);
  };

  const globeFeatureSettingsKey = $derived(
    JSON.stringify({
      shopMarkers: globeFeatureSettings.mapOverlays.shopMarkers
    })
  );

  const globeVisualSettingsKey = $derived(
    JSON.stringify({
      specular: globeFeatureSettings.visualLayers.specular,
      nightLights: globeFeatureSettings.visualLayers.nightLights,
      atmosphere: globeFeatureSettings.visualLayers.atmosphere,
      clouds: globeFeatureSettings.visualLayers.clouds,
      cloudShadows: globeFeatureSettings.visualLayers.cloudShadows,
      cloudShadowOpacity: globeFeatureSettings.visualLayers.cloudShadowOpacity,
      dayMap: globeFeatureSettings.visualLayers.dayMap
    })
  );

  // ---- Auto-rotation ----
  let animationFrameId: number | null = null;
  let lastFrameTime = 0;
  const ROTATION_FPS_CAP = 30;
  const ROTATION_FRAME_MS = 1000 / ROTATION_FPS_CAP;
  let lastRotationTime = 0;

  const startAutoRotation = () => {
    if (animationFrameId !== null) return;
    lastFrameTime = performance.now();
    lastRotationTime = 0;
    const rotate = (timestamp: number) => {
      const instance = map;
      if (!instance || mode !== 'landing') {
        animationFrameId = null;
        return;
      }
      if (timestamp - lastRotationTime < ROTATION_FRAME_MS) {
        animationFrameId = requestAnimationFrame(rotate);
        return;
      }
      const dt = (timestamp - lastFrameTime) / 1000;
      lastFrameTime = timestamp;
      lastRotationTime = timestamp;
      const center = instance.getCenter();
      center.lng = (center.lng + LANDING_ROTATION_SPEED * dt * 60) % 360;
      instance.setCenter(center);
      animationFrameId = requestAnimationFrame(rotate);
    };
    animationFrameId = requestAnimationFrame(rotate);
  };

  const stopAutoRotation = () => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  // ---- Gradient blur layers (same pattern as NavigationBar, reversed direction) ----
  const maxBlurRadius = 64;
  const blurIterations = 16;
  const bottomBlurLayers = Array.from({ length: blurIterations }, (_, i) => ({
    blur: maxBlurRadius / (4 * maxBlurRadius) ** (i / (blurIterations - 1)),
    maskStops: [
      Math.max(0, ((i - 2) * 100) / blurIterations),
      Math.max(0, ((i - 1) * 100) / blurIterations),
      (i * 100) / blurIterations,
      ((i + 1) * 100) / blurIterations
    ]
  }));

  // ---- Shop data state ----
  type ShopEntry = {
    shop: GlobeShop;
    location: { latitude: number; longitude: number };
  };

  type GlobeDataResponse = {
    shops: GlobeShop[];
  };

  let shopDataResolved = $state<GlobeShop[]>([]);
  let shops = $state<ShopEntry[] | null>(null);
  const shopLookup = new SvelteMap<string, ShopEntry>();
  let lazyGlobeDataPromise: Promise<GlobeDataResponse> | null = null;
  let globeDataRequestId = 0;
  let globeDataRefreshToken = $state(0);

  const getShopKey = (shop: Pick<GlobeShop, 'id'>) => `${shop.id}`;

  const applyResolvedGlobeData = (resolvedShops: GlobeShop[]) => {
    shopDataResolved = resolvedShops;
  };

  const fetchGlobeData = () => {
    if (!lazyGlobeDataPromise) {
      lazyGlobeDataPromise = fetch(GLOBE_DATA_ENDPOINT)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Failed to load globe data (${response.status})`);
          }
          return (await response.json()) as GlobeDataResponse;
        })
        .catch((error) => {
          lazyGlobeDataPromise = null;
          throw error;
        });
    }

    return lazyGlobeDataPromise;
  };

  // ---- Pinned / hover shop state ----
  let markerHoveredShop = $state<GlobeShop | null>(null);
  let pinnedShop = $state<GlobeShop | null>(null);

  let cursorPos = $state({ x: 0, y: 0 });
  const COMPACT_VIEWPORT_MEDIA_QUERY = '(max-width: 47.999rem)';
  let isCompactViewport = $state(false);
  let isCoarsePointer = $state(false);

  // ---- Sidebar state ----
  let sidebarOpen = $state(false);
  let sidebarCollapsed = $state(false);
  let sidebarExpandedWidth = $state<number | undefined>(undefined);
  // ---- Floating sidebar position/size (desktop) ----
  let sidebarPos = $state({ x: 16, y: 64 });
  let sidebarSize = $state<{ w: number | undefined; h: number | undefined }>({
    w: undefined,
    h: undefined
  });
  let isDraggingSidebar = $state(false);
  let isResizingSidebar = $state(false);
  let sidebarDragStart = { mx: 0, my: 0, sx: 0, sy: 0 };
  let sidebarResizeStart = { mx: 0, my: 0, sw: 0, sh: 0 };
  let searchQuery = $state('');
  let selectedTitleIds = $state<number[]>([]);
  const cardRefs = new SvelteMap<string, HTMLDivElement | undefined>();

  const syncResponsiveFlags = () => {
    isCompactViewport = window.matchMedia(COMPACT_VIEWPORT_MEDIA_QUERY).matches;
    isCoarsePointer = isTouchscreen();
    if (isCompactViewport) {
      isDraggingSidebar = false;
      isResizingSidebar = false;
      sidebarCollapsed = false;
    }
  };

  const getSidebarCssVars = () =>
    [
      `--globe-sidebar-left: ${sidebarPos.x}px`,
      `--globe-sidebar-top: ${sidebarPos.y}px`,
      sidebarSize.w !== undefined ? `--globe-sidebar-width: ${sidebarSize.w}px` : '',
      sidebarSize.h !== undefined ? `--globe-sidebar-height: ${sidebarSize.h}px` : ''
    ]
      .filter(Boolean)
      .join('; ');

  const PAGE_SIZE = 6;
  const INITIAL_RENDER_COUNT = 4;
  let visibleCount = $state(0);
  let listSentinelEl = $state<HTMLDivElement | undefined>();
  let sidebarReady = $state(false);

  $effect(() => {
    const _len = filteredShops?.length ?? 0;
    void _len;
    visibleCount = 0;
    let loaded = 0;
    let raf: number | null = null;
    const step = () => {
      loaded = Math.min(loaded + INITIAL_RENDER_COUNT, PAGE_SIZE);
      visibleCount = loaded;
      if (loaded < PAGE_SIZE && loaded < (_len || 0)) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  });

  $effect(() => {
    const sentinel = listSentinelEl;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          visibleCount =
            (filteredShops?.length ?? 0) > visibleCount ? visibleCount + PAGE_SIZE : visibleCount;
        }
      },
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  // ---- Region filter ----
  type RegionFilter =
    | { type: 'world' }
    | { type: 'address'; address: string[] }
    | { type: 'country'; countryName: string }
    | { type: 'country-level1'; countryName: string; level1Name: string }
    | { type: 'country-level2'; countryName: string; level1Name: string; level2Name: string }
    | {
        type: 'country-level3';
        countryName: string;
        level1Name: string;
        level2Name: string;
        level3Name: string;
      };

  let regionFilter = $state<RegionFilter>({ type: 'world' });

  const regionTitle = $derived.by(() => {
    switch (regionFilter.type) {
      case 'world':
        return m.world();
      case 'address':
        return regionFilter.address[regionFilter.address.length - 1];
      case 'country':
        return regionFilter.countryName;
      case 'country-level1':
        return regionFilter.level1Name;
      case 'country-level2':
        return regionFilter.level2Name;
      case 'country-level3':
        return regionFilter.level3Name;
    }
  });

  const regionHierarchy = $derived.by((): string[] => {
    switch (regionFilter.type) {
      case 'world':
        return [];
      case 'address':
        return getAddressParts(regionFilter.address).slice(0, -1);
      case 'country':
        return [];
      case 'country-level1':
        return [regionFilter.countryName];
      case 'country-level2':
        return [regionFilter.countryName, regionFilter.level1Name];
      case 'country-level3':
        return [regionFilter.countryName, regionFilter.level1Name, regionFilter.level2Name];
    }
  });

  const filteredShops = $derived.by(() => {
    if (!shops) return null;
    const q = searchQuery.trim().toLowerCase();
    return shops.filter(({ shop }) => {
      const general = shop.address.general;
      let matchesRegion = false;
      switch (regionFilter.type) {
        case 'world':
          matchesRegion = true;
          break;
        case 'address':
          matchesRegion = regionFilter.address.every(
            (v, i) => general.length <= i || v.toLowerCase() === general[i].toLowerCase()
          );
          break;
        case 'country':
          matchesRegion = general[0] === regionFilter.countryName;
          break;
        case 'country-level1':
          matchesRegion =
            general[0] === regionFilter.countryName && general[1] === regionFilter.level1Name;
          break;
        case 'country-level2':
          matchesRegion =
            general[0] === regionFilter.countryName &&
            general[1] === regionFilter.level1Name &&
            general[2] === regionFilter.level2Name;
          break;
        case 'country-level3':
          matchesRegion =
            general[0] === regionFilter.countryName &&
            general[1] === regionFilter.level1Name &&
            general[2] === regionFilter.level2Name &&
            general[3] === regionFilter.level3Name;
          break;
      }
      if (!matchesRegion) return false;
      if (q) {
        try {
          const nameMatch = shop.name.toLowerCase().includes(q);
          const addrMatch = shop.address.general.some((v) => v.toLowerCase().includes(q));
          if (!nameMatch && !addrMatch) return false;
        } catch {
          return false;
        }
      }
      if (selectedTitleIds.length > 0) {
        if (!selectedTitleIds.every((tid) => shop.aggregatedGames.some((g) => g.titleId === tid)))
          return false;
      }
      return true;
    });
  });

  $effect(() => {
    const key = markerHoveredShop ? getShopKey(markerHoveredShop) : '';
    const instance = map;
    if (!instance?.getLayer(SHOPS_ACTIVE_LAYER_ID)) return;
    instance.setFilter(SHOPS_ACTIVE_LAYER_ID, ['==', ['get', 'key'], key]);
  });

  $effect(() => {
    const key = pinnedShop ? getShopKey(pinnedShop) : '';
    const instance = map;
    if (!instance?.getLayer(SHOPS_PINNED_LAYER_ID)) return;
    instance.setFilter(SHOPS_PINNED_LAYER_ID, ['==', ['get', 'key'], key]);
  });

  $effect(() => {
    const refreshToken = globeDataRefreshToken;
    const requestId = ++globeDataRequestId;
    void refreshToken;

    void (async () => {
      try {
        const sourceShopData = untrack(() => shopData);
        if (sourceShopData) {
          const resolvedShops = await sourceShopData;
          if (requestId !== globeDataRequestId) return;
          applyResolvedGlobeData(resolvedShops);
        } else {
          const response = await fetchGlobeData();
          if (requestId !== globeDataRequestId) return;
          applyResolvedGlobeData(response.shops);
        }
      } catch (error) {
        if (requestId !== globeDataRequestId) return;
        console.error('Failed to load globe shop data:', error);
      }
    })();
  });

  $effect(() => {
    if (!shopDataResolved.length) return;
    const nextShops = shopDataResolved.map((shop) => ({
      shop,
      location: {
        latitude: shop.location.coordinates[1],
        longitude: shop.location.coordinates[0]
      }
    }));
    shops = nextShops;
    shopLookup.clear();
    for (const entry of nextShops) shopLookup.set(getShopKey(entry.shop), entry);
  });

  $effect(() => {
    const instance = map;
    const shopsData = shops;
    if (!instance || !shopsData) return;
    const source = instance.getSource(SHOPS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: shopsData.map(({ shop, location }) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [location.longitude, location.latitude] },
        properties: {
          key: getShopKey(shop),
          density: shop.density,
          name: shop.name.replace('（', '(').replace('）', ')')
        }
      }))
    });
  });

  const flyToWithAnticipatedBasemap = (
    instance: maplibregl.Map,
    options: maplibregl.FlyToOptions & { center: maplibregl.LngLatLike; zoom: number }
  ) => {
    const center = maplibregl.LngLat.convert(options.center);
    prefetchBingTiles(instance, [center.lng, center.lat], options.zoom, { radius: 1 });
    instance.flyTo(options);
  };

  const flyToShop = (entry: ShopEntry) => {
    const instance = map;
    if (!instance) return;
    flyToWithAnticipatedBasemap(instance, {
      center: [entry.location.longitude, entry.location.latitude],
      zoom: Math.max(instance.getZoom(), 10),
      duration: 1200
    });
  };

  const pinShop = (shopEntry: ShopEntry) => {
    pinnedShop = shopEntry.shop;
    markerHoveredShop = null;
    flyToShop(shopEntry);
    if (isCompactViewport) sidebarOpen = true;
    requestAnimationFrame(() => {
      cardRefs.get(getShopKey(shopEntry.shop))?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    });
  };

  const enterShopLocationPickMode = () => {
    shopLocationPickMode = true;
    pendingShopCoords = null;
    // Reset cursor
    map?.getCanvas().setAttribute('style', 'cursor: crosshair');
  };

  const exitShopLocationPickMode = () => {
    shopLocationPickMode = false;
    pendingShopCoords = null;
    shopPickMarker?.remove();
    shopPickMarker = null;
    map?.getCanvas().removeAttribute('style');
  };

  const confirmShopLocation = () => {
    if (!pendingShopCoords) return;
    const { lat, lng } = pendingShopCoords;
    const params = new URLSearchParams({
      lat: lat.toFixed(6),
      lng: lng.toFixed(6)
    });
    exitShopLocationPickMode();
    void goto(`${base}/shops/new?${params}`);
  };

  const applyShopRegionFilter = (shop: GlobeShop) => {
    const general = shop.address.general;
    if (!general.length) {
      regionFilter = { type: 'world' };
      return;
    }
    regionFilter = { type: 'address', address: general };
  };

  const isShopInCurrentFilter = (shop: GlobeShop): boolean => {
    const fs = filteredShops;
    if (!fs) return false;
    const key = getShopKey(shop);
    return fs.some(({ shop: s }) => getShopKey(s) === key);
  };

  // ---- Floating sidebar drag / resize (desktop) ----
  const clampSidebarPos = (x: number, y: number) => ({
    x: Math.max(0, Math.min(window.innerWidth - (sidebarCollapsed ? 52 : sidebarSize.w!), x)),
    y: Math.max(0, Math.min(window.innerHeight - 60, y))
  });

  const startSidebarDrag = (e: PointerEvent) => {
    if (isCompactViewport || sidebarCollapsed) return;
    if ((e.target as HTMLElement).closest('button')) return;
    isDraggingSidebar = true;
    sidebarDragStart = { mx: e.clientX, my: e.clientY, sx: sidebarPos.x, sy: sidebarPos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const moveSidebarDrag = (e: PointerEvent) => {
    if (!isDraggingSidebar) return;
    const nx = sidebarDragStart.sx + e.clientX - sidebarDragStart.mx;
    const ny = sidebarDragStart.sy + e.clientY - sidebarDragStart.my;
    sidebarPos = clampSidebarPos(nx, ny);
  };

  const stopSidebarDrag = () => {
    isDraggingSidebar = false;
  };

  const startSidebarResize = (e: PointerEvent) => {
    if (isCompactViewport) return;
    isResizingSidebar = true;
    sidebarResizeStart = { mx: e.clientX, my: e.clientY, sw: sidebarSize.w!, sh: sidebarSize.h! };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const moveSidebarResize = (e: PointerEvent) => {
    if (!isResizingSidebar) return;
    const nw = Math.max(280, sidebarResizeStart.sw + e.clientX - sidebarResizeStart.mx);
    const nh = Math.max(300, sidebarResizeStart.sh + e.clientY - sidebarResizeStart.my);
    sidebarSize = {
      w: Math.min(window.innerWidth - sidebarPos.x, nw),
      h: Math.min(window.innerHeight - sidebarPos.y, nh)
    };
  };

  const stopSidebarResize = () => {
    isResizingSidebar = false;
  };

  const collapseSidebar = () => {
    if (isCompactViewport) return;
    sidebarExpandedWidth = sidebarSize.w;
    sidebarCollapsed = true;
  };

  const expandSidebar = () => {
    if (isCompactViewport) return;
    if (sidebarExpandedWidth !== undefined) {
      sidebarSize.w = sidebarExpandedWidth;
    }
    sidebarCollapsed = false;
  };

  // ---- Sun position ----
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const getSunPosition = (date: Date) => {
    const MS_PER_DAY = 1e3 * 60 * 60 * 24;
    const J1970 = 2440588;
    const J2000 = 2451545;
    const e = toRad(23.4397);
    const days = date.valueOf() / MS_PER_DAY - 0.5 + J1970 - J2000;
    const M = toRad(357.5291 + 0.98560028 * days);
    const C = 1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 3e-4 * Math.sin(3 * M);
    const L = M + toRad(C + 102.9372) + Math.PI;
    const dec = Math.asin(Math.sin(L) * Math.sin(e));
    const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
    const th0 = toRad(280.16 + 360.9856235 * days);
    const lng = ra - th0;
    const x = Math.cos(dec) * Math.sin(lng);
    const y = -Math.sin(dec);
    const z = -Math.cos(dec) * Math.cos(lng);
    const polar = Math.acos(z);
    const azimuth = Math.atan2(x, y);
    return { azimuthDeg: (toDeg(azimuth) + 360) % 360, polarDeg: toDeg(polar) };
  };

  const atmosphereBlend: maplibregl.SkySpecification['atmosphere-blend'] = [
    'interpolate',
    ['linear'],
    ['zoom'],
    // Full built-in atmosphere while zoomed out on the globe.
    0,
    0.4,
    // Keep it strong through the mid-zoom range so the custom atmosphere shell
    // enhances rather than replaces the built-in sky contribution.
    8,
    0.4,
    // Fade it back as the camera zooms in toward flat-map detail.
    10,
    0.1
  ];
  let deferredVisualsRafId: number | null = null;
  let deferredVisualsRafTailId: number | null = null;
  let deferredVisualsRetryTimeoutId: number | null = null;
  const sunPosition = $derived.by(() => {
    const { azimuthDeg, polarDeg } = getSunPosition(viewTime);
    return { azimuth: azimuthDeg, polar: polarDeg };
  });

  const a = $derived(sunPosition.azimuth);
  const p = $derived(sunPosition.polar);

  const isShopMarkersEnabled = () => globeFeatureSettings.mapOverlays.shopMarkers;

  const getAtmosphereBlend = (): maplibregl.SkySpecification['atmosphere-blend'] =>
    globeFeatureSettings.visualLayers.atmosphere ? atmosphereBlend : 0;

  const syncScene = (instance: maplibregl.Map, azimuth = a, polar = p) => {
    instance.setProjection({ type: 'globe' });
    instance.setLight({
      anchor: 'map',
      intensity: 0.12,
      position: [1, azimuth, polar]
    });
    instance.setSky({ 'atmosphere-blend': getAtmosphereBlend() });
  };

  const toDatetimeLocalValue = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const setLayerVisibility = (instance: maplibregl.Map, layerId: string, visible: boolean) => {
    if (instance.getLayer(layerId)) {
      const desired = visible ? 'visible' : 'none';
      // Skip the API call if the layer is already in the desired state —
      // each setLayoutProperty call can trigger style recalculation.
      if (instance.getLayoutProperty(layerId, 'visibility') !== desired) {
        instance.setLayoutProperty(layerId, 'visibility', desired);
      }
    }
  };

  const cancelDeferredVisualsLayer = () => {
    if (deferredVisualsRafId !== null) window.cancelAnimationFrame(deferredVisualsRafId);
    if (deferredVisualsRafTailId !== null) window.cancelAnimationFrame(deferredVisualsRafTailId);
    if (deferredVisualsRetryTimeoutId !== null) window.clearTimeout(deferredVisualsRetryTimeoutId);
    deferredVisualsRafId = null;
    deferredVisualsRafTailId = null;
    deferredVisualsRetryTimeoutId = null;
  };

  const scheduleDeferredVisualsLayer = (instance: maplibregl.Map) => {
    if (instance.getLayer('globe-visuals')) return;
    if (
      deferredVisualsRafId !== null ||
      deferredVisualsRafTailId !== null ||
      deferredVisualsRetryTimeoutId !== null
    ) {
      return;
    }

    deferredVisualsRafId = window.requestAnimationFrame(() => {
      deferredVisualsRafId = null;
      deferredVisualsRafTailId = window.requestAnimationFrame(() => {
        deferredVisualsRafTailId = null;
        if (!map || map.getCanvas() !== instance.getCanvas() || !instance.isStyleLoaded()) {
          // Style can still report not-loaded right after style.load while
          // MapLibre continues internal setup. Retry shortly instead of giving up.
          if (map && map.getCanvas() === instance.getCanvas() && !instance.isStyleLoaded()) {
            deferredVisualsRetryTimeoutId = window.setTimeout(() => {
              deferredVisualsRetryTimeoutId = null;
              scheduleDeferredVisualsLayer(instance);
            }, 180);
          }
          return;
        }
        // If the camera is still flying/zooming, postpone the heavy visuals-layer
        // attach (shader compile + texture upload) until the transition settles.
        if (instance.isMoving() || instance.isZooming()) {
          scheduleDeferredVisualsLayer(instance);
          return;
        }
        if (!instance.getLayer('globe-visuals')) {
          ensureVisualsLayer(instance);
        }
      });
    });
  };

  const applyVisualsDevSettings = (layer: GlobeVisualsLayer) => {
    const visualLayers = globeFeatureSettings.visualLayers;
    layer.setSun(a, p);
    layer.setMeshVisible('specular', visualLayers.specular);
    layer.setMeshVisible('nightLights', visualLayers.nightLights);
    layer.setMeshVisible('atmosphere', visualLayers.atmosphere);
    layer.setMeshVisible('clouds', visualLayers.clouds);
    layer.setMeshVisible('cloudShadow', visualLayers.cloudShadows);
    layer.setMeshVisible('dayMap', visualLayers.dayMap);
    layer.setCloudShadowOpacity(visualLayers.cloudShadowOpacity);
  };

  const syncVisualTextureDetail = (instance: maplibregl.Map) => {
    const zoom = instance.getZoom();
    const highRes = mode === 'fullscreen';
    visualsLayer?.setTextureDetail(zoom, highRes);
    dayMapLayer?.setTextureDetail(zoom, highRes);
  };

  const getEnabledVisualLayerNames = (): GlobeLayerName[] => {
    const visualLayers = globeFeatureSettings.visualLayers;
    const layerNames: GlobeLayerName[] = [];
    if (visualLayers.specular) layerNames.push('specular');
    if (visualLayers.nightLights) layerNames.push('nightLights');
    if (visualLayers.atmosphere) layerNames.push('atmosphere');
    if (visualLayers.clouds) layerNames.push('clouds');
    if (visualLayers.cloudShadows) layerNames.push('cloudShadow');
    if (visualLayers.dayMap) layerNames.push('dayMap');
    return layerNames;
  };

  const getBingBoundaryAnchor = (instance: maplibregl.Map) =>
    instance
      .getStyle()
      .layers.find(
        (layer) =>
          layer.type === 'line' &&
          'source-layer' in layer &&
          (layer['source-layer'] === 'country_region' ||
            layer['source-layer'] === 'admin_division1')
      )?.id;

  const ensureVisualsLayer = (instance: maplibregl.Map, forceRebuild = false) => {
    if (forceRebuild) {
      if (instance.getLayer('globe-visuals')) {
        instance.removeLayer('globe-visuals');
        visualsLayer = null;
      }
      if (instance.getLayer('globe-daymap')) {
        instance.removeLayer('globe-daymap');
        dayMapLayer = null;
      }
    }

    const enabledLayerNames = getEnabledVisualLayerNames();
    const dayMapEnabled = enabledLayerNames.includes('dayMap');
    const enhancementNames = enabledLayerNames.filter((n) => n !== 'dayMap');

    // Place custom surfaces above Bing's land and ocean fills, but below its
    // administrative boundaries and labels. The Bing style emits water fills
    // after some unrelated vector lines, so a generic first-line anchor would
    // leave the low-zoom ocean covering the day map.
    const bingBoundaryAnchor = getBingBoundaryAnchor(instance);

    if (dayMapEnabled && !instance.getLayer('globe-daymap')) {
      dayMapLayer = new GlobeVisualsLayer(VISUAL_TEXTURE_URLS.low, {
        id: 'globe-daymap',
        enabledLayers: ['dayMap'],
        highResolutionTextureSet: VISUAL_TEXTURE_URLS.high,
        highResolutionPrefetchZoom: VISUAL_TEXTURE_HIGH_RES_PREFETCH_ZOOM,
        highResolutionSwapZoom: VISUAL_TEXTURE_HIGH_RES_SWAP_ZOOM,
        highResolutionReleaseZoom: VISUAL_TEXTURE_HIGH_RES_RELEASE_ZOOM,
        ktx2TranscoderPath: VISUAL_TEXTURE_TRANSCODER_PATH
      });
      dayMapLayer.setSun(a, p);
      dayMapLayer.setMeshVisible('dayMap', true);
      dayMapLayer.setTextureDetail(instance.getZoom(), mode === 'fullscreen');
      instance.addLayer(dayMapLayer, bingBoundaryAnchor);
    } else if (!dayMapEnabled && instance.getLayer('globe-daymap')) {
      instance.removeLayer('globe-daymap');
      dayMapLayer = null;
    }

    // Keep the remaining visual enhancements in the same layer band as the
    // day map, beneath Bing's boundaries and labels.
    if (enhancementNames.length === 0) {
      if (instance.getLayer('globe-visuals')) {
        instance.removeLayer('globe-visuals');
        visualsLayer = null;
      }
      return;
    }

    if (!instance.getLayer('globe-visuals')) {
      visualsLayer = new GlobeVisualsLayer(VISUAL_TEXTURE_URLS.low, {
        enabledLayers: enhancementNames,
        highResolutionTextureSet: VISUAL_TEXTURE_URLS.high,
        highResolutionPrefetchZoom: VISUAL_TEXTURE_HIGH_RES_PREFETCH_ZOOM,
        highResolutionSwapZoom: VISUAL_TEXTURE_HIGH_RES_SWAP_ZOOM,
        highResolutionReleaseZoom: VISUAL_TEXTURE_HIGH_RES_RELEASE_ZOOM,
        ktx2TranscoderPath: VISUAL_TEXTURE_TRANSCODER_PATH
      });
      applyVisualsDevSettings(visualsLayer);
      syncVisualTextureDetail(instance);
      instance.addLayer(visualsLayer, bingBoundaryAnchor);
      return;
    }

    if (visualsLayer) {
      applyVisualsDevSettings(visualsLayer);
      syncVisualTextureDetail(instance);
    }
  };

  const applyFeatureVisibility = (instance: maplibregl.Map) => {
    if (isShopMarkersEnabled()) {
      for (const id of [SHOPS_LAYER_ID, SHOPS_ACTIVE_LAYER_ID, SHOPS_PINNED_LAYER_ID]) {
        setLayerVisibility(instance, id, true);
      }
      setLayerVisibility(
        instance,
        SHOPS_NAME_LAYER_ID,
        mode === 'fullscreen' && labelLayersEnabled
      );
    }
  };

  const applyModeLayers = (instance: maplibregl.Map, currentMode: 'landing' | 'fullscreen') => {
    const allLayers = [SHOPS_NAME_LAYER_ID];
    if (currentMode === 'landing') {
      for (const layerId of allLayers) setLayerVisibility(instance, layerId, false);
      applyFeatureVisibility(instance);
    } else {
      applyFeatureVisibility(instance);
    }
  };

  const ensureMapLayers = (instance: maplibregl.Map, options: EnsureMapLayersOptions = {}) => {
    if (isShopMarkersEnabled() && !instance.getSource(SHOPS_SOURCE_ID)) {
      instance.addSource(SHOPS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    // Globe visual enhancements (clouds + night lights + specular + atmosphere).
    // The day map layer is created immediately; the enhancement layer may be deferred.
    ensureVisualsLayer(instance);
    if (options.deferVisuals && !instance.getLayer('globe-visuals')) {
      scheduleDeferredVisualsLayer(instance);
    }

    if (isShopMarkersEnabled() && !instance.getLayer(SHOPS_LAYER_ID)) {
      instance.addLayer({
        id: SHOPS_LAYER_ID,
        type: 'circle',
        source: SHOPS_SOURCE_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3, 6, 5, 10, 7, 14, 10],
          'circle-color': DENSITY_COLOR_EXPR,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(255,255,255,0.6)',
          'circle-opacity': 0.9
        }
      });
    }

    if (isShopMarkersEnabled() && !instance.getLayer(SHOPS_ACTIVE_LAYER_ID)) {
      instance.addLayer({
        id: SHOPS_ACTIVE_LAYER_ID,
        type: 'circle',
        source: SHOPS_SOURCE_ID,
        filter: ['==', ['get', 'key'], ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5, 6, 8, 10, 11, 14, 15],
          'circle-color': DENSITY_COLOR_EXPR,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255,255,255,0.75)',
          'circle-opacity': 1
        }
      });
    }

    if (isShopMarkersEnabled() && !instance.getLayer(SHOPS_PINNED_LAYER_ID)) {
      instance.addLayer({
        id: SHOPS_PINNED_LAYER_ID,
        type: 'circle',
        source: SHOPS_SOURCE_ID,
        filter: ['==', ['get', 'key'], ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 7, 6, 11, 10, 14, 14, 18],
          'circle-color': DENSITY_COLOR_EXPR,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#fbbf24',
          'circle-opacity': 1
        }
      });
    }

    if (isShopMarkersEnabled() && !instance.getLayer(SHOPS_NAME_LAYER_ID)) {
      instance.addLayer({
        id: SHOPS_NAME_LAYER_ID,
        type: 'symbol',
        source: SHOPS_SOURCE_ID,
        minzoom: 9.5,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'name'],
          'text-font': FONT_STACK,
          'text-size': ['interpolate', ['linear'], ['zoom'], 9.5, 12, 11, 13, 12, 14],
          'text-offset': [0, 1],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 12
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.8)',
          'text-halo-width': 1.2
        }
      });
    }
  };

  let prevMapForSetup: maplibregl.Map | null = null;
  let deferredModeLayersRaf: number | null = null;

  $effect(() => {
    const instance = map;
    if (!instance?.isStyleLoaded()) return;
    if (instance !== prevMapForSetup) {
      prevMapForSetup = instance;
      syncScene(instance);
      ensureMapLayers(instance, { deferVisuals: true });
      untrack(() => applyModeLayers(instance, mode));
      return;
    }
    const currentMode = untrack(() => mode);
    if (deferredModeLayersRaf !== null) cancelAnimationFrame(deferredModeLayersRaf);
    deferredModeLayersRaf = requestAnimationFrame(() => {
      deferredModeLayersRaf = null;
      if (map && map.isStyleLoaded()) {
        applyModeLayers(map, currentMode);
      }
    });
  });

  $effect(() => {
    const instance = map;
    const az = a;
    const po = p;
    if (!instance?.isStyleLoaded()) return;
    instance.setLight({
      anchor: 'map',
      intensity: 0.12,
      position: [1, az, po]
    });
    // Keep the Three.js enhancement layer in sync with MapLibre's sun.
    visualsLayer?.setSun(az, po);
    dayMapLayer?.setSun(az, po);
  });

  $effect(() => {
    const instance = map;
    if (!instance?.isStyleLoaded()) return;
    instance.setSky({ 'atmosphere-blend': getAtmosphereBlend() });
  });

  $effect(() => {
    const cloudShadowOpacity = globeFeatureSettings.visualLayers.cloudShadowOpacity;
    visualsLayer?.setCloudShadowOpacity(cloudShadowOpacity);
  });

  $effect(() => {
    const instance = map;
    if (!instance) return;
    // untrack mode so this effect doesn't re-run on mode changes;
    // setTextureDetail is also called on map move/zoom via syncVisualTextureDetail.
    untrack(() => visualsLayer?.setTextureDetail(instance.getZoom(), mode === 'fullscreen'));
  });

  // ---- Mode transition ----
  // Poll for mode changes via setTimeout instead of $effect to avoid
  // triggering Svelte's expensive synchronous flush cycle when `mode` changes.
  // The poll reads `mode` with `untrack()` so it creates zero reactive deps.
  let prevMode: 'landing' | 'fullscreen' | null = null;
  let modeTransitionRaf: number | null = null;
  let modePollTimer: ReturnType<typeof setTimeout> | null = null;

  const pollMode = () => {
    const currentMode = untrack(() => mode);
    if (prevMode !== null && prevMode !== currentMode) {
      const wasFullscreen = prevMode === 'fullscreen';
      prevMode = currentMode;
      const instance = untrack(() => map);

      if (instance) {
        // All MapLibre work deferred to RAF — zero blocking during Svelte flush
        if (modeTransitionRaf !== null) cancelAnimationFrame(modeTransitionRaf);
        modeTransitionRaf = requestAnimationFrame(() => {
          modeTransitionRaf = null;

          if (currentMode === 'fullscreen') {
            if (visualModeTimer) clearTimeout(visualModeTimer);
            const root = document.getElementById('globe-root');
            const mapEl = document.getElementById('globe-map-container');

            // ── Phase 1: Immediate ──
            // Fade out gradient blur and landing hero content right away.
            root?.classList.add('globe-exiting-landing');
            document.documentElement.classList.add('globe-exiting-landing');

            // ── Phase 2: After delay ──
            // Show sidebar and switch to fullscreen visual mode.
            const SIDEBAR_SHOW_DELAY_MS = 1000;
            visualModeTimer = setTimeout(() => {
              root?.classList.remove('globe-exiting-landing');
              root?.classList.replace('globe-visual-landing', 'globe-visual-fullscreen');
              mapEl?.classList.remove('cursor-pointer', 'landing-mode');
              document.documentElement.classList.remove('globe-exiting-landing');
            }, SIDEBAR_SHOW_DELAY_MS);

            sidebarReady = false;
            setTimeout(() => {
              sidebarReady = true;
            }, SIDEBAR_SHOW_DELAY_MS);
            labelLayersEnabled = false;
            stopAutoRotation();
            flyToWithAnticipatedBasemap(
              instance,
              // FLYTO DURATION (ms) — should match or slightly exceed SIDEBAR_SHOW_DELAY_MS
              { center: [155, 45], zoom: 2, pitch: 0, bearing: 0, duration: 2000, essential: true }
            );
          } else if (currentMode === 'landing') {
            if (visualModeTimer) clearTimeout(visualModeTimer);
            const root = document.getElementById('globe-root');
            const mapEl = document.getElementById('globe-map-container');
            sidebarReady = false;

            // ── Phase 1: Immediate ──
            // Start fading out sidebar immediately.
            root?.classList.add('globe-exiting-fullscreen');

            // ── Phase 2: After delay ──
            // Switch to landing visual mode (sidebar hidden, gradient visible).
            // Synced with hero content in:fade (top bar at 300ms, hero at 400ms).
            // Gradient has 0.4s CSS transition → finishes ~600ms, just as hero appears.
            const LANDING_TRANSITION_DELAY_MS = wasFullscreen ? 200 : 0;
            visualModeTimer = setTimeout(() => {
              root?.classList.remove('globe-exiting-fullscreen');
              root?.classList.replace('globe-visual-fullscreen', 'globe-visual-landing');
              mapEl?.classList.add('cursor-pointer', 'landing-mode');
              if (pinnedShop !== null) pinnedShop = null;
              if (markerHoveredShop !== null) markerHoveredShop = null;
              if (regionFilter.type !== 'world') regionFilter = { type: 'world' };
              if (sidebarOpen) sidebarOpen = false;
              sidebarCollapsed = false;
            }, LANDING_TRANSITION_DELAY_MS);
            labelLayersEnabled = false;
            flyToWithAnticipatedBasemap(
              instance,
              // FLYTO DURATION (ms) for fullscreen→landing
              {
                center: [LANDING_LONGITUDE, LANDING_LATITUDE],
                zoom: LANDING_ZOOM,
                pitch: LANDING_PITCH,
                bearing: LANDING_BEARING,
                duration: wasFullscreen ? 1800 : 0,
                essential: true
              }
            );
            setTimeout(() => startAutoRotation(), wasFullscreen ? 1900 : 100);
          }
        });
      }
    }
    prevMode = untrack(() => mode);
    modePollTimer = setTimeout(pollMode, 100);
  };

  // Start polling in onMount (no reactive deps on mode)
  onMount(() => {
    prevMode = mode;
    // Don't set prevShopData here — let the poll detect the initial value
    // and trigger the first data load.
    // Apply correct visual mode immediately on mount
    const root = document.getElementById('globe-root');
    const mapEl = document.getElementById('globe-map-container');
    if (mode === 'fullscreen') {
      root?.classList.replace('globe-visual-landing', 'globe-visual-fullscreen');
      mapEl?.classList.remove('cursor-pointer', 'landing-mode');
      sidebarReady = true;
      labelLayersEnabled = true;
    }
    modePollTimer = setTimeout(pollMode, 100);
    return () => {
      if (modePollTimer !== null) {
        clearTimeout(modePollTimer);
        modePollTimer = null;
      }
      if (modeTransitionRaf !== null) {
        cancelAnimationFrame(modeTransitionRaf);
        modeTransitionRaf = null;
      }
      if (visualModeTimer !== null) {
        clearTimeout(visualModeTimer);
        visualModeTimer = null;
      }
    };
  });

  let reinitializeGlobe: (() => void) | null = null;

  let lastAppliedStyle: { locale: string; theme: ThemeMode } = {
    locale: getLocale(),
    theme: 'light'
  };

  const reloadBingStyle = async (locale: string, theme: ThemeMode) => {
    const instance = map;
    if (!instance || isMapStyleLoading) return;
    if (lastAppliedStyle.locale === locale && lastAppliedStyle.theme === theme) return;

    isMapStyleLoading = true;
    try {
      const styleUrl = getBingStyleUrl(locale);
      const response = await fetch(styleUrl);
      if (!response.ok) {
        console.warn(`Failed to load Bing style ${styleUrl}: ${response.status}`);
        return;
      }
      let style = fixBingStyleUrls((await response.json()) as maplibregl.StyleSpecification);
      if (theme === 'dark') style = applyBingDarkMode(style);
      // style.glyphs = `${base}/fonts/{fontstack}/{range}.pbf`;
      const center = instance.getCenter();
      const zoom = instance.getZoom();
      const pitch = instance.getPitch();
      const bearing = instance.getBearing();
      lastAppliedStyle = { locale, theme };
      instance.setStyle(style);
      instance.once('style.load', () => {
        instance.jumpTo({ center, zoom, pitch, bearing });
        instance.setProjection({ type: 'globe' });
      });
    } finally {
      isMapStyleLoading = false;
    }
  };

  $effect(() => {
    void currentLocale;
    void currentTheme;
    untrack(() => {
      void reloadBingStyle(currentLocale, currentTheme);
    });
  });

  $effect(() => {
    void globeFeatureSettingsKey;
    untrack(() => reinitializeGlobe?.());
  });

  $effect(() => {
    void globeVisualSettingsKey;
    untrack(() => {
      if (visualsLayer) {
        applyVisualsDevSettings(visualsLayer);
      }
      if (dayMapLayer) {
        dayMapLayer.setSun(a, p);
        dayMapLayer.setMeshVisible('dayMap', globeFeatureSettings.visualLayers.dayMap);
      }
    });
  });

  onMount(() => {
    if (!mapContainer) return;

    syncResponsiveFlags();

    if (sidebarSize.w === undefined) {
      sidebarSize.w = Math.min(400, Math.max(window.innerWidth * 0.3, 280));
    }

    if (sidebarSize.h === undefined) {
      sidebarSize.h = window.innerHeight - sidebarPos.y - sidebarPos.x;
    }
    let cleanupMap: (() => void) | undefined;
    let destroyed = false;

    currentTheme =
      document.documentElement.getAttribute('data-theme') === 'forest' ? 'dark' : 'light';
    const handleThemeChange = (event: Event) => {
      const mode = (event as CustomEvent).detail as ThemeMode;
      if (mode === 'light' || mode === 'dark') currentTheme = mode;
    };
    window.addEventListener('nearcade-theme-change', handleThemeChange);

    // Dev-only FPS monitor and benchmark controls.
    let fpsInterval: number | undefined;
    if (import.meta.env.DEV) {
      const monitor = new FpsMonitor();
      fpsMonitor = monitor;
      monitor.start();
      fpsInterval = window.setInterval(() => {
        if (destroyed) return;
        currentFps = monitor.getCurrentFps();
        avgFps = monitor.getAverageFps();
      }, 500);
    }

    type CameraSnapshot = {
      center: maplibregl.LngLat;
      zoom: number;
      pitch: number;
      bearing: number;
    };

    const initializeMap = async (cameraSnapshot?: CameraSnapshot) => {
      const featureSettingsKey = globeFeatureSettingsKey;

      if (destroyed || !mapContainer || featureSettingsKey !== globeFeatureSettingsKey) return;

      isMapStyleLoading = true;
      const styleUrl = getBingStyleUrl(currentLocale);
      const response = await fetch(styleUrl);
      if (!response.ok) {
        throw new Error(`Failed to load Bing style ${styleUrl}: ${response.status}`);
      }
      let style = fixBingStyleUrls((await response.json()) as maplibregl.StyleSpecification);
      if (currentTheme === 'dark') style = applyBingDarkMode(style);
      // style.glyphs = `${base}/fonts/{fontstack}/{range}.pbf`;
      isMapStyleLoading = false;
      lastAppliedStyle = { locale: currentLocale, theme: currentTheme };
      if (destroyed || !mapContainer || featureSettingsKey !== globeFeatureSettingsKey) return;

      const instance = new maplibregl.Map({
        container: mapContainer,
        style,
        center:
          cameraSnapshot?.center ??
          (mode === 'landing' ? [LANDING_LONGITUDE, LANDING_LATITUDE] : [155, 45]),
        zoom: cameraSnapshot?.zoom ?? (mode === 'landing' ? LANDING_ZOOM : 2),
        pitch: cameraSnapshot?.pitch ?? (mode === 'landing' ? LANDING_PITCH : 0),
        bearing: cameraSnapshot?.bearing ?? (mode === 'landing' ? LANDING_BEARING : 0),
        pixelRatio: getGlobePixelRatio(),
        transformRequest: bingTransformRequest,
        attributionControl: false
      });
      map = instance;

      // Register style.load IMMEDIATEALLY after construction — when passing a
      // style object, MapLibre may fire style.load synchronously during the
      // constructor, so the listener must be registered before any other code.
      const syncStyle = () => {
        visualsLayer = null;
        dayMapLayer = null;
        syncScene(instance);

        ensureMapLayers(instance, { deferVisuals: true });
        applyModeLayers(instance, mode);
        const shopsData = shops;
        if (shopsData) {
          const src = instance.getSource(SHOPS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
          if (src) {
            src.setData({
              type: 'FeatureCollection',
              features: shopsData.map(({ shop, location }) => ({
                type: 'Feature' as const,
                geometry: {
                  type: 'Point' as const,
                  coordinates: [location.longitude, location.latitude]
                },
                properties: {
                  key: getShopKey(shop),
                  density: shop.density,
                  name: shop.name.replace('（', '(').replace('）', ')')
                }
              }))
            });
          }
        }
        const hoverKey = markerHoveredShop ? getShopKey(markerHoveredShop) : '';
        if (instance.getLayer(SHOPS_ACTIVE_LAYER_ID)) {
          instance.setFilter(SHOPS_ACTIVE_LAYER_ID, ['==', ['get', 'key'], hoverKey]);
        }
        const pinnedKey = pinnedShop ? getShopKey(pinnedShop) : '';
        if (instance.getLayer(SHOPS_PINNED_LAYER_ID)) {
          instance.setFilter(SHOPS_PINNED_LAYER_ID, ['==', ['get', 'key'], pinnedKey]);
        }

        // If deferred scheduling was skipped or canceled, force one retry.
        // Wait until the route transition is very likely over before paying the
        // shader-compile / texture-upload cost of the visuals layer.
        window.setTimeout(() => {
          if (destroyed || map !== instance) return;
          if (!instance.getLayer('globe-visuals')) {
            if (instance.isStyleLoaded()) {
              ensureVisualsLayer(instance);
            } else {
              scheduleDeferredVisualsLayer(instance);
            }
          }
        }, 2500);
      };

      // Register style.load immediately after defining syncStyle.
      instance.on('style.load', syncStyle);

      navigationControl = new maplibregl.NavigationControl();
      instance.addControl(navigationControl, 'top-right');
      instance.addControl(new maplibregl.AttributionControl());

      const handleMoveEnd = () => {
        if (mode === 'fullscreen') {
          // Reveal labels only once the camera has settled so glyph loading
          // does not contend with the transition animation.
          labelLayersEnabled = true;
          syncVisualTextureDetail(instance);
          return;
        }
        syncVisualTextureDetail(instance);
      };

      const handleZoom = () => {
        syncVisualTextureDetail(instance);
      };

      let landingDragOccurred = false;

      const handleClick = (event: maplibregl.MapMouseEvent) => {
        if ((event.originalEvent as Event & { _shopHandled?: boolean })._shopHandled) return;

        if (mode === 'landing') {
          if (!landingDragOccurred) void goto(resolve('/globe'));
          return;
        }

        // In shop location pick mode, clicking sets the pending coordinates.
        if (shopLocationPickMode) {
          const { lat, lng } = event.lngLat;
          pendingShopCoords = { lat, lng };
          // Place / move the marker
          if (shopPickMarker) {
            shopPickMarker.setLngLat([lng, lat]);
          } else {
            shopPickMarker = new maplibregl.Marker({ color: '#22c55e' })
              .setLngLat([lng, lat])
              .addTo(instance);
          }
          return;
        }

        pinnedShop = null;
        markerHoveredShop = null;
        regionFilter = { type: 'world' };
      };

      const handleMouseMove = (e: MouseEvent) => {
        cursorPos = { x: e.clientX, y: e.clientY };
      };

      const handleShopMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
        instance.getCanvas().style.cursor = 'pointer';
        if (pinnedShop) return;
        if (e.features && e.features[0]) {
          const key = e.features[0].properties?.key as string | undefined;
          if (key) {
            const entry = shopLookup.get(key);
            if (entry) markerHoveredShop = entry.shop;
          }
        }
      };

      const handleShopMouseLeave = () => {
        instance.getCanvas().style.cursor = '';
        if (!pinnedShop) markerHoveredShop = null;
      };

      const handleShopClick = (e: maplibregl.MapLayerMouseEvent) => {
        if ((e.originalEvent as Event & { _shopHandled?: boolean })._shopHandled) return;
        (e.originalEvent as Event & { _shopHandled?: boolean })._shopHandled = true;
        if (e.features && e.features[0]) {
          const key = e.features[0].properties?.key as string | undefined;
          if (key) {
            const entry = shopLookup.get(key);
            if (entry) {
              if (mode === 'landing') {
                goto(resolve('/globe'));
                return;
              }
              if (pinnedShop && getShopKey(pinnedShop) === key) {
                pinnedShop = null;
                markerHoveredShop = null;
              } else {
                if (!isShopInCurrentFilter(entry.shop)) {
                  searchQuery = '';
                  selectedTitleIds = [];
                }
                applyShopRegionFilter(entry.shop);
                pinShop(entry);
              }
            }
          }
        }
      };

      const handleMouseDown = () => {
        if (mode !== 'landing') return;
        landingDragOccurred = false;
        stopAutoRotation();
      };
      const handleMouseUp = () => {
        if (mode !== 'landing') return;
        startAutoRotation();
      };
      const handleDragStart = () => {
        if (mode === 'landing') landingDragOccurred = true;
      };
      const handleDragEnd = () => {
        if (mode === 'landing') startAutoRotation();
      };

      instance.on('moveend', handleMoveEnd);
      instance.on('zoom', handleZoom);
      instance.on('click', handleClick);
      instance.on('mousedown', handleMouseDown);
      instance.on('mouseup', handleMouseUp);
      instance.on('dragstart', handleDragStart);
      instance.on('dragend', handleDragEnd);
      for (const layerId of [
        SHOPS_LAYER_ID,
        SHOPS_ACTIVE_LAYER_ID,
        SHOPS_PINNED_LAYER_ID,
        SHOPS_NAME_LAYER_ID
      ]) {
        instance.on('mousemove', layerId, handleShopMouseMove);
        instance.on('mouseleave', layerId, handleShopMouseLeave);
        instance.on('click', layerId, handleShopClick);
      }
      window.addEventListener('mousemove', handleMouseMove);

      const handleViewportResize = () => {
        syncResponsiveFlags();
        sidebarPos = clampSidebarPos(sidebarPos.x, sidebarPos.y);
        if (!sidebarCollapsed && sidebarSize.w !== undefined) {
          sidebarSize.w = Math.min(sidebarSize.w, window.innerWidth - sidebarPos.x);
        }
        if (sidebarSize.h !== undefined) {
          sidebarSize.h = Math.min(sidebarSize.h, window.innerHeight - sidebarPos.y);
        }
      };
      const resizeObserver = new ResizeObserver(handleViewportResize);
      resizeObserver.observe(mapContainer);
      window.addEventListener('resize', handleViewportResize);

      if (mode === 'landing') {
        prevMode = 'landing';
        startAutoRotation();
      } else {
        prevMode = 'fullscreen';
      }

      const dispose = () => {
        stopAutoRotation();
        cancelDeferredVisualsLayer();
        instance.off('style.load', syncStyle);
        instance.off('moveend', handleMoveEnd);
        instance.off('zoom', handleZoom);
        instance.off('click', handleClick);
        instance.off('mousedown', handleMouseDown);
        instance.off('mouseup', handleMouseUp);
        instance.off('dragstart', handleDragStart);
        instance.off('dragend', handleDragEnd);
        for (const layerId of [
          SHOPS_LAYER_ID,
          SHOPS_ACTIVE_LAYER_ID,
          SHOPS_PINNED_LAYER_ID,
          SHOPS_NAME_LAYER_ID
        ]) {
          instance.off('mousemove', layerId, handleShopMouseMove);
          instance.off('mouseleave', layerId, handleShopMouseLeave);
          instance.off('click', layerId, handleShopClick);
        }
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('resize', handleViewportResize);
        resizeObserver.disconnect();
        instance.remove();
        navigationControl = null;
        if (map === instance) map = undefined;
      };

      if (destroyed) {
        dispose();
        return;
      }
      cleanupMap = dispose;
    };

    reinitializeGlobe = () => {
      const instance = map;
      const cameraSnapshot = instance
        ? {
            center: instance.getCenter(),
            zoom: instance.getZoom(),
            pitch: instance.getPitch(),
            bearing: instance.getBearing()
          }
        : undefined;
      cleanupMap?.();
      cleanupMap = undefined;
      visualsLayer = null;
      dayMapLayer = null;
      navigationControl = null;
      markerHoveredShop = null;
      pinnedShop = null;
      void initializeMap(cameraSnapshot);
    };

    startBenchmark = () => {
      const instance = map;
      const monitor = fpsMonitor;
      if (!instance || !monitor || benchmarkRunning) return;

      benchmarkRunning = true;
      benchmarkProgress = 0;
      benchmarkResult = null;
      benchmarkAbortController = new AbortController();
      stopAutoRotation();

      void runGlobeBenchmark(instance, {
        fpsMonitor: monitor,
        onProgress: (progress) => {
          benchmarkProgress = progress;
        },
        signal: benchmarkAbortController.signal
      })
        .then((result) => {
          benchmarkResult = result;
        })
        .catch((error: unknown) => {
          console.error('[GlobeBenchmark] failed', error);
        })
        .finally(() => {
          benchmarkRunning = false;
          benchmarkAbortController = null;
          if (!destroyed && fpsMonitor) {
            currentFps = fpsMonitor.getCurrentFps();
            avgFps = fpsMonitor.getAverageFps();
          }
        });
    };

    stopBenchmark = () => {
      benchmarkAbortController?.abort();
      benchmarkAbortController = null;
    };

    reinitializeGlobe();

    const refreshInterval = setInterval(() => {
      viewTime = new Date();

      if (shopData) {
        void invalidate('app:globe-shops');
        return;
      }

      lazyGlobeDataPromise = null;
      globeDataRefreshToken += 1;
    }, 60_000);

    return () => {
      destroyed = true;
      window.removeEventListener('nearcade-theme-change', handleThemeChange);
      reinitializeGlobe = null;
      startBenchmark = null;
      stopBenchmark?.();
      stopBenchmark = null;
      fpsMonitor?.stop();
      fpsMonitor = null;
      clearInterval(fpsInterval);
      if (deferredModeLayersRaf !== null) {
        cancelAnimationFrame(deferredModeLayersRaf);
        deferredModeLayersRaf = null;
      }
      cancelDeferredVisualsLayer();
      cleanupMap?.();
      clearInterval(refreshInterval);
    };
  });
</script>

<!-- ================================================================
     Fixed globe container – always behind page content
     ================================================================ -->
<div
  id="globe-root"
  class="globe-visual-landing pointer-events-none fixed inset-0 z-0 overflow-hidden"
>
  <!-- Map canvas fills entire area -->
  <div
    id="globe-map-container"
    bind:this={mapContainer}
    class="landing-mode pointer-events-auto h-full w-full cursor-pointer"
  ></div>

  <!-- ---- Bottom gradient blur (landing mode only) ---- -->
  <div
    id="globe-bottom-gradient"
    class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[70vh]"
  >
    {#each bottomBlurLayers as layer, index (index)}
      <div
        class="absolute inset-0"
        style="backdrop-filter: blur({layer.blur}px);
               mask-image: linear-gradient(to top, rgba(0,0,0,0) {layer
          .maskStops[0]}%, rgba(0,0,0,1) {layer.maskStops[1]}%, rgba(0,0,0,1) {layer
          .maskStops[2]}%, rgba(0,0,0,0) {layer.maskStops[3]}%);
               -webkit-mask-image: linear-gradient(to top, rgba(0,0,0,0) {layer
          .maskStops[0]}%, rgba(0,0,0,1) {layer.maskStops[1]}%, rgba(0,0,0,1) {layer
          .maskStops[2]}%, rgba(0,0,0,0) {layer.maskStops[3]}%);"
      ></div>
    {/each}
    <!-- Solid bg-base-100 floor occupying the bottom 30 vh -->
    <div class="bg-base-100 absolute inset-x-0 bottom-0 h-[30vh]"></div>
    <!-- Gradient fade from bg-base-100 (bottom) to transparent (top) for the next 40 vh -->
    <div
      class="from-base-100 absolute inset-x-0 bottom-[30vh] h-[40vh] bg-linear-to-t to-transparent"
    ></div>
  </div>

  <!-- ================================================================
       Sidebar (fullscreen mode only)
       Always rendered to avoid DOM teardown/recreation during transitions.
       Hidden via CSS when not in fullscreen mode.
       ================================================================ -->
  {#if mode === 'fullscreen' && sidebarEnabled && sidebarReady}
    <aside
      id="globe-sidebar"
      transition:slide
      class="bg-base-200/70 border-base-300 pointer-events-auto absolute z-20 flex flex-col overflow-hidden border shadow-lg backdrop-blur-xl
             not-md:inset-x-0 not-md:top-auto not-md:bottom-0 not-md:max-h-[65vh] not-md:rounded-t-2xl
             not-md:transition-transform not-md:duration-300 not-md:ease-out not-md:will-change-transform
             md:top-(--globe-sidebar-top) md:left-(--globe-sidebar-left) md:h-(--globe-sidebar-height) md:w-(--globe-sidebar-width) md:rounded-xl md:transition-[width,height] md:duration-300 md:ease-out
             {sidebarCollapsed ? 'md:h-[52px] md:w-[52px]' : ''}
             {sidebarOpen ? 'not-md:translate-y-0' : 'not-md:translate-y-full'}"
      style="{getSidebarCssVars()}; contain: strict"
    >
      <!-- Mobile drag handle -->
      <div class="bg-base-content/20 mx-auto mt-2 mb-1 h-1 w-10 rounded-full md:hidden"></div>

      <!-- Region header – acts as drag handle on desktop -->
      <div
        role="none"
        class="border-base-300 shrink-0 border-b not-md:p-4 md:select-none {sidebarCollapsed
          ? 'md:border-b-0 md:p-2.5'
          : 'md:p-4'}"
        class:md:cursor-grabbing={isDraggingSidebar && !sidebarCollapsed}
        class:md:cursor-grab={!isDraggingSidebar && !sidebarCollapsed}
        onpointerdown={startSidebarDrag}
        onpointermove={moveSidebarDrag}
        onpointerup={stopSidebarDrag}
        style="touch-action: none;"
      >
        <div class="flex flex-row-reverse items-start justify-between gap-2">
          <button
            type="button"
            class="btn btn-circle btn-ghost btn-sm shrink-0 md:hidden"
            aria-label={m.close()}
            onclick={() => (sidebarOpen = false)}
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
          <button
            type="button"
            class="btn btn-circle btn-ghost btn-sm hidden shrink-0 md:inline-flex"
            aria-label={sidebarCollapsed ? m.expand_sidebar() : m.collapse_sidebar()}
            onclick={sidebarCollapsed ? expandSidebar : collapseSidebar}
          >
            <i class="fa-solid {sidebarCollapsed ? 'fa-angles-right' : 'fa-angles-left'}"></i>
          </button>
          <div class="min-w-0" class:md:hidden={sidebarCollapsed}>
            <h2 class="truncate text-2xl font-bold">{regionTitle}</h2>
            {#if regionHierarchy.length > 0}
              <p class="text-base-content/60 mt-0.5 truncate text-sm">
                {regionHierarchy.join(' › ')}
              </p>
            {/if}
          </div>
        </div>
      </div>

      <!-- Content (hidden when collapsed on desktop) -->
      <div class="flex flex-1 flex-col overflow-hidden" class:md:hidden={sidebarCollapsed}>
        <!-- Search + game filters -->
        <div class="border-base-300 border-b p-3">
          <div class="flex gap-2">
            <div class="dropdown">
              <button
                type="button"
                tabindex="0"
                class="btn btn-soft hover:btn-accent transition-colors!"
                class:btn-primary={selectedTitleIds.length > 0}
                aria-label={m.filter_by_game_titles()}
              >
                <i class="fa-solid fa-filter"></i>
                {#if selectedTitleIds.length > 0}
                  <span class="badge badge-xs">{selectedTitleIds.length}</span>
                {/if}
              </button>
              <div
                role="menu"
                tabindex="-1"
                class="card dropdown-content bg-base-200 z-20 mt-2 w-fit shadow-lg"
              >
                <div class="card-body p-4">
                  <h3 class="card-title text-base text-nowrap">{m.filter_by_game_titles()}</h3>
                  <div class="space-y-2">
                    {#each GAME_TITLES as game (game.id)}
                      <label class="flex cursor-pointer items-center gap-2 text-nowrap">
                        <input
                          type="checkbox"
                          class="checkbox checkbox-sm checked:checkbox-success hover:checkbox-accent border-2 transition-colors"
                          checked={selectedTitleIds.includes(game.id)}
                          onchange={() => {
                            selectedTitleIds = selectedTitleIds.includes(game.id)
                              ? selectedTitleIds.filter((id) => id !== game.id)
                              : [...selectedTitleIds, game.id];
                          }}
                        />
                        <span class="text-sm">{getGameName(game.key)}</span>
                      </label>
                    {/each}
                  </div>
                  <div class="card-actions mt-2 justify-end">
                    <button
                      type="button"
                      class="btn btn-soft hover:btn-error btn-xs"
                      onclick={() => {
                        selectedTitleIds = [];
                      }}
                      disabled={selectedTitleIds.length === 0}
                    >
                      <i class="fa-solid fa-trash"></i>
                      {m.clear_filters()}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="relative flex-1">
              <i
                class="fa-solid fa-search text-base-content/40 pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs"
              ></i>
              <input
                type="text"
                bind:value={searchQuery}
                placeholder={m.search_arcades_placeholder()}
                class="input input-bordered w-full pl-7"
              />
            </div>
            <div class="dropdown dropdown-end">
              <button
                type="button"
                tabindex="0"
                class="btn btn-circle btn-soft transition-colors!"
                aria-label={m.more_actions()}
                title={m.more_actions()}
              >
                <i class="fa-solid fa-ellipsis"></i>
              </button>
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <ul
                tabindex="0"
                class="dropdown-content menu bg-base-300 rounded-box z-10 w-56 p-2 shadow"
              >
                <li>
                  <button onclick={enterShopLocationPickMode}>
                    <i class="fa-solid fa-plus"></i>
                    {m.create_shop()}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Shop list -->
        <div class="flex-1 space-y-2 overflow-y-auto p-3">
          {#if !shops}
            <div class="flex justify-center py-8">
              <span class="loading loading-spinner loading-md"></span>
            </div>
          {:else if filteredShops !== null && filteredShops.length === 0}
            <p class="text-base-content/60 py-6 text-center text-sm">{m.no_shops_found()}</p>
          {:else if filteredShops !== null}
            {#if sidebarReady}
              {#each filteredShops.slice(0, visibleCount) as { shop } (`${shop.id}`)}
                {@const cardKey = `${shop.id}`}
                {@const isPinned = pinnedShop ? getShopKey(pinnedShop) === getShopKey(shop) : false}
                <div
                  bind:this={() => cardRefs.get(cardKey), (v) => cardRefs.set(cardKey, v)}
                  class="rounded-xl transition-all {isPinned
                    ? '[&>*:first-child]:not-hover:border-accent/60'
                    : ''}"
                >
                  <ShopCard
                    {shop}
                    interactive
                    mobileButtons
                    onclick={() => {
                      const entry = shopLookup.get(getShopKey(shop));
                      if (entry) pinShop(entry);
                    }}
                  />
                </div>
              {/each}
              {#if filteredShops.length > visibleCount}
                <div bind:this={listSentinelEl} class="flex justify-center py-4">
                  <span class="loading loading-spinner loading-sm"></span>
                </div>
              {/if}
            {:else}
              <div class="flex justify-center py-8">
                <span class="loading loading-spinner loading-md"></span>
              </div>
            {/if}
          {/if}
        </div>

        <!-- Resize handle (desktop only) -->
        <div
          role="separator"
          aria-label="Resize sidebar"
          class="pointer-events-auto absolute right-0 bottom-0 z-30 hidden h-5 w-5 cursor-se-resize opacity-20 transition-opacity hover:opacity-60 md:block"
          style="touch-action: none;"
          onpointerdown={startSidebarResize}
          onpointermove={moveSidebarResize}
          onpointerup={stopSidebarResize}
        >
          <svg viewBox="0 0 10 10" fill="currentColor" class="h-full w-full">
            <path d="M10 0L0 10h10V0z" />
          </svg>
        </div>
      </div>
    </aside>

    <!-- Mobile sidebar toggle -->
    <button
      id="globe-mobile-toggle"
      type="button"
      class="bg-base-200/80 border-base-300 hover:border-success pointer-events-auto absolute bottom-4 left-4 z-10 flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 shadow-lg backdrop-blur-sm transition md:hidden"
      aria-label={regionTitle}
      onclick={() => (sidebarOpen = !sidebarOpen)}
    >
      <i class="fa-solid fa-list text-sm"></i>
      <span class="text-sm font-medium">{regionTitle}</span>
      {#if filteredShops !== null}
        <span class="badge badge-soft badge-primary badge-xs">{filteredShops.length}</span>
      {/if}
    </button>

    <!-- Mobile sidebar backdrop -->
    {#if sidebarOpen}
      <div
        id="globe-mobile-backdrop"
        role="presentation"
        class="pointer-events-auto absolute inset-0 z-15 bg-black/40 md:hidden"
        onclick={() => (sidebarOpen = false)}
      ></div>
    {/if}

    <!-- Desktop: pinned shop interactive card at bottom-right -->
    {#if pinnedShop && !isCompactViewport}
      <div
        id="globe-pinned-card"
        class="pointer-events-auto absolute right-4 bottom-4 z-10 max-w-110 shadow-xl"
      >
        <div class="relative">
          <button
            type="button"
            class="btn btn-circle btn-ghost btn-xs absolute top-2 right-2 z-10"
            aria-label={m.close()}
            onclick={() => {
              pinnedShop = null;
              markerHoveredShop = null;
            }}
          >
            <i class="fa-solid fa-xmark text-xs"></i>
          </button>
          <ShopCard shop={pinnedShop} interactive />
        </div>
      </div>
    {/if}
  {/if}

  {#if markerHoveredShop && !isCoarsePointer}
    <div
      class="pointer-events-none fixed z-50 w-80"
      style="left: {cursorPos.x + 15}px; top: {cursorPos.y + 15}px;"
    >
      <ShopCard shop={markerHoveredShop} />
    </div>
  {/if}

  <!-- ================================================================
       Shop location pick mode overlay
       ================================================================ -->
  {#if shopLocationPickMode}
    <div class="pointer-events-none absolute inset-0 z-30">
      <!-- Instruction banner at the top -->
      <div
        class="bg-base-100/90 border-base-300 pointer-events-auto absolute inset-x-0 top-16 mx-auto flex w-fit max-w-sm items-center gap-3 rounded-xl border
               px-3 py-2 shadow-lg backdrop-blur-sm"
      >
        <i class="fa-solid fa-crosshairs text-success text-lg"></i>
        <p class="text-sm font-medium">{m.shop_pick_location_hint()}</p>
      </div>

      <!-- Confirm / cancel bar at the bottom -->
      <div
        class="bg-base-100/90 border-base-300 pointer-events-auto absolute inset-x-0 bottom-12 mx-auto flex w-fit items-center gap-3 rounded-xl border
               px-3 py-2 shadow-lg backdrop-blur-sm"
      >
        {#if pendingShopCoords}
          <span class="font-mono text-xs opacity-60">
            {pendingShopCoords.lat.toFixed(5)}, {pendingShopCoords.lng.toFixed(5)}
          </span>
        {/if}
        <button
          class="btn btn-success btn-sm"
          disabled={!pendingShopCoords}
          onclick={confirmShopLocation}
        >
          <i class="fa-solid fa-check"></i>
          {m.confirm()}
        </button>
        <button class="btn btn-ghost btn-sm" onclick={exitShopLocationPickMode}>
          <i class="fa-solid fa-xmark"></i>
          {m.cancel()}
        </button>
      </div>
    </div>
  {/if}

  <!-- ================================================================
       Dev panel (DEV mode only)
       ================================================================ -->
  {#if import.meta.env.DEV}
    <div
      id="globe-dev-panel"
      class="bg-base-200/70 pointer-events-auto absolute top-3 z-10 flex max-w-xs min-w-64 flex-col gap-3 rounded-md p-3 text-sm shadow-lg backdrop-blur-sm"
    >
      <p class="text-xs font-semibold tracking-wide uppercase opacity-60">Globe / Time</p>
      <div class="flex flex-col gap-1 px-2">
        <label for="viewtime" class="text-xs leading-none">Time (local)</label>
        <input
          type="datetime-local"
          id="viewtime"
          class="input input-xs w-full"
          value={toDatetimeLocalValue(viewTime)}
          oninput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            if (v) viewTime = new Date(v);
          }}
        />
        <button
          class="btn btn-xs mt-1"
          onclick={() => {
            viewTime = new Date();
          }}>Now</button
        >
      </div>

      <!-- Render layers section -->
      <div class="border-base-content/15 flex flex-col gap-1.5 border-t px-2 pt-2">
        <p class="text-xs font-semibold tracking-wide uppercase opacity-60">Visual layers</p>
        {#snippet layerToggle(
          label: string,
          desc: string,
          checked: boolean,
          onchange: (v: boolean) => void
        )}
          <label class="flex cursor-pointer items-center justify-between gap-3 text-xs">
            <span class="flex flex-col gap-0">
              <span class="font-medium">{label}</span>
              <span class="opacity-50">{desc}</span>
            </span>
            <input
              type="checkbox"
              class="checkbox checkbox-xs checked:checkbox-primary hover:checkbox-accent border-2 transition-colors"
              {checked}
              onchange={(e) => onchange((e.target as HTMLInputElement).checked)}
            />
          </label>
        {/snippet}
        {@render layerToggle(
          'Specular sunlight',
          'Ocean glint shader',
          globeFeatureSettings.visualLayers.specular,
          (v) =>
            updateGlobeFeatureSettings((settings) => ({
              ...settings,
              visualLayers: { ...settings.visualLayers, specular: v }
            }))
        )}
        {@render layerToggle(
          'Night lights',
          'City lights overlay',
          globeFeatureSettings.visualLayers.nightLights,
          (v) =>
            updateGlobeFeatureSettings((settings) => ({
              ...settings,
              visualLayers: { ...settings.visualLayers, nightLights: v }
            }))
        )}
        {@render layerToggle(
          'Atmosphere',
          'Built-in sky + Three.js rim',
          globeFeatureSettings.visualLayers.atmosphere,
          (v) =>
            updateGlobeFeatureSettings((settings) => ({
              ...settings,
              visualLayers: { ...settings.visualLayers, atmosphere: v }
            }))
        )}
        {@render layerToggle(
          'Clouds',
          'Cloud texture overlay',
          globeFeatureSettings.visualLayers.clouds,
          (v) =>
            updateGlobeFeatureSettings((settings) => ({
              ...settings,
              visualLayers: { ...settings.visualLayers, clouds: v }
            }))
        )}
        {@render layerToggle(
          'Cloud shadows',
          'Sun-cast cloud shadows',
          globeFeatureSettings.visualLayers.cloudShadows,
          (v) =>
            updateGlobeFeatureSettings((settings) => ({
              ...settings,
              visualLayers: { ...settings.visualLayers, cloudShadows: v }
            }))
        )}
        {#if globeFeatureSettings.visualLayers.cloudShadows}
          <label class="flex flex-col gap-1 pl-3 text-xs">
            <span class="flex items-center justify-between">
              <span class="opacity-70">Shadow opacity</span>
              <span class="font-mono opacity-70"
                >{globeFeatureSettings.visualLayers.cloudShadowOpacity.toFixed(2)}</span
              >
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              class="range range-xs"
              value={globeFeatureSettings.visualLayers.cloudShadowOpacity}
              oninput={(e) => {
                const cloudShadowOpacity = Number((e.target as HTMLInputElement).value);
                updateGlobeFeatureSettings((settings) => ({
                  ...settings,
                  visualLayers: { ...settings.visualLayers, cloudShadowOpacity }
                }));
              }}
            />
          </label>
        {/if}
        {@render layerToggle(
          'Day map',
          'Daytime surface texture',
          globeFeatureSettings.visualLayers.dayMap,
          (v) =>
            updateGlobeFeatureSettings((settings) => ({
              ...settings,
              visualLayers: { ...settings.visualLayers, dayMap: v }
            }))
        )}
      </div>

      <!-- Map overlays section -->
      <div class="border-base-content/15 flex flex-col gap-1.5 border-t px-2 pt-2">
        <p class="text-xs font-semibold tracking-wide uppercase opacity-60">Map overlays</p>
        <label class="flex cursor-pointer items-center justify-between gap-3 text-xs">
          <span class="flex flex-col gap-0">
            <span class="font-medium">Shop markers</span>
            <span class="opacity-50">Circle markers and name labels</span>
          </span>
          <input
            type="checkbox"
            class="checkbox checkbox-xs checked:checkbox-primary hover:checkbox-accent border-2 transition-colors"
            checked={globeFeatureSettings.mapOverlays.shopMarkers}
            onchange={(e) => {
              const shopMarkers = (e.target as HTMLInputElement).checked;
              updateGlobeFeatureSettings((settings) => ({
                ...settings,
                mapOverlays: { ...settings.mapOverlays, shopMarkers }
              }));
            }}
          />
        </label>

        <label class="flex cursor-pointer items-center justify-between gap-3 text-xs">
          <span class="flex flex-col gap-0">
            <span class="font-medium">Sidebar</span>
            <span class="opacity-50">Shop list panel (disable to test transition perf)</span>
          </span>
          <input
            type="checkbox"
            class="checkbox checkbox-xs checked:checkbox-primary hover:checkbox-accent border-2 transition-colors"
            checked={sidebarEnabled}
            onchange={(e) => {
              sidebarEnabled = (e.target as HTMLInputElement).checked;
            }}
          />
        </label>
      </div>

      <!-- Performance section -->
      <div class="border-base-content/15 flex flex-col gap-2 border-t px-2 pt-2 text-xs">
        <p class="text-xs font-semibold tracking-wide uppercase opacity-60">Performance</p>
        <div class="grid grid-cols-2 gap-1 font-mono">
          <div class="opacity-70">FPS</div>
          <div class="text-right">{currentFps.toFixed(1)}</div>
          <div class="opacity-70">Avg FPS</div>
          <div class="text-right">{avgFps.toFixed(1)}</div>
        </div>

        <button
          class="btn btn-xs {benchmarkRunning ? 'btn-error' : 'btn-primary'}"
          disabled={!fpsMonitor}
          onclick={() => (benchmarkRunning ? stopBenchmark?.() : startBenchmark?.())}
        >
          {#if benchmarkRunning}
            <i class="fa-solid fa-stop"></i> Stop benchmark
          {:else}
            <i class="fa-solid fa-play"></i> Run benchmark
          {/if}
        </button>

        {#if benchmarkRunning}
          <div class="flex flex-col gap-1">
            <div class="flex justify-between opacity-70">
              <span>Running…</span>
              <span>{(benchmarkProgress * 100).toFixed(0)}%</span>
            </div>
            <progress class="progress progress-primary w-full" value={benchmarkProgress} max="1"
            ></progress>
          </div>
        {/if}

        {#if benchmarkResult}
          <div class="bg-base-100/50 grid grid-cols-2 gap-1 rounded p-2 font-mono">
            <div class="opacity-70">Duration</div>
            <div class="text-right">{(benchmarkResult.durationMs / 1000).toFixed(1)}s</div>
            <div class="opacity-70">Frames</div>
            <div class="text-right">{benchmarkResult.frameCount}</div>
            <div class="opacity-70">Avg FPS</div>
            <div class="text-right">{benchmarkResult.avgFps.toFixed(1)}</div>
            <div class="opacity-70">Min FPS</div>
            <div class="text-right">{benchmarkResult.minFps.toFixed(1)}</div>
            <div class="opacity-70">1% low</div>
            <div class="text-right">{benchmarkResult.p1LowFps.toFixed(1)}</div>
            <div class="opacity-70">Dropped</div>
            <div class="text-right">{benchmarkResult.droppedFrames}</div>
            <div class="opacity-70">Stutters</div>
            <div class="text-right">{benchmarkResult.stutters}</div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- Safelist for Tailwind dynamic density colors (referenced by ShopCard) -->
<div class="hidden">
  <div class="border-green-500 bg-green-500/20 text-green-500"></div>
  <div class="border-yellow-500 bg-yellow-500/20 text-yellow-500"></div>
  <div class="border-orange-500 bg-orange-500/20 text-orange-500"></div>
  <div class="border-red-500 bg-red-500/20 text-red-500"></div>
  <div class="border-gray-500 bg-gray-500/20 text-gray-500"></div>
</div>

<style>
  :global(.maplibregl-ctrl-top-right) {
    top: 3.6rem;
    transition: opacity 0.3s ease;
  }
  :global(.landing-mode .maplibregl-ctrl-top-right) {
    opacity: 0;
    pointer-events: none;
  }

  /* ── Transition phases ──
     Phase 1 (globe-exiting-landing): Fade out gradient + hero content immediately.
     Phase 2 (globe-visual-fullscreen): Show sidebar after delay.
     Phase 1 (globe-exiting-fullscreen): Fade out sidebar immediately.
     Phase 2 (globe-visual-landing): Show gradient + hero after delay. */

  /* Sidebar + pinned card + mobile toggle */
  /* Sidebar uses Svelte's transition:slide — no CSS transition needed. */
  :global(#globe-mobile-toggle),
  :global(#globe-mobile-backdrop),
  :global(#globe-pinned-card) {
    transition: opacity 0.3s ease;
  }
  :global(.globe-visual-landing #globe-mobile-toggle),
  :global(.globe-visual-landing #globe-mobile-backdrop),
  :global(.globe-visual-landing #globe-pinned-card) {
    opacity: 0;
    pointer-events: none;
  }
  :global(.globe-exiting-fullscreen #globe-mobile-toggle),
  :global(.globe-exiting-fullscreen #globe-mobile-backdrop),
  :global(.globe-exiting-fullscreen #globe-pinned-card) {
    opacity: 0;
    pointer-events: none;
  }

  /* Bottom gradient — fades out when exiting landing */
  :global(#globe-bottom-gradient) {
    transition: opacity 0.4s ease;
  }
  :global(.globe-visual-landing #globe-bottom-gradient) {
    opacity: 1;
  }
  :global(.globe-visual-fullscreen #globe-bottom-gradient) {
    opacity: 0;
  }
  :global(.globe-exiting-landing #globe-bottom-gradient) {
    opacity: 0;
  }

  /* Dev panel position */
  :global(.globe-visual-landing #globe-dev-panel) {
    left: 0.75rem;
  }
  :global(.globe-visual-fullscreen #globe-dev-panel) {
    top: 4rem;
    right: 3rem;
    left: auto;
  }
  :global(.globe-visual-fullscreen #globe-map-container) {
    cursor: default;
  }

  /* Navbar + footer fade out when navigating globe → landing */
  :global(.globe-navbar-wrap),
  :global(.globe-footer-wrap) {
    transition: opacity 0.3s ease;
  }
  :global(html.globe-exiting-to-landing .globe-navbar-wrap),
  :global(html.globe-exiting-to-landing .globe-footer-wrap) {
    opacity: 0;
  }
</style>
