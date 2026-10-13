<script lang="ts">
  import { browser } from '$app/environment';
  import * as maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import '$lib/styles/maplibre.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { getMyLocation, getCachedLocation } from '$lib/utils';
  import { fromPath, isDarkMode } from '$lib/utils/scoped';
  import { getIpOrigin } from '$lib/utils/index.client';
  import {
    bingTransformRequest,
    fixBingPickerStyleUrls,
    getStyleLocale
  } from '$lib/utils/globe/bing';

  maplibregl.setWorkerUrl(workerUrl);

  type CoordinateSystem = 'WGS84' | 'GCJ02';
  type SelectedLocation = {
    name: string;
    address: string;
    city: string;
    longitude: number;
    latitude: number;
    coordinateSystem: CoordinateSystem;
    serviceArea: 'china' | 'international';
    region?: string[];
    detailed?: string;
    confirmed: true;
  };
  type MapSelection = {
    name: string;
    address: string;
    city?: string;
    longitude: number;
    latitude: number;
    /** Known when the source pins it (search result, geolocation); map clicks
     * omit it and let the confirm endpoint resolve the surface datum. */
    coordinateSystem?: CoordinateSystem;
  };
  type Place = {
    id?: string;
    name: string;
    address: string;
    location: { longitude: number; latitude: number; coordinateSystem: CoordinateSystem };
    types: string[];
    distanceMeters?: number;
  };

  const DEFAULT_CENTER: [number, number] = [116.4074, 39.9042];
  // Budget for resolving the initial view (cached fix → IP origin). Past it
  // the map opens on DEFAULT_CENTER instead of waiting.
  const INITIAL_VIEW_DEADLINE_MS = 4000;

  let {
    isOpen = $bindable(false),
    title = m.select_location_on_map(),
    onLocationSelected = () => {},
    initialLocation = null
  } = $props<{
    isOpen?: boolean;
    title?: string;
    onLocationSelected?: (location: SelectedLocation) => void;
    /** Previously saved point (e.g. a shop being edited): the map opens centered
     * on it, already marked, and no device geolocation is requested. */
    initialLocation?: {
      longitude: number;
      latitude: number;
      coordinateSystem: CoordinateSystem;
      name?: string;
    } | null;
  }>();

  // $state.raw: MapLibre instances must not be wrapped in Svelte's deep proxy.
  let mapContainer = $state.raw<HTMLDivElement>();
  let mapInstance = $state.raw<maplibregl.Map | null>(null);
  let selectedLocation = $state<MapSelection | null>(null);
  let selectedPlace = $state<Place | null>(null);
  let placeQuery = $state('');
  let places = $state<Place[]>([]);
  let isSearchingPlaces = $state(false);
  let isLocating = $state(false);
  let isConfirming = $state(false);
  let searchFailed = $state(false);
  let searchFocused = $state(false);
  let pickerError = $state('');
  let placeSearchTimeout: ReturnType<typeof setTimeout> | undefined;
  let searchRequestId = 0;
  let pickerSession = 0;
  let selectionMarker: maplibregl.Marker | null = null;

  const resetPickerState = () => {
    clearTimeout(placeSearchTimeout);
    searchRequestId++;
    pickerSession++;
    placeQuery = '';
    places = [];
    isSearchingPlaces = false;
    isLocating = false;
    isConfirming = false;
    searchFailed = false;
    pickerError = '';
    selectedLocation = null;
    selectedPlace = null;
  };

  const setSelection = (selection: MapSelection) => {
    selectedLocation = selection;
    if (!selection.name) selectedPlace = null;
    const map = mapInstance;
    if (!map) return;
    if (!selectionMarker) {
      selectionMarker = new maplibregl.Marker({ color: '#f43f5e' });
    }
    selectionMarker.setLngLat([selection.longitude, selection.latitude]).addTo(map);
  };

  const selectMapPoint = (lngLat: { lng: number; lat: number }) => {
    setSelection({ name: '', address: '', longitude: lngLat.lng, latitude: lngLat.lat });
  };

  const searchPlaces = async (query: string) => {
    const map = mapInstance;
    const center = map?.getCenter();
    if (!map || !center || query.trim().length === 0) {
      places = [];
      return;
    }

    const requestId = ++searchRequestId;
    isSearchingPlaces = true;
    searchFailed = false;
    try {
      const response = await fetch(fromPath('/api/geo/picker/search'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          longitude: center.lng,
          latitude: center.lat,
          language: getLocale()
        })
      });
      if (!response.ok) throw new Error(`Place search failed: ${response.status}`);
      const data = (await response.json()) as { places: Place[] };
      if (requestId === searchRequestId) places = data.places ?? [];
    } catch (error) {
      console.error('Error searching places:', error);
      if (requestId === searchRequestId) {
        places = [];
        searchFailed = true;
      }
    } finally {
      if (requestId === searchRequestId) isSearchingPlaces = false;
    }
  };

  const handlePlaceQueryChange = () => {
    clearTimeout(placeSearchTimeout);
    searchRequestId++;
    searchFailed = false;
    const query = placeQuery.trim();
    if (!query) {
      places = [];
      isSearchingPlaces = false;
      return;
    }
    placeSearchTimeout = setTimeout(() => void searchPlaces(query), 350);
  };

  const selectPlace = (place: Place) => {
    if (!mapInstance) return;
    selectedPlace = place;
    setSelection({
      name: place.name,
      address: place.address,
      longitude: place.location.longitude,
      latitude: place.location.latitude,
      coordinateSystem: place.location.coordinateSystem
    });
    placeQuery = place.name;
    mapInstance.flyTo({
      center: [place.location.longitude, place.location.latitude],
      zoom: Math.max(mapInstance.getZoom(), 15),
      duration: 650
    });
  };

  /**
   * Device geolocation is true GPS WGS84; the basemap (Bing CN) is GCJ02 on
   * the mainland and WGS84 in Taiwan and overseas. Route the fix through
   * /api/geo/translate so the marker lands where amap.com and the discover
   * "我的位置" pin land.
   */
  const translateToSurface = async (location: {
    longitude: number;
    latitude: number;
  }): Promise<MapSelection | undefined> => {
    try {
      const response = await fetch(
        fromPath(
          `/api/geo/translate?lat=${location.latitude}&lng=${location.longitude}&from=WGS84`
        ),
        { signal: AbortSignal.timeout(2500) }
      );
      if (!response.ok) throw new Error(`translate failed: ${response.status}`);
      const translated = (await response.json()) as {
        converted: boolean;
        lng: number;
        lat: number;
        coordinateSystem: CoordinateSystem;
      };
      return {
        name: '',
        address: '',
        longitude: translated.lng,
        latitude: translated.lat,
        coordinateSystem: translated.coordinateSystem
      };
    } catch {
      // Translation unavailable or too slow: fall back to raw WGS84 rather
      // than holding the marker back.
      return {
        name: '',
        address: '',
        longitude: location.longitude,
        latitude: location.latitude,
        coordinateSystem: 'WGS84'
      };
    }
  };

  /**
   * Initial view when the caller pinned no location. Priority: last in-session
   * device fix (marks + centers the user), else the IP-derived city/province
   * center (centers only — a coarse origin must not look like a personal
   * fix), else the DEFAULT_CENTER constant. No geolocation permission prompt:
   * the locate button remains the one explicit GPS trigger.
   */
  const resolveInitialView = async (): Promise<{
    center: [number, number];
    zoom: number;
    selection: MapSelection | null;
  }> => {
    const cached = getCachedLocation();
    if (cached) {
      const selection = await translateToSurface(cached);
      if (selection)
        return { center: [selection.longitude, selection.latitude], zoom: 15, selection };
    }
    const origin = await getIpOrigin();
    if (origin) {
      const selection = await translateToSurface(origin);
      if (selection) {
        // City center reads at street-adjacent zoom; a province/state match
        // only justifies a wide overview of its center.
        return {
          center: [selection.longitude, selection.latitude],
          zoom: origin.level === 'city' ? 12 : 9,
          selection: null
        };
      }
    }
    return { center: DEFAULT_CENTER, zoom: 15, selection: null };
  };

  const locateMe = async () => {
    const map = mapInstance;
    if (!map) return;
    isLocating = true;
    pickerError = '';
    try {
      const selection = await translateToSurface(await getMyLocation());
      if (!selection) return;
      setSelection(selection);
      map.flyTo({
        center: [selection.longitude, selection.latitude],
        zoom: Math.max(map.getZoom(), 15),
        duration: 650
      });
    } catch (error) {
      pickerError = typeof error === 'string' ? error : m.internal_server_error();
    } finally {
      isLocating = false;
    }
  };

  const handlePlaceQueryClear = () => {
    clearTimeout(placeSearchTimeout);
    searchRequestId++;
    placeQuery = '';
    places = [];
    searchFailed = false;
  };

  const handleSave = async () => {
    if (!selectedLocation || isConfirming) return;
    const session = pickerSession;
    const selection = selectedLocation;
    isConfirming = true;
    pickerError = '';

    try {
      const response = await fetch(fromPath('/api/geo/picker/confirm'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          longitude: selection.longitude,
          latitude: selection.latitude,
          language: getLocale(),
          name: selection.name,
          address: selection.address,
          ...(selection.coordinateSystem ? { coordinateSystem: selection.coordinateSystem } : {})
        })
      });
      if (!response.ok) throw new Error(`Location confirmation failed: ${response.status}`);
      const result = (await response.json()) as {
        location: { longitude: number; latitude: number; coordinateSystem: CoordinateSystem };
        serviceArea: 'china' | 'international';
        region?: string[];
        detailed?: string;
        name: string;
        address: string;
        city?: string;
      };
      if (session !== pickerSession) return;

      onLocationSelected({
        longitude: result.location.longitude,
        latitude: result.location.latitude,
        coordinateSystem: result.location.coordinateSystem,
        serviceArea: result.serviceArea,
        region: result.region,
        detailed: result.detailed,
        name: result.name,
        address: result.address,
        city: result.city ?? '',
        confirmed: true
      });
      isOpen = false;
      resetPickerState();
    } catch (error) {
      console.error('Failed to confirm selected location:', error);
      if (session === pickerSession) pickerError = m.internal_server_error();
    } finally {
      if (session === pickerSession) isConfirming = false;
    }
  };

  const handleCancel = () => {
    isOpen = false;
    resetPickerState();
  };

  $effect(() => {
    if (!isOpen) resetPickerState();
  });

  $effect(() => {
    if (!isOpen || !browser || !mapContainer) return;

    let cancelled = false;
    let userInteracted = false;
    let map: maplibregl.Map | undefined;
    let viewDeadline: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      try {
        const theme = isDarkMode() ? 'dark' : 'light';
        // The Bing CN style document is served by unified-geo (bearer-authed
        // server proxy); the local fixups below still apply to the served
        // style (raster:// pseudo-URLs, quadkeys, glyphs).
        const styleUrl = fromPath(
          `/api/geo/style?provider=bing-cn&theme=${theme}&locale=${getStyleLocale(getLocale())}`
        );
        // Style and initial view resolve in parallel; the map is constructed
        // once, at the resolved center — no default-center flash to fix up
        // with a later jump. A deadline keeps a slow origin lookup from
        // holding the modal blank: past it, open on the static default.
        const [styleResponse, initialView] = await Promise.all([
          fetch(styleUrl),
          initialLocation
            ? Promise.resolve({
                center: [initialLocation.longitude, initialLocation.latitude] as [number, number],
                zoom: 15,
                selection: null
              })
            : Promise.race([
                resolveInitialView(),
                new Promise<{ center: [number, number]; zoom: number; selection: null }>(
                  (resolve) => {
                    viewDeadline = setTimeout(
                      () => resolve({ center: DEFAULT_CENTER, zoom: 15, selection: null }),
                      INITIAL_VIEW_DEADLINE_MS
                    );
                  }
                )
              ])
        ]);
        if (!styleResponse.ok) throw new Error(`Map style request failed: ${styleResponse.status}`);
        const style = fixBingPickerStyleUrls(
          (await styleResponse.json()) as maplibregl.StyleSpecification
        );
        if (cancelled || !mapContainer) return;

        map = new maplibregl.Map({
          container: mapContainer,
          style,
          center: initialView.center,
          zoom: initialView.zoom,
          transformRequest: bingTransformRequest
        });
        mapInstance = map;
        map.addControl(new maplibregl.NavigationControl(), 'top-right');
        map.on('click', (event) => {
          if (userInteracted === false) userInteracted = true;
          selectMapPoint(event.lngLat);
        });
        map.on('dragstart', () => (userInteracted = true));
        map.on('zoomstart', () => (userInteracted = true));
        map.once('load', () => {
          if (cancelled) return;
          if (initialLocation) {
            setSelection({
              name: initialLocation.name ?? '',
              address: '',
              longitude: initialLocation.longitude,
              latitude: initialLocation.latitude,
              coordinateSystem: initialLocation.coordinateSystem
            });
            return;
          }
          if (initialView.selection && !userInteracted) setSelection(initialView.selection);
        });
      } catch (error) {
        console.error('Failed to initialize the location picker map:', error);
        if (!cancelled) pickerError = m.internal_server_error();
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(viewDeadline);
      selectionMarker?.remove();
      selectionMarker = null;
      map?.remove();
      mapInstance = null;
    };
  });
