<script lang="ts">
  import { base, resolve } from '$app/paths';
  import { goto, invalidate } from '$app/navigation';
  import { onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { SvelteMap } from 'svelte/reactivity';
  import { m } from '$lib/paraglide/messages';
  import ShopCard from '$lib/components/ShopCard.svelte';
  import { getShopOpeningHours, isTouchscreen, getGameName, getAddressParts } from '$lib/utils';
  import { GAMES } from '$lib/constants';
  import type { Shop, ShopWithExtras } from '$lib/types';
  import {
    emptyGlobeFeatureCollection,
    filterCitiesByProvince,
    getCountyParentAdcode,
    getFeatureBounds,
    isChinaWorldFeature,
    type GlobeDataset,
    type GlobeFeature,
    type GlobeFeatureCollection
  } from '$lib/utils/globe/geojson';
  import { fade, slide } from 'svelte/transition';
  import { PUBLIC_MAPTILER_KEY } from '$env/static/public';
  import { GlobeVisualsLayer, DEFAULT_CLOUD_SHADOW_OPACITY } from '$lib/utils/globe/visuals';

  // ---- Props ----
  type Props = {
    mode: 'landing' | 'fullscreen';
    shopData: Promise<Shop[]>;
    attendanceData: Promise<Map<string, { gameId: number; total: number }[]>>;
  };
  let { mode, shopData, attendanceData }: Props = $props();

  // ---- Globe layer/source IDs ----
  const GEOJSON_ENDPOINT = `${base}/api/globe/geojson`;
  const COUNTRY_ZOOM_THRESHOLD = 3.5;
  const PROVINCE_ZOOM_THRESHOLD = 4.6;
  const CITY_ZOOM_THRESHOLD = 6.2;
  const COUNTY_ZOOM_THRESHOLD = 7.4;
  const WORLD_SOURCE_ID = 'world-boundaries';
  const PROVINCE_SOURCE_ID = 'china-province-boundaries';
  const CITY_SOURCE_ID = 'china-city-boundaries';
  const COUNTY_SOURCE_ID = 'china-county-boundaries';
  const HOVER_SOURCE_ID = 'boundary-hover';
  const SHOPS_SOURCE_ID = 'shops';
  const SHOPS_LAYER_ID = 'shops-circles';
  const SHOPS_ACTIVE_LAYER_ID = 'shops-circles-active';
  const SHOPS_PINNED_LAYER_ID = 'shops-circles-pinned';
  const SHOPS_NAME_LAYER_ID = 'shops-names';
  const AMAP_SOURCE_ID = 'amap-satellite';
  const AMAP_LAYER_ID = 'amap-satellite-layer';
  const AMAP_ZOOM_THRESHOLD = 9.8;
  const WORLD_FILL_LAYER_ID = 'world-boundary-fill';
  const WORLD_LINE_LAYER_ID = 'world-boundary-line';
  const WORLD_LABEL_LAYER_ID = 'world-boundary-label';
  const PROVINCE_FILL_LAYER_ID = 'china-province-fill';
  const PROVINCE_LINE_LAYER_ID = 'china-province-line';
  const PROVINCE_LABEL_LAYER_ID = 'china-province-label';
  const CITY_FILL_LAYER_ID = 'china-city-fill';
  const CITY_LINE_LAYER_ID = 'china-city-line';
  const CITY_LABEL_LAYER_ID = 'china-city-label';
  const COUNTY_FILL_LAYER_ID = 'china-county-fill';
  const COUNTY_LINE_LAYER_ID = 'china-county-line';
  const COUNTY_LABEL_LAYER_ID = 'china-county-label';
  const HOVER_LINE_LAYER_ID = 'boundary-hover-line';
  const FONT_STACK = ['Sora Regular', 'Noto Sans CJK SC Regular'];

  const LANDING_ZOOM = 3.2;
  const LANDING_PITCH = 15;
  const LANDING_BEARING = 10 + Math.random() * 10;
  const LANDING_ROTATION_SPEED = 0.06; // degrees per second
  const LANDING_LONGITUDE = 80; // starting longitude
  const LANDING_LATITUDE = 15; // starting latitude

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
  let visualsLayer: GlobeVisualsLayer | null = null;
  let worldData = $state<GlobeFeatureCollection>(emptyGlobeFeatureCollection());
  let provinceData = $state<GlobeFeatureCollection>(emptyGlobeFeatureCollection());
  let cityData = $state<GlobeFeatureCollection>(emptyGlobeFeatureCollection());
  let countyData = $state<GlobeFeatureCollection>(emptyGlobeFeatureCollection());
  let hoveredFeature = $state<GlobeFeature | null>(null);
  let hoveredFeatureId = $state<string | null>(null);
  let geojsonStatus = $state<'loading' | 'ready' | 'error'>('loading');
  let countyStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let geojsonError = $state<string | null>(null);
  let chinaActive = $state(false);
  let activeProvinceAdcode = $state<string | null>(null);
  let activeCityAdcode = $state<string | null>(null);
  let viewZoom = $state(1.5);
  let viewTime = $state(new Date());

  // ---- Dev panel toggles (DEV mode only) ----
  let devSpecularEnabled = $state(true);
  let devNightLightsEnabled = $state(true);
  let devAtmosphereEnabled = $state(true);
  let devCloudsEnabled = $state(true);
  let devCloudShadowsEnabled = $state(true);
  let devCloudShadowOpacity = $state(DEFAULT_CLOUD_SHADOW_OPACITY);
  let devShopMarkersEnabled = $state(true);
  let devGeoJsonEnabled = $state(true);

  // ---- Auto-rotation ----
  let animationFrameId: number | null = null;
  let lastFrameTime = 0;

  const startAutoRotation = () => {
    if (animationFrameId !== null) return;
    lastFrameTime = performance.now();
    const rotate = (timestamp: number) => {
      const instance = map;
      if (!instance || mode !== 'landing') {
        animationFrameId = null;
        return;
      }
      const dt = (timestamp - lastFrameTime) / 1000;
      lastFrameTime = timestamp;
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
    shop: ShopWithExtras;
    location: { latitude: number; longitude: number };
  };

  let shopDataResolved = $state<Shop[]>([]);
  let attendanceDataResolved = new SvelteMap<string, { gameId: number; total: number }[]>();
  let shops = $state<ShopEntry[] | null>(null);
  const shopLookup = new SvelteMap<string, ShopEntry>();

  const getShopKey = (shop: Pick<Shop, 'source' | 'id'>) => `${shop.source}-${shop.id}`;

  // ---- Pinned / hover shop state ----
  let markerHoveredShop = $state<ShopWithExtras | null>(null);
  let pinnedShop = $state<ShopWithExtras | null>(null);

  let cursorPos = $state({ x: 0, y: 0 });
  const COMPACT_VIEWPORT_MEDIA_QUERY = '(max-width: 47.999rem)';
  let isCompactViewport = $state(false);
  let isCoarsePointer = $state(false);
  let now = $state(new Date());

  // ---- Sidebar state ----
  let sidebarOpen = $state(false);
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

  const PAGE_SIZE = 40;
  let visibleCount = $state(PAGE_SIZE);
  let listSentinelEl = $state<HTMLDivElement | undefined>();

  $effect(() => {
    const _len = filteredShops?.length ?? 0;
    void _len;
    visibleCount = PAGE_SIZE;
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
    | { type: 'china' }
    | { type: 'china-province'; name: string }
    | { type: 'china-city'; provinceName: string; cityName: string }
    | { type: 'china-county'; provinceName: string; cityName: string; countyName: string };

  let regionFilter = $state<RegionFilter>({ type: 'world' });

  const regionTitle = $derived.by(() => {
    switch (regionFilter.type) {
      case 'world':
        return m.world();
      case 'address':
        return regionFilter.address[regionFilter.address.length - 1];
      case 'china':
        return '中国';
      case 'china-province':
        return regionFilter.name;
      case 'china-city':
        return regionFilter.cityName;
      case 'china-county':
        return regionFilter.countyName;
    }
  });

  const regionHierarchy = $derived.by((): string[] => {
    switch (regionFilter.type) {
      case 'world':
        return [];
      case 'address':
        return getAddressParts(regionFilter.address).slice(0, -1);
      case 'china':
        return [];
      case 'china-province':
        return ['中国'];
      case 'china-city':
        return ['中国', regionFilter.provinceName];
      case 'china-county':
        return ['中国', regionFilter.provinceName, regionFilter.cityName];
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
        case 'china':
          matchesRegion = general[0] === '中国';
          break;
        case 'china-province':
          matchesRegion = general[0] === '中国' && general[1] === regionFilter.name;
          break;
        case 'china-city':
          matchesRegion =
            general[0] === '中国' &&
            general[1] === regionFilter.provinceName &&
            general[2] === regionFilter.cityName;
          break;
        case 'china-county':
          matchesRegion =
            general[0] === '中国' &&
            general[1] === regionFilter.provinceName &&
            general[2] === regionFilter.cityName &&
            general[3] === regionFilter.countyName;
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
        if (!selectedTitleIds.every((tid) => shop.games.some((g) => g.titleId === tid)))
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
    shopData.then((resolved) => {
      shopDataResolved = resolved;
    });
    attendanceData.then((resolved) => {
      attendanceDataResolved.clear();
      for (const [k, v] of resolved) attendanceDataResolved.set(k, v);
    });
  });

  const getShopDensity = (shop: Omit<ShopWithExtras, 'density'>): number => {
    const oh = shop.openingHoursParsed;
    if (!oh || now < oh.openTolerated || now > oh.closeTolerated) return 0;
    const density = shop.games
      .reduce((acc, game) => {
        if (acc.has(game.titleId)) {
          acc.get(game.titleId)!.push(game);
        } else {
          acc.set(game.titleId, [game]);
        }
        return acc;
      }, new Map<number, typeof shop.games>())
      .entries()
      .map(([, games]) => {
        const attendances = shop.attendances.reduce((sum, att) => {
          if (games.find((g) => g.gameId === att.gameId)) return sum + att.total;
          return sum;
        }, 0);
        const positions =
          games.reduce((sum, g) => sum + g.quantity, 0) *
          (GAMES.find((game) => game.id === games[0].titleId)?.seats || 1);
        return attendances / positions;
      })
      .reduce((max, curr) => (isNaN(curr) ? max : Math.max(max, curr)), 0);
    if (!isFinite(density) || isNaN(density)) return 0;
    switch (true) {
      case density < 0.1:
        return 1;
      case density < 1:
        return 2;
      case density < 2:
        return 3;
      default:
        return 4;
    }
  };

  $effect(() => {
    if (!shopDataResolved.length) return;
    const att = attendanceDataResolved;
    const nextShops = shopDataResolved.map((shop) => {
      const attendances = att.get(getShopKey(shop)) ?? [];
      const openingHoursParsed = getShopOpeningHours(shop);
      const currentAttendance = attendances.reduce((s, a) => s + a.total, 0);
      const shopBase = { ...shop, attendances, openingHoursParsed, currentAttendance, density: 0 };
      return {
        shop: { ...shopBase, density: getShopDensity(shopBase) },
        location: {
          latitude: shop.location.coordinates[1],
          longitude: shop.location.coordinates[0]
        }
      };
    });
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

  const flyToShop = (entry: ShopEntry) => {
    const instance = map;
    if (!instance) return;
    instance.flyTo({
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

  const applyShopRegionFilter = (shop: ShopWithExtras) => {
    const general = shop.address.general;
    if (!general.length) {
      regionFilter = { type: 'world' };
      return;
    }
    regionFilter = { type: 'address', address: general };
  };

  const isShopInCurrentFilter = (shop: ShopWithExtras): boolean => {
    const fs = filteredShops;
    if (!fs) return false;
    const key = getShopKey(shop);
    return fs.some(({ shop: s }) => getShopKey(s) === key);
  };

  // ---- Floating sidebar drag / resize (desktop) ----
  const clampSidebarPos = (x: number, y: number) => ({
    x: Math.max(0, Math.min(window.innerWidth - sidebarSize.w!, x)),
    y: Math.max(0, Math.min(window.innerHeight - 60, y))
  });

  const startSidebarDrag = (e: PointerEvent) => {
    if (isCompactViewport) return;
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

  const mapStyle = `https://api.maptiler.com/maps/satellite-v4/style.json?key=${PUBLIC_MAPTILER_KEY}`;
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
  const countyCache: Record<string, GlobeFeatureCollection> = {};
  const emptyData = emptyGlobeFeatureCollection();
  const sourceDataRevisions = new SvelteMap<string, GlobeFeatureCollection>();
  const GEOJSON_VISIBILITY_LAYER_IDS = [
    WORLD_FILL_LAYER_ID,
    WORLD_LINE_LAYER_ID,
    WORLD_LABEL_LAYER_ID,
    PROVINCE_FILL_LAYER_ID,
    PROVINCE_LINE_LAYER_ID,
    PROVINCE_LABEL_LAYER_ID,
    CITY_FILL_LAYER_ID,
    CITY_LINE_LAYER_ID,
    CITY_LABEL_LAYER_ID,
    COUNTY_FILL_LAYER_ID,
    COUNTY_LINE_LAYER_ID,
    COUNTY_LABEL_LAYER_ID,
    HOVER_LINE_LAYER_ID
  ] as const;
  const SHOP_VISIBILITY_LAYER_IDS = [
    SHOPS_LAYER_ID,
    SHOPS_ACTIVE_LAYER_ID,
    SHOPS_PINNED_LAYER_ID,
    SHOPS_NAME_LAYER_ID
  ] as const;

  const sunPosition = $derived.by(() => {
    const { azimuthDeg, polarDeg } = getSunPosition(viewTime);
    return { azimuth: azimuthDeg, polar: polarDeg };
  });

  const a = $derived(sunPosition.azimuth);
  const p = $derived(sunPosition.polar);

  const visibleCityData = $derived.by(() => {
    if (!activeProvinceAdcode) return emptyData;
    return filterCitiesByProvince(cityData, activeProvinceAdcode);
  });

  const activeProvinceName = $derived.by(
    () =>
      provinceData.features.find(
        (feature: GlobeFeature) => feature.properties?.adcode === activeProvinceAdcode
      )?.properties?.name ?? null
  );

  const activeCityName = $derived.by(
    () =>
      visibleCityData.features.find(
        (feature: GlobeFeature) => feature.properties?.adcode === activeCityAdcode
      )?.properties?.name ?? null
  );

  const currentDetailLevel = $derived.by(() => {
    if (countyData.features.length > 0 && viewZoom >= COUNTY_ZOOM_THRESHOLD) return 'Counties';
    if (visibleCityData.features.length > 0 && viewZoom >= CITY_ZOOM_THRESHOLD) return 'Cities';
    if (chinaActive) return 'Provinces';
    return 'World';
  });

  const focusPath = $derived.by(() => {
    const parts = ['World'];
    if (chinaActive) parts.push('China');
    if (activeProvinceName) parts.push(activeProvinceName);
    if (activeCityName) parts.push(activeCityName);
    return parts.join(' / ');
  });

  const hoveredLabel = $derived.by(() =>
    hoveredFeature?.properties
      ? `${hoveredFeature.properties.name} (${hoveredFeature.properties.level})`
      : null
  );

  const syncScene = (instance: maplibregl.Map, azimuth = a, polar = p) => {
    instance.setProjection({ type: 'globe' });
    instance.setLight({
      anchor: 'map',
      intensity: 0.12,
      position: [1, azimuth, polar]
    });
    instance.setSky({ 'atmosphere-blend': atmosphereBlend });
    instance.setGlyphs(`${base}/fonts/{fontstack}/{range}.pbf`);
  };

  const toDatetimeLocalValue = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const buildGeoJsonUrl = (dataset: GlobeDataset, parentAdcode?: string) => {
    const query = parentAdcode
      ? `dataset=${encodeURIComponent(dataset)}&parentAdcode=${encodeURIComponent(parentAdcode)}`
      : `dataset=${encodeURIComponent(dataset)}`;
    return `${GEOJSON_ENDPOINT}?${query}`;
  };

  const fetchGeoJson = async (dataset: GlobeDataset, parentAdcode?: string) => {
    const response = await fetch(buildGeoJsonUrl(dataset, parentAdcode));
    if (!response.ok) throw new Error(`Failed to load ${dataset}`);
    return (await response.json()) as GlobeFeatureCollection;
  };

  const getGeoJsonSource = (instance: maplibregl.Map, sourceId: string) =>
    instance.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;

  const upsertGeoJsonSource = (
    instance: maplibregl.Map,
    sourceId: string,
    data: GlobeFeatureCollection
  ) => {
    const source = getGeoJsonSource(instance, sourceId);
    if (!source) {
      instance.addSource(sourceId, { type: 'geojson', data, generateId: true });
      sourceDataRevisions.set(sourceId, data);
      return;
    }
    if (sourceDataRevisions.get(sourceId) === data) return;
    sourceDataRevisions.set(sourceId, data);
    try {
      source.setData(data);
    } catch (e) {
      console.error(e);
      sourceDataRevisions.delete(sourceId);
    }
  };

  const setLayerVisibility = (instance: maplibregl.Map, layerId: string, visible: boolean) => {
    if (instance.getLayer(layerId)) {
      instance.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  };

  const applyVisualsDevSettings = (layer: GlobeVisualsLayer) => {
    layer.setSun(a, p);
    layer.setMeshVisible('specular', devSpecularEnabled);
    layer.setMeshVisible('nightLights', devNightLightsEnabled);
    layer.setMeshVisible('atmosphere', devAtmosphereEnabled);
    layer.setMeshVisible('clouds', devCloudsEnabled);
    layer.setMeshVisible('cloudShadow', devCloudShadowsEnabled);
    layer.setCloudShadowOpacity(devCloudShadowOpacity);
  };

  const ensureVisualsLayer = (instance: maplibregl.Map, forceRebuild = false) => {
    if (forceRebuild && instance.getLayer('globe-visuals')) {
      instance.removeLayer('globe-visuals');
      visualsLayer = null;
    }

    if (!instance.getLayer('globe-visuals')) {
      visualsLayer = new GlobeVisualsLayer(
        `${base}/globe/clouds.jpg`,
        `${base}/globe/nightlights.jpg`,
        `${base}/globe/specular_map.jpg`,
        `${base}/globe/normal_map.jpg`
      );
      applyVisualsDevSettings(visualsLayer);
      const beforeId = instance.getLayer(WORLD_FILL_LAYER_ID) ? WORLD_FILL_LAYER_ID : undefined;
      instance.addLayer(visualsLayer, beforeId);
      return;
    }

    if (visualsLayer) applyVisualsDevSettings(visualsLayer);
  };

  const applyDevPanelOverrides = (instance: maplibregl.Map) => {
    if (!devGeoJsonEnabled) {
      for (const id of GEOJSON_VISIBILITY_LAYER_IDS) setLayerVisibility(instance, id, false);
    }

    if (devShopMarkersEnabled) {
      for (const id of [SHOPS_LAYER_ID, SHOPS_ACTIVE_LAYER_ID, SHOPS_PINNED_LAYER_ID]) {
        setLayerVisibility(instance, id, true);
      }
      setLayerVisibility(instance, SHOPS_NAME_LAYER_ID, mode === 'fullscreen');
    } else {
      for (const id of SHOP_VISIBILITY_LAYER_IDS) setLayerVisibility(instance, id, false);
    }
  };

  const applyModeLayers = (instance: maplibregl.Map, currentMode: 'landing' | 'fullscreen') => {
    const allLayers = [
      WORLD_FILL_LAYER_ID,
      WORLD_LINE_LAYER_ID,
      WORLD_LABEL_LAYER_ID,
      PROVINCE_FILL_LAYER_ID,
      PROVINCE_LINE_LAYER_ID,
      PROVINCE_LABEL_LAYER_ID,
      CITY_FILL_LAYER_ID,
      CITY_LINE_LAYER_ID,
      CITY_LABEL_LAYER_ID,
      COUNTY_FILL_LAYER_ID,
      COUNTY_LINE_LAYER_ID,
      COUNTY_LABEL_LAYER_ID,
      HOVER_LINE_LAYER_ID,
      SHOPS_NAME_LAYER_ID
    ];
    if (currentMode === 'landing') {
      for (const layerId of allLayers) setLayerVisibility(instance, layerId, false);
      applyDevPanelOverrides(instance);
    } else {
      syncMapData(instance);
    }
  };

  const ensureMapLayers = (instance: maplibregl.Map) => {
    upsertGeoJsonSource(instance, WORLD_SOURCE_ID, worldData);
    upsertGeoJsonSource(instance, PROVINCE_SOURCE_ID, provinceData);
    upsertGeoJsonSource(instance, CITY_SOURCE_ID, visibleCityData);
    upsertGeoJsonSource(instance, COUNTY_SOURCE_ID, countyData);
    upsertGeoJsonSource(instance, HOVER_SOURCE_ID, emptyGlobeFeatureCollection());

    if (!instance.getSource(AMAP_SOURCE_ID)) {
      instance.addSource(AMAP_SOURCE_ID, {
        type: 'raster',
        tiles: [
          'https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
          'https://webst02.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
          'https://webst03.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
          'https://webst04.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}'
        ],
        tileSize: 256
      });
    }
    if (!instance.getLayer(AMAP_LAYER_ID)) {
      instance.addLayer({
        id: AMAP_LAYER_ID,
        type: 'raster',
        source: AMAP_SOURCE_ID,
        layout: { visibility: 'none' }
      });
    }

    if (!instance.getSource(SHOPS_SOURCE_ID)) {
      instance.addSource(SHOPS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    // Globe visual enhancements (clouds + night lights + specular + atmosphere).
    // Inserted below the boundary fill layers so effects appear under country overlays.
    ensureVisualsLayer(instance);

    if (!instance.getLayer(WORLD_FILL_LAYER_ID)) {
      instance.addLayer({
        id: WORLD_FILL_LAYER_ID,
        type: 'fill',
        source: WORLD_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'hovered'], false],
            'rgba(255,255,255,0.18)',
            ['case', ['boolean', ['get', 'isChina'], false], '#3394cc', '#020617']
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hovered'], false],
            0.55,
            ['case', ['boolean', ['get', 'isChina'], false], 0.09, 0.06]
          ]
        }
      });
    }

    if (!instance.getLayer(WORLD_LINE_LAYER_ID)) {
      instance.addLayer({
        id: WORLD_LINE_LAYER_ID,
        type: 'line',
        source: WORLD_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'line-color': 'rgba(226, 232, 240, 0.55)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 5, 1.2]
        }
      });
    }

    if (!instance.getLayer(WORLD_LABEL_LAYER_ID)) {
      instance.addLayer({
        id: WORLD_LABEL_LAYER_ID,
        type: 'symbol',
        source: WORLD_SOURCE_ID,
        minzoom: COUNTRY_ZOOM_THRESHOLD,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'label'],
          'text-font': FONT_STACK,
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 3, 11, 5, 12],
          'text-max-width': 8,
          'text-variable-anchor': ['center', 'top', 'bottom'],
          'text-radial-offset': 0.35,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'symbol-avoid-edges': true,
          'symbol-sort-key': ['get', 'featureId']
        },
        paint: {
          'text-color': '#f8fafc',
          'text-halo-color': 'rgba(2, 6, 23, 0.95)',
          'text-halo-width': 1.2
        }
      });
    }

    if (!instance.getLayer(PROVINCE_FILL_LAYER_ID)) {
      instance.addLayer({
        id: PROVINCE_FILL_LAYER_ID,
        type: 'fill',
        source: PROVINCE_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'hovered'], false],
            'rgba(255,255,255,0.18)',
            '#34d399'
          ],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 0.55, 0.05]
        }
      });
    }

    if (!instance.getLayer(PROVINCE_LINE_LAYER_ID)) {
      instance.addLayer({
        id: PROVINCE_LINE_LAYER_ID,
        type: 'line',
        source: PROVINCE_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'line-color': 'rgba(52, 211, 153, 0.4)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 7, 1.8]
        }
      });
    }

    if (!instance.getLayer(PROVINCE_LABEL_LAYER_ID)) {
      instance.addLayer({
        id: PROVINCE_LABEL_LAYER_ID,
        type: 'symbol',
        source: PROVINCE_SOURCE_ID,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'label'],
          'text-font': FONT_STACK,
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 6, 13, 8, 14],
          'text-max-width': 8,
          'text-variable-anchor': ['center', 'top', 'bottom'],
          'text-radial-offset': 0.3
        },
        paint: {
          'text-color': '#ecfeff',
          'text-halo-color': 'rgba(2, 6, 23, 0.95)',
          'text-halo-width': 1.2
        }
      });
    }

    if (!instance.getLayer(CITY_FILL_LAYER_ID)) {
      instance.addLayer({
        id: CITY_FILL_LAYER_ID,
        type: 'fill',
        source: CITY_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'hovered'], false],
            'rgba(255,255,255,0.18)',
            '#38bdf8'
          ],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 0.55, 0.05]
        }
      });
    }

    if (!instance.getLayer(CITY_LINE_LAYER_ID)) {
      instance.addLayer({
        id: CITY_LINE_LAYER_ID,
        type: 'line',
        source: CITY_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'line-color': 'rgba(56, 189, 248, 0.4)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 8, 1.5]
        }
      });
    }

    if (!instance.getLayer(CITY_LABEL_LAYER_ID)) {
      instance.addLayer({
        id: CITY_LABEL_LAYER_ID,
        type: 'symbol',
        source: CITY_SOURCE_ID,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'label'],
          'text-font': FONT_STACK,
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 7.5, 13, 9, 14],
          'text-max-width': 8,
          'text-variable-anchor': ['center', 'top', 'bottom'],
          'text-radial-offset': 0.3
        },
        paint: {
          'text-color': '#f0f9ff',
          'text-halo-color': 'rgba(2, 6, 23, 0.95)',
          'text-halo-width': 1.2
        }
      });
    }

    if (!instance.getLayer(COUNTY_FILL_LAYER_ID)) {
      instance.addLayer({
        id: COUNTY_FILL_LAYER_ID,
        type: 'fill',
        source: COUNTY_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'hovered'], false],
            'rgba(255,255,255,0.18)',
            '#ffffff'
          ],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 0.55, 0.05]
        }
      });
    }

    if (!instance.getLayer(COUNTY_LINE_LAYER_ID)) {
      instance.addLayer({
        id: COUNTY_LINE_LAYER_ID,
        type: 'line',
        source: COUNTY_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'line-color': 'rgba(247, 99, 224, 0.4)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.4, 10, 1.2]
        }
      });
    }

    if (!instance.getLayer(COUNTY_LABEL_LAYER_ID)) {
      instance.addLayer({
        id: COUNTY_LABEL_LAYER_ID,
        type: 'symbol',
        source: COUNTY_SOURCE_ID,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'label'],
          'text-font': FONT_STACK,
          'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10, 9.5, 12, 11, 13],
          'text-max-width': 8,
          'text-variable-anchor': ['center', 'top', 'bottom'],
          'text-radial-offset': 0.25
        },
        paint: {
          'text-color': '#fffbeb',
          'text-halo-color': 'rgba(2, 6, 23, 0.95)',
          'text-halo-width': 1.1
        }
      });
    }

    if (!instance.getLayer(HOVER_LINE_LAYER_ID)) {
      instance.addLayer({
        id: HOVER_LINE_LAYER_ID,
        type: 'line',
        source: HOVER_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: { 'line-color': 'rgba(255,255,255,0.3)', 'line-width': 1 }
      });
    }

    if (!instance.getLayer(SHOPS_LAYER_ID)) {
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

    if (!instance.getLayer(SHOPS_ACTIVE_LAYER_ID)) {
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

    if (!instance.getLayer(SHOPS_PINNED_LAYER_ID)) {
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

    if (!instance.getLayer(SHOPS_NAME_LAYER_ID)) {
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

  let activeFeatureState: { id: string | number; source: string } | null = null;

  const flushHoverToMap = (instance: maplibregl.Map, feature: GlobeFeature | null) => {
    if (activeFeatureState) {
      instance.setFeatureState(activeFeatureState, { hovered: false });
      activeFeatureState = null;
    }
    if (feature) {
      const fid = (feature as unknown as { id?: string | number }).id;
      const sourceId =
        feature.properties?.dataset === 'world'
          ? WORLD_SOURCE_ID
          : feature.properties?.dataset === 'china-provinces'
            ? PROVINCE_SOURCE_ID
            : feature.properties?.dataset === 'china-cities'
              ? CITY_SOURCE_ID
              : COUNTY_SOURCE_ID;
      if (fid !== undefined) {
        activeFeatureState = { id: fid, source: sourceId };
        instance.setFeatureState(activeFeatureState, { hovered: true });
      }
    }
    const source = getGeoJsonSource(instance, HOVER_SOURCE_ID);
    if (source) {
      const data: GlobeFeatureCollection = feature
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature' as const,
                geometry: feature.geometry,
                properties: feature.properties
              }
            ]
          }
        : emptyGlobeFeatureCollection();
      try {
        source.setData(data);
      } catch {
        // worker not ready
      }
    }
    setLayerVisibility(
      instance,
      HOVER_LINE_LAYER_ID,
      feature !== null && mode === 'fullscreen' && devGeoJsonEnabled
    );
  };

  const syncMapData = (instance: maplibregl.Map) => {
    upsertGeoJsonSource(instance, WORLD_SOURCE_ID, worldData);
    upsertGeoJsonSource(instance, PROVINCE_SOURCE_ID, provinceData);
    upsertGeoJsonSource(instance, CITY_SOURCE_ID, visibleCityData);
    upsertGeoJsonSource(instance, COUNTY_SOURCE_ID, countyData);

    const showProvinceLayers = chinaActive && provinceData.features.length > 0;
    const showCityLayers =
      showProvinceLayers && visibleCityData.features.length > 0 && Boolean(activeProvinceAdcode);
    const showCountyLayers =
      showCityLayers && countyData.features.length > 0 && Boolean(activeCityAdcode);

    setLayerVisibility(instance, PROVINCE_FILL_LAYER_ID, showProvinceLayers);
    setLayerVisibility(instance, PROVINCE_LINE_LAYER_ID, showProvinceLayers);
    setLayerVisibility(instance, PROVINCE_LABEL_LAYER_ID, showProvinceLayers);
    setLayerVisibility(instance, CITY_FILL_LAYER_ID, showCityLayers);
    setLayerVisibility(instance, CITY_LINE_LAYER_ID, showCityLayers);
    setLayerVisibility(instance, CITY_LABEL_LAYER_ID, showCityLayers);
    setLayerVisibility(instance, COUNTY_FILL_LAYER_ID, showCountyLayers);
    setLayerVisibility(instance, COUNTY_LINE_LAYER_ID, showCountyLayers);
    setLayerVisibility(instance, COUNTY_LABEL_LAYER_ID, showCountyLayers);

    const worldFilter: maplibregl.FilterSpecification | null = showProvinceLayers
      ? ['!=', ['get', 'isChina'], true]
      : null;
    for (const layerId of [WORLD_FILL_LAYER_ID, WORLD_LINE_LAYER_ID]) {
      if (instance.getLayer(layerId)) instance.setFilter(layerId, worldFilter);
    }
    if (instance.getLayer(WORLD_LABEL_LAYER_ID)) {
      instance.setFilter(WORLD_LABEL_LAYER_ID, worldFilter);
      setLayerVisibility(instance, WORLD_LABEL_LAYER_ID, true);
    }
    setLayerVisibility(instance, WORLD_FILL_LAYER_ID, true);
    setLayerVisibility(instance, WORLD_LINE_LAYER_ID, true);

    const provinceFilter: maplibregl.FilterSpecification | null =
      showCityLayers && activeProvinceAdcode
        ? ['!=', ['get', 'adcode'], activeProvinceAdcode]
        : null;
    for (const layerId of [
      PROVINCE_FILL_LAYER_ID,
      PROVINCE_LINE_LAYER_ID,
      PROVINCE_LABEL_LAYER_ID
    ]) {
      if (instance.getLayer(layerId)) instance.setFilter(layerId, provinceFilter);
    }

    const cityFilter: maplibregl.FilterSpecification | null =
      showCountyLayers && activeCityAdcode ? ['!=', ['get', 'adcode'], activeCityAdcode] : null;
    for (const layerId of [CITY_FILL_LAYER_ID, CITY_LINE_LAYER_ID, CITY_LABEL_LAYER_ID]) {
      if (instance.getLayer(layerId)) instance.setFilter(layerId, cityFilter);
    }

    setLayerVisibility(instance, AMAP_LAYER_ID, chinaActive && viewZoom >= AMAP_ZOOM_THRESHOLD);
    setLayerVisibility(instance, SHOPS_NAME_LAYER_ID, true);
    applyDevPanelOverrides(instance);
  };

  const getTopFeatureAtPoint = (instance: maplibregl.Map, point: maplibregl.PointLike) => {
    const layers = [
      COUNTY_FILL_LAYER_ID,
      CITY_FILL_LAYER_ID,
      PROVINCE_FILL_LAYER_ID,
      WORLD_FILL_LAYER_ID
    ].filter((layerId) => instance.getLayer(layerId));
    if (layers.length === 0) return null;
    const [feature] = instance.queryRenderedFeatures(point, { layers });
    return (feature as unknown as GlobeFeature | undefined) ?? null;
  };

  const fitToFeature = (instance: maplibregl.Map, feature: GlobeFeature, maxZoom: number) => {
    const bounds = getFeatureBounds(feature);
    if (!bounds) return;
    instance.fitBounds(bounds, {
      duration: 1200,
      maxZoom,
      padding: { top: 80, right: 80, bottom: 80, left: 80 }
    });
  };

  const ensureCountyData = async (parentAdcode: string) => {
    const cached = countyCache[parentAdcode];
    if (cached) {
      countyData = cached;
      countyStatus = 'ready';
      return;
    }
    countyStatus = 'loading';
    try {
      const data = await fetchGeoJson('china-counties', parentAdcode);
      countyCache[parentAdcode] = data;
      if (activeCityAdcode === parentAdcode) {
        countyData = data;
        countyStatus = 'ready';
      }
    } catch (error) {
      console.error('Failed to load county GeoJSON:', error);
      if (activeCityAdcode === parentAdcode) {
        countyData = emptyGlobeFeatureCollection();
        countyStatus = 'error';
      }
    }
  };

  const syncDrilldown = (instance: maplibregl.Map) => {
    viewZoom = instance.getZoom();
    const point = instance.project(instance.getCenter());
    const centeredFeature = getTopFeatureAtPoint(instance, point);
    const isCenterInChina =
      centeredFeature?.properties?.dataset?.startsWith('china-') ||
      isChinaWorldFeature(centeredFeature);
    const nextChinaActive = !!(viewZoom >= COUNTRY_ZOOM_THRESHOLD && isCenterInChina);
    chinaActive = nextChinaActive;

    if (!nextChinaActive) {
      activeProvinceAdcode = null;
      activeCityAdcode = null;
      countyData = emptyGlobeFeatureCollection();
      countyStatus = 'idle';
      syncMapData(instance);
      return;
    }

    let nextProvinceAdcode: string | null = null;
    let nextCityAdcode: string | null = null;

    if (viewZoom >= PROVINCE_ZOOM_THRESHOLD && centeredFeature) {
      const dataset = centeredFeature.properties?.dataset;
      if (dataset === 'china-provinces') {
        nextProvinceAdcode = centeredFeature.properties?.adcode ?? null;
      } else if (dataset === 'china-cities' || dataset === 'china-counties') {
        nextProvinceAdcode = centeredFeature.properties?.provinceAdcode ?? null;
        if (viewZoom >= CITY_ZOOM_THRESHOLD) {
          if (dataset === 'china-cities') {
            nextCityAdcode =
              getCountyParentAdcode(centeredFeature as unknown as GlobeFeature) ?? null;
          } else if (dataset === 'china-counties') {
            nextCityAdcode = centeredFeature.properties?.parentAdcode ?? null;
          }
        }
      }
    }

    const provinceChanged = nextProvinceAdcode !== activeProvinceAdcode;
    if (provinceChanged) {
      activeProvinceAdcode = nextProvinceAdcode;
      activeCityAdcode = null;
      countyData = emptyGlobeFeatureCollection();
      countyStatus = 'idle';
    }

    const cityChanged = nextCityAdcode !== activeCityAdcode;
    if (cityChanged || provinceChanged) {
      activeCityAdcode = nextCityAdcode ?? null;
      countyData = emptyGlobeFeatureCollection();
      countyStatus = nextCityAdcode ? 'loading' : 'idle';
    }

    syncMapData(instance);
    if (viewZoom >= COUNTY_ZOOM_THRESHOLD && nextCityAdcode) {
      void ensureCountyData(nextCityAdcode);
    }
  };

  const loadBaseGeoJson = async () => {
    geojsonStatus = 'loading';
    geojsonError = null;
    try {
      const [nextWorldData, nextProvinceData, nextCityData] = await Promise.all([
        fetchGeoJson('world'),
        fetchGeoJson('china-provinces'),
        fetchGeoJson('china-cities')
      ]);
      worldData = nextWorldData;
      provinceData = nextProvinceData;
      cityData = nextCityData;
      geojsonStatus = 'ready';
      if (map?.isStyleLoaded()) {
        ensureMapLayers(map);
        applyModeLayers(map, mode);
        syncDrilldown(map);
      }
    } catch (error) {
      console.error('Failed to load globe GeoJSON:', error);
      geojsonStatus = 'error';
      geojsonError = 'Failed to load map boundaries.';
    }
  };

  $effect(() => {
    const instance = map;
    if (!instance?.isStyleLoaded()) return;
    syncScene(instance);
    ensureMapLayers(instance);
    applyModeLayers(instance, mode);
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
  });

  $effect(() => {
    const instance = map;
    if (!instance?.isStyleLoaded()) return;
    instance.setSky({ 'atmosphere-blend': atmosphereBlend });
  });

  // ---- Three.js render-layer dev toggles ----
  $effect(() => {
    // Explicitly read all render-layer dev toggles so this effect always reruns
    // when the panel state changes.
    void devSpecularEnabled;
    void devNightLightsEnabled;
    void devAtmosphereEnabled;
    void devCloudsEnabled;
    void devCloudShadowsEnabled;
    void devCloudShadowOpacity;

    const instance = map;
    if (!instance?.isStyleLoaded()) return;

    // Keep the existing custom layer and update uniforms/visibility in-place
    // so toggles and sliders respond immediately.
    ensureVisualsLayer(instance);
    if (visualsLayer) applyVisualsDevSettings(visualsLayer);
    instance.triggerRepaint();
  });

  // ---- Map overlay dev toggles ----
  $effect(() => {
    // Explicitly read map overlay toggles to guarantee effect dependency tracking.
    void devShopMarkersEnabled;
    void devGeoJsonEnabled;

    const instance = map;
    if (!instance?.isStyleLoaded()) return;
    if (mode === 'fullscreen') {
      syncMapData(instance);
      instance.triggerRepaint();
      return;
    }
    applyDevPanelOverrides(instance);
    instance.triggerRepaint();
  });

  // ---- Mode transition effect ----
  let prevMode: 'landing' | 'fullscreen' | null = null;
  $effect(() => {
    const currentMode = mode;
    const instance = map;
    if (!instance) return;
    if (prevMode === currentMode) return;
    const wasLanding = prevMode === 'landing';
    const wasFullscreen = prevMode === 'fullscreen';
    prevMode = currentMode;

    if (currentMode === 'fullscreen') {
      stopAutoRotation();
      instance.flyTo({
        center: [155, 45],
        zoom: 2,
        pitch: 0,
        bearing: 0,
        duration: 2000,
        essential: true
      });
      if (instance.isStyleLoaded()) applyModeLayers(instance, 'fullscreen');
    } else if (currentMode === 'landing') {
      if (wasFullscreen) {
        pinnedShop = null;
        markerHoveredShop = null;
        regionFilter = { type: 'world' };
        sidebarOpen = false;
      }
      instance.flyTo({
        center: [LANDING_LONGITUDE, LANDING_LATITUDE],
        zoom: LANDING_ZOOM,
        pitch: LANDING_PITCH,
        bearing: LANDING_BEARING,
        duration: wasFullscreen ? 1800 : 0,
        essential: true
      });
      if (instance.isStyleLoaded()) applyModeLayers(instance, 'landing');
      setTimeout(() => startAutoRotation(), wasFullscreen ? 1800 : 100);
    }
    void wasLanding;
  });

  // ---- Region filter helpers ----
  const getProvinceNameByAdcode = (adcode: string | undefined) =>
    adcode
      ? (provinceData.features.find((f: GlobeFeature) => f.properties?.adcode === adcode)
          ?.properties?.name ?? '')
      : '';

  const getCityNameByAdcode = (adcode: string | undefined) =>
    adcode
      ? (cityData.features.find((f: GlobeFeature) => f.properties?.adcode === adcode)?.properties
          ?.name ?? '')
      : '';

  const applyRegionFilter = (feature: GlobeFeature) => {
    const props = feature.properties;
    if (!props) return;
    if (props.dataset === 'world') {
      regionFilter = props.isChina ? { type: 'china' } : { type: 'address', address: [props.name] };
      return;
    }
    if (props.dataset === 'china-provinces') {
      regionFilter = { type: 'china-province', name: props.name };
      return;
    }
    if (props.dataset === 'china-cities') {
      regionFilter = {
        type: 'china-city',
        provinceName: getProvinceNameByAdcode(props.provinceAdcode),
        cityName: props.name
      };
      return;
    }
    if (props.dataset === 'china-counties') {
      regionFilter = {
        type: 'china-county',
        provinceName: getProvinceNameByAdcode(props.provinceAdcode),
        cityName: getCityNameByAdcode(props.parentAdcode),
        countyName: props.name
      };
    }
  };

  onMount(() => {
    if (!mapContainer) return;

    syncResponsiveFlags();

    if (sidebarSize.w === undefined) {
      sidebarSize.w = Math.min(400, Math.max(window.innerWidth * 0.3, 280));
    }

    if (sidebarSize.h === undefined) {
      sidebarSize.h = window.innerHeight - sidebarPos.y - sidebarPos.x;
    }

    const instance = new maplibregl.Map({
      container: mapContainer,
      style: mapStyle,
      ...(mode === 'landing'
        ? {
            center: [LANDING_LONGITUDE, LANDING_LATITUDE],
            zoom: LANDING_ZOOM,
            pitch: LANDING_PITCH,
            bearing: LANDING_BEARING
          }
        : {
            center: [155, 45],
            zoom: 2,
            pitch: 0,
            bearing: 0
          })
    });
    map = instance;

    // Create NavigationControl and always add it; visibility is controlled by
    // the landing-mode CSS class on mapContainer so we get a CSS opacity fade.
    navigationControl = new maplibregl.NavigationControl();
    instance.addControl(navigationControl, 'top-right');

    const syncStyle = () => {
      sourceDataRevisions.clear();
      syncScene(instance);
      ensureMapLayers(instance);
      applyModeLayers(instance, mode);
      syncDrilldown(instance);
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
    };

    const handleMoveEnd = () => {
      if (mode === 'fullscreen') syncDrilldown(instance);
    };

    const handlePointerMove = (event: maplibregl.MapMouseEvent) => {
      if (mode !== 'fullscreen') return;
      const feature = getTopFeatureAtPoint(instance, event.point);
      const newId = feature?.properties?.featureId ?? null;
      if (newId === hoveredFeatureId) return;
      hoveredFeatureId = newId;
      hoveredFeature = feature;
      flushHoverToMap(instance, feature);
      instance.getCanvas().style.cursor = feature ? 'pointer' : '';
    };

    const handleMouseOut = () => {
      if (mode !== 'fullscreen') return;
      if (!hoveredFeatureId) return;
      hoveredFeatureId = null;
      hoveredFeature = null;
      flushHoverToMap(instance, null);
      instance.getCanvas().style.cursor = '';
    };

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      if ((event.originalEvent as Event & { _shopHandled?: boolean })._shopHandled) return;

      if (mode === 'landing') {
        if (!landingDragOccurred) void goto(resolve('/globe'));
        return;
      }

      pinnedShop = null;
      markerHoveredShop = null;

      const feature = getTopFeatureAtPoint(instance, event.point);
      if (!feature?.properties) {
        regionFilter = { type: 'world' };
        chinaActive = false;
        activeProvinceAdcode = null;
        activeCityAdcode = null;
        countyData = emptyGlobeFeatureCollection();
        countyStatus = 'idle';
        syncMapData(instance);
        return;
      }

      applyRegionFilter(feature);

      if (feature.properties.dataset === 'world') {
        if (feature.properties.isChina) {
          chinaActive = true;
          activeProvinceAdcode = null;
          activeCityAdcode = null;
          countyData = emptyGlobeFeatureCollection();
          countyStatus = 'idle';
          syncMapData(instance);
          fitToFeature(instance, feature, 4.4);
        } else {
          chinaActive = false;
          activeProvinceAdcode = null;
          activeCityAdcode = null;
          countyData = emptyGlobeFeatureCollection();
          countyStatus = 'idle';
          syncMapData(instance);
          fitToFeature(instance, feature, 5.0);
        }
        return;
      }

      if (feature.properties.dataset === 'china-provinces') {
        chinaActive = true;
        activeProvinceAdcode = feature.properties.adcode ?? null;
        activeCityAdcode = null;
        countyData = emptyGlobeFeatureCollection();
        countyStatus = 'idle';
        syncMapData(instance);
        fitToFeature(instance, feature, 6.4);
        return;
      }

      if (feature.properties.dataset === 'china-cities') {
        const cityAdcode = getCountyParentAdcode(feature as unknown as GlobeFeature) ?? null;
        const prevCityAdcode = activeCityAdcode;
        chinaActive = true;
        activeProvinceAdcode = feature.properties.provinceAdcode ?? null;
        activeCityAdcode = cityAdcode;
        if (cityAdcode !== prevCityAdcode) {
          countyData = emptyGlobeFeatureCollection();
          countyStatus = cityAdcode ? 'loading' : 'idle';
        }
        syncMapData(instance);
        if (cityAdcode) void ensureCountyData(cityAdcode);
        fitToFeature(instance, feature, feature.properties.hasCountyChildren ? 8.2 : 7.2);
        return;
      }

      if (feature.properties.dataset === 'china-counties') {
        chinaActive = true;
        activeProvinceAdcode = feature.properties.provinceAdcode ?? null;
        activeCityAdcode = feature.properties.parentAdcode ?? null;
        syncMapData(instance);
        fitToFeature(instance, feature, 9.5);
      }
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
              // Navigate to /globe – camera animates via mode change effect
              goto(resolve('/globe'));
              return;
            }
            if (pinnedShop && getShopKey(pinnedShop) === key) {
              pinnedShop = null;
              markerHoveredShop = null;
            } else {
              if (!isShopInCurrentFilter(entry.shop)) selectedTitleIds = [];
              applyShopRegionFilter(entry.shop);
              pinShop(entry);
            }
          }
        }
      }
    };

    // In landing mode we need to distinguish a real click (→ navigate) from a
    // drag (→ rotate globe).  MapLibre suppresses its own 'click' after a drag
    // for desktop mouse, but mobile browsers synthesise a 'click' after a touch
    // drag, bypassing that suppression.  We use a flag that is set on dragstart
    // and cleared on the next pointerdown so the click handler can gate on it.
    let landingDragOccurred = false;

    const handleMouseDown = () => {
      if (mode !== 'landing') return;
      landingDragOccurred = false;
      // Stop auto-rotation immediately so MapLibre's drag threshold starts
      // measuring from a stationary map.
      stopAutoRotation();
    };
    const handleMouseUp = () => {
      if (mode !== 'landing') return;
      startAutoRotation();
    };
    const handleDragStart = () => {
      if (mode === 'landing') {
        landingDragOccurred = true;
      }
    };
    const handleDragEnd = () => {
      if (mode === 'landing') startAutoRotation();
    };

    instance.on('style.load', syncStyle);
    instance.on('moveend', handleMoveEnd);
    instance.on('mousemove', handlePointerMove);
    instance.on('mouseout', handleMouseOut);
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
      if (sidebarSize.w !== undefined) {
        sidebarSize.w = Math.min(sidebarSize.w, window.innerWidth - sidebarPos.x);
      }
      if (sidebarSize.h !== undefined) {
        sidebarSize.h = Math.min(sidebarSize.h, window.innerHeight - sidebarPos.y);
      }
    };
    const resizeObserver = new ResizeObserver(handleViewportResize);
    resizeObserver.observe(mapContainer);
    window.addEventListener('resize', handleViewportResize);

    void loadBaseGeoJson();

    // Start auto-rotation immediately in landing mode
    if (mode === 'landing') {
      prevMode = 'landing';
      startAutoRotation();
    } else {
      prevMode = 'fullscreen';
    }

    const refreshInterval = setInterval(() => {
      viewTime = new Date();
      now = new Date();
      void invalidate('app:globe-shops');
    }, 60_000);

    return () => {
      stopAutoRotation();
      instance.off('style.load', syncStyle);
      instance.off('moveend', handleMoveEnd);
      instance.off('mousemove', handlePointerMove);
      instance.off('mouseout', handleMouseOut);
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
      clearInterval(refreshInterval);
      if (map === instance) map = undefined;
    };
  });
