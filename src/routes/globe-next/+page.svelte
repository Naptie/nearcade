<script lang="ts">
  import { base } from '$app/paths';
  import {
    emptyGlobeFeatureCollection,
    filterCitiesByProvince,
    getCountyParentAdcode,
    getFeatureBounds,
    isChinaWorldFeature,
    type GlobeDataset,
    type GlobeFeature,
    type GlobeFeatureCollection
  } from '$lib/utils/globeGeojson';
  import { onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { SvelteMap } from 'svelte/reactivity';
  import { m } from '$lib/paraglide/messages';
  import ShopCard from '$lib/components/ShopCard.svelte';
  import { getShopOpeningHours, isTouchscreen, getGameName, pageTitle } from '$lib/utils';
  import { GAMES } from '$lib/constants';
  import type { Shop, ShopWithExtras } from '$lib/types';
  import type { PageData } from './$types';

  // ---- Globe layer/source IDs ----
  const GEOJSON_ENDPOINT = `${base}/api/globe/geojson`;
  const CHINA_ZOOM_THRESHOLD = 2.8;
  const PROVINCE_ZOOM_THRESHOLD = 4.1;
  const CITY_ZOOM_THRESHOLD = 6.2;
  const COUNTY_ZOOM_THRESHOLD = 7.4;
  const WORLD_SOURCE_ID = 'world-boundaries';
  const PROVINCE_SOURCE_ID = 'china-province-boundaries';
  const CITY_SOURCE_ID = 'china-city-boundaries';
  const COUNTY_SOURCE_ID = 'china-county-boundaries';
  const HOVER_SOURCE_ID = 'boundary-hover';
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
  const FONT_STACK = ['Open Sans Regular', 'Arial Unicode MS Regular'];

  // ---- Page data ----
  let { data }: { data: PageData } = $props();

  // ---- Globe state ----
  let mapContainer = $state<HTMLDivElement | undefined>();
  let map = $state<maplibregl.Map | undefined>();
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

  // ---- Shop data state ----
  type ShopEntry = {
    shop: ShopWithExtras;
    location: { latitude: number; longitude: number };
  };

  let shopDataResolved = $state<Shop[]>([]);
  let attendanceDataResolved = new SvelteMap<string, { gameId: number; total: number }[]>();
  let shops = $state<ShopEntry[] | null>(null);
  let hoveredShop = $state<ShopWithExtras | null>(null);
  let cursorPos = $state({ x: 0, y: 0 });
  let isMobile = $derived(isTouchscreen());
  let now = $state(new Date());

  // ---- Sidebar state ----
  let searchQuery = $state('');
  let selectedTitleIds = $state<number[]>([]);

  // ---- Region filter ----
  type RegionFilter =
    | { type: 'world' }
    | { type: 'country'; name: string }
    | { type: 'china' }
    | { type: 'china-province'; name: string }
    | { type: 'china-city'; provinceName: string; cityName: string }
    | { type: 'china-county'; provinceName: string; cityName: string; countyName: string };

  let regionFilter = $state<RegionFilter>({ type: 'world' });

  const regionTitle = $derived.by(() => {
    switch (regionFilter.type) {
      case 'world':
        return m.world();
      case 'country':
        return regionFilter.name;
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
      case 'country':
        return [m.world()];
      case 'china':
        return [m.world()];
      case 'china-province':
        return [m.world(), '中国'];
      case 'china-city':
        return [m.world(), '中国', regionFilter.provinceName];
      case 'china-county':
        return [m.world(), '中国', regionFilter.provinceName, regionFilter.cityName];
    }
  });

  // ---- Filtered shops for the sidebar list ----
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
        case 'country':
          matchesRegion = general[general.length - 1] === regionFilter.name;
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
        const nameMatch = shop.name.toLowerCase().includes(q);
        const addrMatch = shop.address.general.join(' ').toLowerCase().includes(q);
        if (!nameMatch && !addrMatch) return false;
      }
      if (selectedTitleIds.length > 0) {
        if (!selectedTitleIds.every((tid) => shop.games.some((g) => g.titleId === tid)))
          return false;
      }
      return true;
    });
  });

  // ---- Marker management ----
  const shopMarkers = new SvelteMap<
    string,
    { marker: maplibregl.Marker; el: HTMLDivElement; shopEntry: ShopEntry }
  >();

  const getDensityMarkerColor = (density: number) => {
    switch (density) {
      case 1:
        return '#22c55e';
      case 2:
        return '#eab308';
      case 3:
        return '#f97316';
      case 4:
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  const applyMarkerStyle = (el: HTMLDivElement, density: number, isActive: boolean) => {
    el.style.backgroundColor = getDensityMarkerColor(density);
    el.style.border = `2px solid ${isActive ? 'white' : 'rgba(255,255,255,0.55)'}`;
    el.style.boxShadow = isActive
      ? '0 0 0 3px rgba(0,0,0,0.4), 0 0 6px 2px rgba(255,255,255,0.3)'
      : '0 0 0 1px rgba(0,0,0,0.3)';
    el.style.transform = isActive ? 'scale(1.5)' : 'scale(1)';
    el.style.zIndex = isActive ? '1' : '0';
  };

  const getShopKey = (shop: Pick<Shop, 'source' | 'id'>) => `${shop.source}-${shop.id}`;

  const syncMarkersToMap = (instance: maplibregl.Map, shopsData: ShopEntry[]) => {
    const newKeys = new Set(shopsData.map((s) => getShopKey(s.shop)));
    for (const [key, { marker }] of shopMarkers) {
      if (!newKeys.has(key)) {
        marker.remove();
        shopMarkers.delete(key);
      }
    }
    for (const shopEntry of shopsData) {
      const key = getShopKey(shopEntry.shop);
      const isActive = hoveredShop ? getShopKey(hoveredShop) === key : false;
      const existing = shopMarkers.get(key);
      if (existing) {
        applyMarkerStyle(existing.el, shopEntry.shop.density, isActive);
        existing.shopEntry = shopEntry;
      } else {
        const el = document.createElement('div');
        el.style.cssText =
          'width:12px;height:12px;border-radius:50%;cursor:pointer;transition:transform 0.1s,box-shadow 0.1s;';
        applyMarkerStyle(el, shopEntry.shop.density, isActive);
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([shopEntry.location.longitude, shopEntry.location.latitude])
          .addTo(instance);
        el.addEventListener('mouseenter', () => {
          if (!isMobile) hoveredShop = shopEntry.shop;
        });
        el.addEventListener('mouseleave', () => {
          if (!isMobile) hoveredShop = null;
        });
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          hoveredShop = hoveredShop && getShopKey(hoveredShop) === key ? null : shopEntry.shop;
        });
        shopMarkers.set(key, { marker, el, shopEntry });
      }
    }
  };

  // Update marker styles whenever hoveredShop changes
  $effect(() => {
    const activeKey = hoveredShop ? getShopKey(hoveredShop) : null;
    for (const [key, { el, shopEntry }] of shopMarkers) {
      applyMarkerStyle(el, shopEntry.shop.density, key === activeKey);
    }
  });

  // ---- Shop data processing ----
  $effect(() => {
    data.shopData.then((resolved) => {
      shopDataResolved = resolved;
    });
    data.attendanceData.then((resolved) => {
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
      }, new SvelteMap<number, typeof shop.games>())
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
    shops = shopDataResolved.map((shop) => {
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
  });

  // Sync markers whenever shops or map become available
  $effect(() => {
    const instance = map;
    const shopsData = shops;
    if (!instance || !shopsData) return;
    syncMarkersToMap(instance, shopsData);
  });

  // ---- Attendance refresh ----
  const refreshAttendance = async () => {
    try {
      const res = await fetch(`${base}/api/globe/attendance`);
      if (!res.ok) return;
      const raw: Record<string, { gameId: number; total: number }[]> = await res.json();
      attendanceDataResolved.clear();
      for (const [k, v] of Object.entries(raw)) attendanceDataResolved.set(k, v);
    } catch {
      // ignore transient refresh errors
    }
  };

  // ---- Sun position helpers ----
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
    const x = -Math.cos(dec) * Math.sin(lng);
    const y = -Math.sin(dec);
    const z = -Math.cos(dec) * Math.cos(lng);
    const polar = Math.acos(z);
    const azimuth = Math.atan2(x, y);
    return { azimuthDeg: (toDeg(azimuth) + 360) % 360, polarDeg: toDeg(polar) };
  };

  const mapStyle = 'https://api.maptiler.com/maps/satellite-v4/style.json?key=NwA6ZENn65hugntUKOHr';
  const atmosphereBlend: maplibregl.SkySpecification['atmosphere-blend'] = [
    'interpolate',
    ['linear'],
    ['zoom'],
    0,
    1,
    5,
    1,
    7,
    0
  ];
  const countyCache: Record<string, GlobeFeatureCollection> = {};
  const emptyData = emptyGlobeFeatureCollection();
  const sourceDataRevisions = new SvelteMap<string, GlobeFeatureCollection>();

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
    instance.setLight({ anchor: 'map', position: [100, azimuth, polar] });
    instance.setSky({ 'atmosphere-blend': atmosphereBlend });
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

  const ensureMapLayers = (instance: maplibregl.Map) => {
    upsertGeoJsonSource(instance, WORLD_SOURCE_ID, worldData);
    upsertGeoJsonSource(instance, PROVINCE_SOURCE_ID, provinceData);
    upsertGeoJsonSource(instance, CITY_SOURCE_ID, visibleCityData);
    upsertGeoJsonSource(instance, COUNTY_SOURCE_ID, countyData);
    upsertGeoJsonSource(instance, HOVER_SOURCE_ID, emptyGlobeFeatureCollection());

    if (!instance.getLayer(WORLD_FILL_LAYER_ID)) {
      instance.addLayer({
        id: WORLD_FILL_LAYER_ID,
        type: 'fill',
        source: WORLD_SOURCE_ID,
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'hovered'], false],
            'rgba(255,255,255,0.18)',
            ['case', ['boolean', ['get', 'isChina'], false], '#0ea5e9', '#020617']
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hovered'], false],
            0.55,
            ['case', ['boolean', ['get', 'isChina'], false], 0.16, 0.06]
          ]
        }
      });
    }

    if (!instance.getLayer(WORLD_LINE_LAYER_ID)) {
      instance.addLayer({
        id: WORLD_LINE_LAYER_ID,
        type: 'line',
        source: WORLD_SOURCE_ID,
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
        layout: {
          'text-field': ['get', 'label'],
          'text-font': FONT_STACK,
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9, 3, 10, 5, 11],
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
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 6, 12, 8, 13],
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
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 7.5, 12, 9, 13],
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
            '#f59e0b'
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
          'line-color': 'rgba(245, 158, 11, 0.4)',
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
          'text-size': ['interpolate', ['linear'], ['zoom'], 7, 9, 9.5, 11, 11, 12],
          'text-max-width': 7,
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
    setLayerVisibility(instance, HOVER_LINE_LAYER_ID, feature !== null);
  };

  const syncMapData = (instance: maplibregl.Map) => {
    upsertGeoJsonSource(instance, WORLD_SOURCE_ID, worldData);
    upsertGeoJsonSource(instance, PROVINCE_SOURCE_ID, provinceData);
    upsertGeoJsonSource(instance, CITY_SOURCE_ID, visibleCityData);
    upsertGeoJsonSource(instance, COUNTY_SOURCE_ID, countyData);

    const showProvinceLayers = chinaActive && provinceData.features.length > 0;
    const showCityLayers =
      showProvinceLayers &&
      visibleCityData.features.length > 0 &&
      Boolean(activeProvinceAdcode) &&
      viewZoom >= CITY_ZOOM_THRESHOLD;
    const showCountyLayers =
      showCityLayers &&
      countyData.features.length > 0 &&
      Boolean(activeCityAdcode) &&
      viewZoom >= COUNTY_ZOOM_THRESHOLD;

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
    for (const layerId of [WORLD_FILL_LAYER_ID, WORLD_LINE_LAYER_ID, WORLD_LABEL_LAYER_ID]) {
      if (instance.getLayer(layerId)) instance.setFilter(layerId, worldFilter);
    }

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
    const nextChinaActive = !!(viewZoom >= CHINA_ZOOM_THRESHOLD && isCenterInChina);
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
        syncMapData(map);
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
    syncMapData(instance);
  });

  $effect(() => {
    const instance = map;
    const az = a;
    const po = p;
    if (!instance?.isStyleLoaded()) return;
    instance.setLight({ anchor: 'map', position: [100, az, po] });
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
      regionFilter = props.isChina ? { type: 'china' } : { type: 'country', name: props.name };
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

    const instance = new maplibregl.Map({
      container: mapContainer,
      style: mapStyle,
      center: [155, 45],
      zoom: 2
    });
    map = instance;
    instance.addControl(new maplibregl.NavigationControl(), 'top-right');

    const syncStyle = () => {
      sourceDataRevisions.clear();
      syncScene(instance);
      ensureMapLayers(instance);
      syncMapData(instance);
      syncDrilldown(instance);
    };

    const handleMoveEnd = () => {
      syncDrilldown(instance);
    };

    const handlePointerMove = (event: maplibregl.MapMouseEvent) => {
      const feature = getTopFeatureAtPoint(instance, event.point);
      const newId = feature?.properties?.featureId ?? null;
      if (newId === hoveredFeatureId) return;
      hoveredFeatureId = newId;
      hoveredFeature = feature;
      flushHoverToMap(instance, feature);
      instance.getCanvas().style.cursor = feature ? 'pointer' : '';
    };

    const handleMouseOut = () => {
      if (!hoveredFeatureId) return;
      hoveredFeatureId = null;
      hoveredFeature = null;
      flushHoverToMap(instance, null);
      instance.getCanvas().style.cursor = '';
    };

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      const feature = getTopFeatureAtPoint(instance, event.point);
      if (!feature?.properties) {
        regionFilter = { type: 'world' };
        return;
      }

      applyRegionFilter(feature);

      if (feature.properties.dataset === 'world' && feature.properties.isChina) {
        fitToFeature(instance, feature, 4.4);
        return;
      }
      if (feature.properties.dataset === 'china-provinces') {
        fitToFeature(instance, feature, 6.4);
        return;
      }
      if (feature.properties.dataset === 'china-cities') {
        fitToFeature(instance, feature, feature.properties.hasCountyChildren ? 8.2 : 7.2);
        return;
      }
      if (feature.properties.dataset === 'china-counties') {
        fitToFeature(instance, feature, 9.5);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      cursorPos = { x: e.clientX, y: e.clientY };
    };

    instance.on('style.load', syncStyle);
    instance.on('moveend', handleMoveEnd);
    instance.on('mousemove', handlePointerMove);
    instance.on('mouseout', handleMouseOut);
    instance.on('click', handleClick);
    window.addEventListener('mousemove', handleMouseMove);

    void loadBaseGeoJson();

    const refreshInterval = setInterval(() => {
      void refreshAttendance();
    }, 60_000);

    return () => {
      instance.off('style.load', syncStyle);
      instance.off('moveend', handleMoveEnd);
      instance.off('mousemove', handlePointerMove);
      instance.off('mouseout', handleMouseOut);
      instance.off('click', handleClick);
      window.removeEventListener('mousemove', handleMouseMove);
      instance.remove();
      clearInterval(refreshInterval);
      if (map === instance) map = undefined;
    };
  });