</script>

<div class="modal" class:modal-open={isOpen}>
  <div class="modal-box max-w-4xl">
    <h3 class="mb-4 text-lg font-bold">{title}</h3>

    <div class="relative mb-4 flex-1">
      <div
        class="relative z-20 mb-3"
        onfocusin={() => (searchFocused = true)}
        onfocusout={() => setTimeout(() => (searchFocused = false), 150)}
      >
        <label class="input input-bordered w-full">
          <input
            type="text"
            bind:value={placeQuery}
            oninput={handlePlaceQueryChange}
            placeholder={m.search_place_placeholder()}
            class="grow"
            autocomplete="off"
          />
          {#if isSearchingPlaces}
            <span class="loading loading-spinner loading-sm z-10"></span>
          {:else if placeQuery}
            <button
              type="button"
              class="btn btn-ghost btn-circle btn-sm z-10"
              onclick={handlePlaceQueryClear}
              aria-label={m.clear_search()}
            >
              <i class="fa-solid fa-times"></i>
            </button>
          {/if}
        </label>
        {#if places.length > 0 && searchFocused}
          <div
            class="bg-base-100 border-base-300 absolute top-full mt-1 max-h-64 w-full overflow-y-auto rounded-lg border shadow-lg"
          >
            {#each places as place, index (`${place.id ?? place.name}:${place.location.longitude}:${index}`)}
              <button
                type="button"
                class="hover:bg-base-300 flex w-full cursor-pointer items-start gap-3 border-b border-current/10 px-4 py-3 text-left transition-colors last:border-b-0 {selectedPlace ===
                place
                  ? 'bg-base-300/60'
                  : ''}"
                onclick={() => selectPlace(place)}
              >
                <i class="fa-solid fa-location-dot mt-1 opacity-50"></i>
                <div class="min-w-0 flex-1">
                  <div class="text-base font-medium">{place.name}</div>
                  <div class="text-base-content/60 text-sm">{place.address}</div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
        {#if searchFailed}
          <p class="text-error mt-2 text-sm" role="status">{m.internal_server_error()}</p>
        {/if}
      </div>

      <div class="relative h-[60vh] overflow-hidden rounded-lg">
        <!-- Inline position: maplibre-gl.css sets .maplibregl-map { position: relative } unlayered,
             which beats Tailwind's layered `absolute` and collapses this container to 0 height. -->
        <div
          bind:this={mapContainer}
          title={m.map_location_picker()}
          class="absolute inset-0"
          style="position: absolute; inset: 0"
        ></div>
        {#if mapInstance}
          <button
            type="button"
            class="btn btn-outline btn-circle not-hover:bg-base-300/25 absolute bottom-3 left-3 z-10 border-current/0 backdrop-blur-lg"
            style="--size: 2.6rem"
            aria-label={m.my_location()}
            title={m.my_location()}
            disabled={isLocating}
            onclick={locateMe}
          >
            {#if isLocating}
              <span class="loading loading-spinner loading-sm"></span>
            {:else}
              <i class="fa-solid fa-location-crosshairs fa-lg"></i>
            {/if}
          </button>
        {/if}
        {#if pickerError}
          <div
            class="bg-base-100/90 text-error absolute right-3 bottom-3 left-3 z-10 rounded-lg p-3 text-sm"
          >
            {pickerError}
          </div>
        {/if}
      </div>
    </div>

    {#if selectedLocation}
      <div class="bg-base-200 mb-4 flex items-center gap-2 rounded-lg p-3">
        <i class="fa-solid fa-map-marker-alt text-primary"></i>
        <div>
          <p class="font-medium">{selectedLocation.name || m.selected_location()}</p>
          <p class="text-base-content/60 text-xs">
            {selectedLocation.longitude.toFixed(6)}, {selectedLocation.latitude.toFixed(6)}
          </p>
        </div>
      </div>
    {/if}

    <div class="modal-action">
      <button type="button" class="btn" onclick={handleCancel}>
        {m.cancel()}
      </button>
      <button
        type="button"
        class="btn btn-primary"
        disabled={!selectedLocation || isConfirming}
        onclick={handleSave}
      >
        {#if isConfirming}
          <span class="loading loading-spinner loading-sm"></span>
        {:else}
          {m.save_location()}
        {/if}
      </button>
    </div>
  </div>
  <div
    class="modal-backdrop"
    onclick={handleCancel}
    onkeydown={(event) => event.key === 'Escape' && handleCancel()}
    role="button"
    tabindex="0"
    aria-label={m.close_modal()}
  ></div>
</div>