</script>

<!-- ================================================================
     Fixed globe container – always behind page content
     ================================================================ -->
<div class="pointer-events-none fixed inset-0 z-0 overflow-hidden">
  <!-- Map canvas fills entire area -->
  <div
    bind:this={mapContainer}
    class="pointer-events-auto h-full w-full"
    class:cursor-pointer={mode === 'landing'}
    class:landing-mode={mode === 'landing'}
  ></div>

  <!-- ---- Bottom gradient blur (landing mode only) ---- -->
  {#if mode === 'landing'}
    <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[70vh]" transition:fade>
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
  {/if}

  <!-- ================================================================
       Sidebar (fullscreen mode only)
       ================================================================ -->
  {#if mode === 'fullscreen'}
    <aside
      transition:slide
      class="bg-base-200/70 border-base-300 pointer-events-auto absolute z-20 flex flex-col overflow-hidden border shadow-lg backdrop-blur-xl
             not-md:inset-x-0 not-md:top-auto not-md:bottom-0 not-md:max-h-[65vh] not-md:rounded-t-2xl
             not-md:transition-transform not-md:duration-300 not-md:ease-out not-md:will-change-transform
             md:top-(--globe-sidebar-top) md:left-(--globe-sidebar-left) md:h-(--globe-sidebar-height) md:w-(--globe-sidebar-width) md:rounded-xl {sidebarOpen
        ? 'not-md:translate-y-0'
        : 'not-md:translate-y-full'}"
      style={getSidebarCssVars()}
    >
      <!-- Mobile drag handle -->
      <div class="bg-base-content/20 mx-auto mt-2 mb-1 h-1 w-10 rounded-full md:hidden"></div>

      <!-- Region header – acts as drag handle on desktop -->
      <div
        role="none"
        class="border-base-300 border-b p-4 md:select-none"
        class:md:cursor-grabbing={isDraggingSidebar}
        class:md:cursor-grab={!isDraggingSidebar}
        onpointerdown={startSidebarDrag}
        onpointermove={moveSidebarDrag}
        onpointerup={stopSidebarDrag}
        style="touch-action: none;"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h2 class="truncate text-2xl font-bold">{regionTitle}</h2>
            {#if regionHierarchy.length > 0}
              <p class="text-base-content/60 mt-0.5 truncate text-sm">
                {regionHierarchy.join(' › ')}
              </p>
            {/if}
          </div>
          <button
            type="button"
            class="btn btn-circle btn-ghost btn-sm shrink-0 md:hidden"
            aria-label={m.close()}
            onclick={() => (sidebarOpen = false)}
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      <!-- Search + game filters -->
      <div class="border-base-300 border-b p-3">
        <div class="flex gap-2">
          <div class="dropdown">
            <button
              type="button"
              tabindex="0"
              class="btn btn-soft hover:btn-accent"
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
                  {#each GAMES as game (game.id)}
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
          {#each filteredShops.slice(0, visibleCount) as { shop } (`${shop.source}-${shop.id}`)}
            {@const cardKey = `${shop.source}-${shop.id}`}
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
    </aside>

    <!-- Mobile sidebar toggle -->
    <button
      transition:fade
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
        transition:fade
        role="presentation"
        class="pointer-events-auto absolute inset-0 z-15 bg-black/40 md:hidden"
        onclick={() => (sidebarOpen = false)}
      ></div>
    {/if}

    <!-- Desktop: pinned shop interactive card at bottom-right -->
    {#if pinnedShop && !isCompactViewport}
      <div class="pointer-events-auto absolute right-4 bottom-4 z-10 max-w-110 shadow-xl">
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

  {#if markerHoveredShop && !isCoarsePointer && (mode === 'landing' || !pinnedShop)}
    <div
      class="pointer-events-none fixed z-50 w-80"
      style="left: {cursorPos.x + 15}px; top: {cursorPos.y + 15}px;"
    >
      <ShopCard shop={markerHoveredShop} />
    </div>
  {/if}

  <!-- ================================================================
       Dev panel (DEV mode only)
       ================================================================ -->
  {#if import.meta.env.DEV}
    <div
      class="bg-base-200/70 pointer-events-auto absolute top-3 z-10 flex max-w-xs min-w-64 flex-col gap-3 rounded-md p-3 text-sm shadow-lg backdrop-blur-sm
             {mode === 'fullscreen' ? 'top-16 right-12' : 'left-3'}"
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
        <p class="text-xs font-semibold tracking-wide uppercase opacity-60">Render layers</p>
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
          devSpecularEnabled,
          (v) => (devSpecularEnabled = v)
        )}
        {@render layerToggle(
          'Night lights',
          'City lights overlay',
          devNightLightsEnabled,
          (v) => (devNightLightsEnabled = v)
        )}
        {@render layerToggle(
          'Atmosphere',
          'Three.js atmosphere rim',
          devAtmosphereEnabled,
          (v) => (devAtmosphereEnabled = v)
        )}
        {@render layerToggle(
          'Clouds',
          'Cloud texture overlay',
          devCloudsEnabled,
          (v) => (devCloudsEnabled = v)
        )}
        {@render layerToggle(
          'Cloud shadows',
          'Sun-cast cloud shadows',
          devCloudShadowsEnabled,
          (v) => (devCloudShadowsEnabled = v)
        )}
        {#if devCloudShadowsEnabled}
          <label class="flex flex-col gap-1 pl-3 text-xs">
            <span class="flex items-center justify-between">
              <span class="opacity-70">Shadow opacity</span>
              <span class="font-mono opacity-70">{devCloudShadowOpacity.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              class="range range-xs"
              bind:value={devCloudShadowOpacity}
            />
          </label>
        {/if}
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
            bind:checked={devShopMarkersEnabled}
          />
        </label>
        <label class="flex cursor-pointer items-center justify-between gap-3 text-xs">
          <span class="flex flex-col gap-0">
            <span class="font-medium">GeoJSON features</span>
            <span class="opacity-50">Country / province / city boundaries</span>
          </span>
          <input
            type="checkbox"
            class="checkbox checkbox-xs checked:checkbox-primary hover:checkbox-accent border-2 transition-colors"
            bind:checked={devGeoJsonEnabled}
          />
        </label>
      </div>

      <div class="border-base-content/15 flex flex-col gap-1 border-t pt-2 text-xs">
        <div>View: {currentDetailLevel}</div>
        <div>Focus: {focusPath}</div>
        <div>Zoom: {viewZoom.toFixed(2)}</div>
        {#if hoveredLabel}<div>Hover: {hoveredLabel}</div>{/if}
        {#if geojsonStatus === 'loading'}<div>Loading boundaries...</div>{/if}
        {#if countyStatus === 'loading'}<div>Loading county detail...</div>{/if}
        {#if geojsonError}<div class="text-error">{geojsonError}</div>{/if}
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
</style>
