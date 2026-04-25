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
  const HOVER_FILL_LAYER_ID = 'boundary-hover-fill';
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
  let thetaDeg = $state(135);
  let phiDeg = $state(0);

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

  const p = $derived.by(() => {
    const theta = ((thetaDeg / 180 + 1) * Math.PI) / 1;
    const phi = (phiDeg / 180) * Math.PI;

    return (Math.acos(Math.cos(theta) * Math.cos(phi)) / Math.PI) * 180;
  });

  const a = $derived.by(() => {
    const theta = ((thetaDeg / 180 + 1) * Math.PI) / 1;
    const phi = (phiDeg / 180) * Math.PI;

    return 90 + (Math.atan2(Math.sin(phi), Math.sin(theta) * Math.cos(phi)) / Math.PI) * 180;
  });

  const visibleCityData = $derived.by(() => {
    if (!activeProvinceAdcode) {
      return emptyData;
    }

    return filterCitiesByProvince(cityData, activeProvinceAdcode);
  });

  const hoverData = $derived.by(() => {
    if (!hoveredFeature) {
      return emptyData;
    }

    // queryRenderedFeatures returns MapLibre-internal class instances that the
    // GeoJSON worker cannot serialize via postMessage. Reconstruct as a plain
    // object literal so the worker receives a JSON-safe value.
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature' as const,
          geometry: hoveredFeature.geometry,
          properties: hoveredFeature.properties
        }
      ]
    } satisfies GlobeFeatureCollection;
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

  const syncScene = (instance: maplibregl.Map) => {
    instance.setProjection({ type: 'globe' });
    instance.setLight({
      anchor: 'map',
      position: [100, a, p]
    });
    instance.setSky({
      'atmosphere-blend': atmosphereBlend
    });
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
      instance.addSource(sourceId, { type: 'geojson', data });
      sourceDataRevisions.set(sourceId, data);
      return;
    }

    if (sourceDataRevisions.get(sourceId) === data) return;
    sourceDataRevisions.set(sourceId, data);
    try {
      source.setData(data);
    } catch {
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
    upsertGeoJsonSource(instance, HOVER_SOURCE_ID, hoverData);

    if (!instance.getLayer(WORLD_FILL_LAYER_ID)) {
      instance.addLayer({
        id: WORLD_FILL_LAYER_ID,
        type: 'fill',
        source: WORLD_SOURCE_ID,
        paint: {
          'fill-color': ['case', ['boolean', ['get', 'isChina'], false], '#0ea5e9', '#020617'],
          'fill-opacity': ['case', ['boolean', ['get', 'isChina'], false], 0.16, 0.06]
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
          'text-radial-offset': 0.35
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
          'fill-color': '#34d399',
          'fill-opacity': 0.14
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
          'line-color': 'rgba(52, 211, 153, 0.95)',
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
          'fill-color': '#38bdf8',
          'fill-opacity': 0.13
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
          'line-color': 'rgba(56, 189, 248, 0.95)',
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
          'fill-color': '#f59e0b',
          'fill-opacity': 0.12
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
          'line-color': 'rgba(245, 158, 11, 0.95)',
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

    if (!instance.getLayer(HOVER_FILL_LAYER_ID)) {
      instance.addLayer({
        id: HOVER_FILL_LAYER_ID,
        type: 'fill',
        source: HOVER_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'fill-color': '#fb7185',
          'fill-opacity': 0.24
        }
      });
    }

    if (!instance.getLayer(HOVER_LINE_LAYER_ID)) {
      instance.addLayer({
        id: HOVER_LINE_LAYER_ID,
        type: 'line',
        source: HOVER_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'line-color': '#fb7185',
          'line-width': 2
        }
      });
    }
  };

  const syncMapData = (instance: maplibregl.Map) => {
    upsertGeoJsonSource(instance, WORLD_SOURCE_ID, worldData);
    upsertGeoJsonSource(instance, PROVINCE_SOURCE_ID, provinceData);
    upsertGeoJsonSource(instance, CITY_SOURCE_ID, visibleCityData);
    upsertGeoJsonSource(instance, COUNTY_SOURCE_ID, countyData);
    upsertGeoJsonSource(instance, HOVER_SOURCE_ID, hoverData);

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
    const showHoverLayers = hoverData.features.length > 0;

    setLayerVisibility(instance, PROVINCE_FILL_LAYER_ID, showProvinceLayers);
    setLayerVisibility(instance, PROVINCE_LINE_LAYER_ID, showProvinceLayers);
    setLayerVisibility(instance, PROVINCE_LABEL_LAYER_ID, showProvinceLayers);
    setLayerVisibility(instance, CITY_FILL_LAYER_ID, showCityLayers);
    setLayerVisibility(instance, CITY_LINE_LAYER_ID, showCityLayers);
    setLayerVisibility(instance, CITY_LABEL_LAYER_ID, showCityLayers);
    setLayerVisibility(instance, COUNTY_FILL_LAYER_ID, showCountyLayers);
    setLayerVisibility(instance, COUNTY_LINE_LAYER_ID, showCountyLayers);
    setLayerVisibility(instance, COUNTY_LABEL_LAYER_ID, showCountyLayers);
    setLayerVisibility(instance, HOVER_FILL_LAYER_ID, showHoverLayers);
    setLayerVisibility(instance, HOVER_LINE_LAYER_ID, showHoverLayers);

    if (instance.getLayer(WORLD_LABEL_LAYER_ID)) {
      instance.setFilter(
        WORLD_LABEL_LAYER_ID,
        chinaActive ? ['!=', ['get', 'name'], 'China'] : null
      );
    }
  };

  const getCenterFeature = (instance: maplibregl.Map, layerId: string) => {
    if (!instance.getLayer(layerId)) {
      return null;
    }

    const point = instance.project(instance.getCenter());
    const [feature] = instance.queryRenderedFeatures(point, {
      layers: [layerId]
    });

    return (feature as unknown as GlobeFeature | undefined) ?? null;
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

    const centeredWorldFeature = getCenterFeature(instance, WORLD_FILL_LAYER_ID);
    const nextChinaActive =
      viewZoom >= CHINA_ZOOM_THRESHOLD && isChinaWorldFeature(centeredWorldFeature);

    chinaActive = nextChinaActive;

    if (!nextChinaActive) {
      activeProvinceAdcode = null;
      activeCityAdcode = null;
      countyData = emptyGlobeFeatureCollection();
      countyStatus = 'idle';
      syncMapData(instance);
      return;
    }

    const nextProvinceAdcode =
      viewZoom >= PROVINCE_ZOOM_THRESHOLD
        ? (getCenterFeature(instance, PROVINCE_FILL_LAYER_ID)?.properties?.adcode ?? null)
        : null;
    const provinceChanged = nextProvinceAdcode !== activeProvinceAdcode;

    if (provinceChanged) {
      activeProvinceAdcode = nextProvinceAdcode;
      activeCityAdcode = null;
      countyData = emptyGlobeFeatureCollection();
      countyStatus = 'idle';
    }

    syncMapData(instance);

    if (!nextProvinceAdcode || viewZoom < CITY_ZOOM_THRESHOLD || provinceChanged) {
      return;
    }

    const nextCityFeature = getCenterFeature(instance, CITY_FILL_LAYER_ID);
    const nextCityAdcode = getCountyParentAdcode(nextCityFeature);
    const cityChanged = nextCityAdcode !== activeCityAdcode;

    if (cityChanged) {
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

  onMount(() => {
    if (!mapContainer) return;

    const instance = new maplibregl.Map({
      container: mapContainer,
      style: mapStyle,
      center: [155, 45],
      zoom: 1.5
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
      instance.getCanvas().style.cursor = feature ? 'pointer' : '';
    };

    const handleMouseOut = () => {
      if (!hoveredFeatureId) return;
      hoveredFeatureId = null;
      hoveredFeature = null;
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
    <div class="flex flex-col items-center gap-2 px-2">
      <label for="theta" class="leading-none">Theta ({thetaDeg})</label>
      <input type="range" id="theta" bind:value={thetaDeg} min={-180} max={180} />
    </div>

    <div class="flex flex-col items-center gap-2 px-2">
      <label for="phi" class="leading-none">Phi ({phiDeg.toFixed(1)})</label>
      <input type="range" id="phi" bind:value={phiDeg} min={-90} max={90} step={0.1} />
    </div>

    <div class="border-base-content/15 flex flex-col gap-1 border-t pt-3 text-xs">
      <div>View: {currentDetailLevel}</div>
      <div>Focus: {focusPath}</div>
      <div>Zoom: {viewZoom.toFixed(2)}</div>
      {#if hoveredLabel}
        <div>Hover: {hoveredLabel}</div>
      {/if}
      {#if geojsonStatus === 'loading'}
        <div>Loading world and China boundaries...</div>
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