</script>

<svelte:head>
  <title>{pageTitle(m.globe())}</title>
</svelte:head>

<div class="flex h-screen overflow-hidden">
  <!-- Sidebar -->
  <aside
    class="bg-base-200 border-base-300 z-10 flex w-72 flex-shrink-0 flex-col overflow-hidden border-r shadow-lg"
  >
    <!-- Region header -->
    <div class="border-base-300 border-b p-4">
      <h2 class="truncate text-2xl font-bold">{regionTitle}</h2>
      {#if regionHierarchy.length > 0}
        <p class="text-base-content/60 mt-0.5 truncate text-sm">
          {regionHierarchy.join(' › ')}
        </p>
      {/if}
    </div>

    <!-- Search + game filters -->
    <div class="border-base-300 border-b p-3">
      <div class="flex gap-2">
        <!-- Game filter dropdown -->
        <div class="dropdown">
          <button
            type="button"
            tabindex="0"
            class="btn btn-soft hover:btn-accent btn-sm"
            class:btn-primary={selectedTitleIds.length > 0}
            aria-label={m.filter_by_game_titles()}
          >
            <i class="fa-solid fa-filter text-xs"></i>
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

        <!-- Search input -->
        <div class="relative flex-1">
          <i
            class="fa-solid fa-search text-base-content/40 pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs"
          ></i>
          <input
            type="text"
            bind:value={searchQuery}
            placeholder={m.search_arcades_placeholder()}
            class="input input-bordered input-sm w-full pl-7"
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
        {#each filteredShops as { shop } (`${shop.source}-${shop.id}`)}
          <ShopCard {shop} />
        {/each}
      {/if}
    </div>
  </aside>

  <!-- Map area -->
  <div class="relative flex-1">
    <div bind:this={mapContainer} class="h-full w-full"></div>

    <!-- Dev-only floating control panel -->
    {#if import.meta.env.DEV}
      <div
        class="bg-base-200/70 absolute top-3 left-3 z-10 flex max-w-xs min-w-64 flex-col gap-4 rounded p-3 text-sm shadow-lg backdrop-blur-sm"
      >
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

        <div class="border-base-content/15 flex flex-col gap-1 border-t pt-3 text-xs">
          <div>View: {currentDetailLevel}</div>
          <div>Focus: {focusPath}</div>
          <div>Zoom: {viewZoom.toFixed(2)}</div>
          {#if hoveredLabel}
            <div>Hover: {hoveredLabel}</div>
          {/if}
          {#if geojsonStatus === 'loading'}
            <div>Loading boundaries...</div>
          {/if}
          {#if countyStatus === 'loading'}
            <div>Loading county detail...</div>
          {/if}
          {#if geojsonError}
            <div class="text-error">{geojsonError}</div>
          {/if}
          <div class="text-base-content/70 pt-1 leading-relaxed">
            China provinces appear once the camera settles over China. City boundaries follow the
            centered province, and county detail is fetched only for true city-level regions.
          </div>
        </div>
      </div>
    {/if}

    <!-- Desktop hover card (follows cursor) -->
    {#if hoveredShop && !isMobile}
      <div
        class="pointer-events-none fixed z-50 w-72"
        style="left: {cursorPos.x + 15}px; top: {cursorPos.y + 15}px;"
      >
        <ShopCard shop={hoveredShop} />
      </div>
    {/if}

    <!-- Mobile: selected shop card overlaid on map -->
    {#if hoveredShop && isMobile}
      <div class="absolute inset-x-0 top-4 z-10 px-4">
        <ShopCard shop={hoveredShop} />
      </div>
    {/if}
  </div>
</div>
