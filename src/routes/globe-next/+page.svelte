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
  // The time used to compute the sun's position for the globe light.
  let viewTime = $state(new Date());

  // ---------------------------------------------------------------------------
  // Sun position helpers (SunCalc algorithm, no external dependency needed).
  // Returns { azimuthDeg, altitudeDeg } for a given date and observer location.
  // azimuth is degrees clockwise from north; altitude is degrees above horizon.
  // ---------------------------------------------------------------------------
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const getSunPosition = (date: Date) => {
    const MS_PER_DAY = 1e3 * 60 * 60 * 24;
    const J1970 = 2440588;
    const J2000 = 2451545;
    const e = toRad(23.4397); // obliquity of Earth

    const days = date.valueOf() / MS_PER_DAY - 0.5 + J1970 - J2000;
    // Solar mean anomaly
    const M = toRad(357.5291 + 0.98560028 * days);
    // Equation of center → ecliptic longitude
    const C = 1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 3e-4 * Math.sin(3 * M);
    const L = M + toRad(C + 102.9372) + Math.PI;

    // Declination (Subsolar Latitude)
    const dec = Math.asin(Math.sin(L) * Math.sin(e));
    // Right ascension
    const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));

    // Greenwich Mean Sidereal Time
    const th0 = toRad(280.16 + 360.9856235 * days);

    // Subsolar Longitude
    const lng = ra - th0;

    // Map absolute Lat/Lng to MapLibre's 3D globe coordinate system:
    // Invert X, Y, and Z. The previous fix corrected the X/Y plane (directions and poles),
    // but Z must also be inverted to shift the light 180 degrees to the day-side hemisphere.
    const x = -Math.cos(dec) * Math.sin(lng);
    const y = -Math.sin(dec);
    const z = -Math.cos(dec) * Math.cos(lng);

    const polar = Math.acos(z);
    const azimuth = Math.atan2(x, y);

    return {
      azimuthDeg: (toDeg(azimuth) + 360) % 360,
      polarDeg: toDeg(polar)
    };
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
  // Tracks the last data reference pushed to each MapLibre GeoJSON source so that
  // setData is skipped when the reference has not changed (avoids worker-thread
  // race conditions that arise when setData is called immediately after addSource
  // or called many times with the same data).
  const sourceDataRevisions = new SvelteMap<string, GlobeFeatureCollection>();

  // MapLibre light position: [radius, azimuth_deg, polar_angle_deg].
  const sunPosition = $derived.by(() => {
    const { azimuthDeg, polarDeg } = getSunPosition(viewTime);
    return {
      azimuth: azimuthDeg,
      polar: polarDeg
    };
  });

  // Keep backwards-compat aliases used by syncScene.
  const a = $derived(sunPosition.azimuth);
  const p = $derived(sunPosition.polar);

  const visibleCityData = $derived.by(() => {
    if (!activeProvinceAdcode) {
      return emptyData;
    }

    return filterCitiesByProvince(cityData, activeProvinceAdcode);
  });

  const activeProvinceName = $derived.by(() => {
    if (!activeProvinceAdcode) {
      return null;
    }

    return (
      provinceData.features.find(
        (feature: GlobeFeature) => feature.properties?.adcode === activeProvinceAdcode
      )?.properties?.name ?? null
    );
  });

  const activeCityName = $derived.by(() => {
    if (!activeCityAdcode) {
      return null;
    }

    return (
      visibleCityData.features.find(
        (feature: GlobeFeature) => feature.properties?.adcode === activeCityAdcode
      )?.properties?.name ?? null
    );
  });

  const currentDetailLevel = $derived.by(() => {
    if (countyData.features.length > 0 && viewZoom >= COUNTY_ZOOM_THRESHOLD) {
      return 'Counties';
    }

    if (visibleCityData.features.length > 0 && viewZoom >= CITY_ZOOM_THRESHOLD) {
      return 'Cities';
    }

    if (chinaActive) {
      return 'Provinces';
    }

    return 'World';
  });

  const focusPath = $derived.by(() => {
    const parts = ['World'];

    if (chinaActive) {
      parts.push('China');
    }

    if (activeProvinceName) {
      parts.push(activeProvinceName);
    }

    if (activeCityName) {
      parts.push(activeCityName);
    }

    return parts.join(' / ');
  });

  const hoveredLabel = $derived.by(() => {
    if (!hoveredFeature?.properties) {
      return null;
    }

    return `${hoveredFeature.properties.name} (${hoveredFeature.properties.level})`;
  });

  const syncScene = (instance: maplibregl.Map, azimuth = a, polar = p) => {
    instance.setProjection({ type: 'globe' });
    instance.setLight({
      anchor: 'map',
      position: [100, azimuth, polar]
    });
    instance.setSky({
      'atmosphere-blend': atmosphereBlend
    });
  };

  // Format a Date as the value string for <input type="datetime-local">.
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

    if (!response.ok) {
      throw new Error(`Failed to load ${dataset}`);
    }

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
      // Passing data to addSource means the worker processes it immediately.
      // Calling setData again in the same synchronous turn causes a worker race;
      // caching the reference here prevents the redundant call below.
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
      // The GeoJSON worker may not be fully initialized yet (e.g. immediately
      // after a style reload or fitBounds). Roll back the cache so the next
      // syncMapData call retries the update once the worker is ready.
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
    // Hover source always starts empty; flushHoverToMap fills it on demand.
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
          // Allow only one label per unique name — features with the same name
          // compete and the renderer keeps only one visible placement.
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'symbol-avoid-edges': true,
          // Sort by featureId so a consistent winner is picked among duplicates.
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

    // Hover highlight is now done via feature-state on the fill layers above.
    // Keep the outline-only layer for the bright border around the hovered region.
    if (!instance.getLayer(HOVER_LINE_LAYER_ID)) {
      instance.addLayer({
        id: HOVER_LINE_LAYER_ID,
        type: 'line',
        source: HOVER_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'line-color': 'rgba(255,255,255,0.3)',
          'line-width': 1
        }
      });
    }
  };

  // Tracks the MapLibre internal id + source of the currently-hovered feature so
  // we can clear feature-state when the pointer moves away.
  let activeFeatureState: { id: string | number; source: string } | null = null;

  // Update hover highlight via feature-state (paints directly on tiles — covers
  // the entire MultiPolygon regardless of viewport clipping) plus the outline
  // source for the bright border.
  const flushHoverToMap = (instance: maplibregl.Map, feature: GlobeFeature | null) => {
    // Clear previous feature-state.
    if (activeFeatureState) {
      instance.setFeatureState(activeFeatureState, { hovered: false });
      activeFeatureState = null;
    }

    if (feature) {
      // feature.id is the MapLibre-assigned numeric id (requires generateId: true on source).
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

    // Also push geometry to the outline-only hover source.
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
        // worker not ready; ignore
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

    // --- Feature-level filters to hide parent region when drilled down ---
    // Hide China polygon from world layers when province detail is active.
    const worldFilter: maplibregl.FilterSpecification | null = showProvinceLayers
      ? ['!=', ['get', 'isChina'], true]
      : null;
    for (const layerId of [WORLD_FILL_LAYER_ID, WORLD_LINE_LAYER_ID, WORLD_LABEL_LAYER_ID]) {
      if (instance.getLayer(layerId)) instance.setFilter(layerId, worldFilter);
    }

    // Hide the active province polygon when city detail is active.
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

    // Hide the active city polygon when county detail is active.
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

    if (layers.length === 0) {
      return null;
    }

    const [feature] = instance.queryRenderedFeatures(point, { layers });

    return (feature as unknown as GlobeFeature | undefined) ?? null;
  };

  const fitToFeature = (instance: maplibregl.Map, feature: GlobeFeature, maxZoom: number) => {
    const bounds = getFeatureBounds(feature);

    if (!bounds) {
      return;
    }

    instance.fitBounds(bounds, {
      duration: 1200,
      maxZoom,
      padding: {
        top: 80,
        right: 80,
        bottom: 80,
        left: 80
      }
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
            // Counties fallback to parentAdcode for their city
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

  // Re-apply light whenever viewTime or center changes, independently of
  // the map/style-load effect so time-control updates are always reflected.
  $effect(() => {
    const instance = map;
    const az = a;
    const po = p;
    if (!instance?.isStyleLoaded()) return;
    instance.setLight({ anchor: 'map', position: [100, az, po] });
  });

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
      // A style reload removes all sources; reset the cache so the fresh addSource
      // calls in ensureMapLayers are not mistakenly treated as no-ops.
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
      // Skip update when the pointer is still over the same feature; this prevents
      // a setData call (and the associated worker round-trip) on every pixel of
      // mouse movement within a polygon.
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
        return;
      }

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

    instance.on('style.load', syncStyle);
    instance.on('moveend', handleMoveEnd);
    instance.on('mousemove', handlePointerMove);
    instance.on('mouseout', handleMouseOut);
    instance.on('click', handleClick);
    void loadBaseGeoJson();

    return () => {
      instance.off('style.load', syncStyle);
      instance.off('moveend', handleMoveEnd);
      instance.off('mousemove', handlePointerMove);
      instance.off('mouseout', handleMouseOut);
      instance.off('click', handleClick);
      instance.remove();

      if (map === instance) {
        map = undefined;
      }
    };
  });
</script>

<div class="relative h-screen w-screen overflow-hidden">
  <div bind:this={mapContainer} class="h-full w-full"></div>

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
</div>
