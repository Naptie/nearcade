<script lang="ts">
  import { browser } from '$app/environment';
  import { PUBLIC_TENCENT_MAPS_KEY } from '$env/static/public';
  import { m } from '$lib/paraglide/messages';
  import type { AMapContext } from '$lib/types';
  import { convertCoordinates } from '$lib/utils';
  import { isDarkMode } from '$lib/utils/scoped';
  import { getContext, onMount, untrack } from 'svelte';

  let {
    isOpen = $bindable(false),
    title = m.select_location_on_map(),
    onLocationSelected = () => {}
  } = $props();

  let googleMaps = $state<HTMLDivElement>();
  let mapIframe = $state<HTMLIFrameElement>();
  let useGoogleMaps = $state(false);
  let selectedLocation = $state<{
    name: string;
    city?: string;
    address?: string;
    latitude: number;
    longitude: number;
    confirmed?: boolean;
  } | null>(null);
  let placeQuery = $state('');
  let places = $state<google.maps.places.PlaceResult[]>([]);
  let isSearchingPlaces = $state(false);
  let placeSearchTimeout: ReturnType<typeof setTimeout> | undefined;
  let mapInstance = $state<google.maps.Map | null>(null);
  let amap: typeof AMap | undefined = $state(getContext<AMapContext>('amap')?.amap);

  const resetPickerState = () => {
    placeQuery = '';
    places = [];
    isSearchingPlaces = false;
    useGoogleMaps = false;
    selectedLocation = null;
  };

  const searchPlaces = async (query: string) => {
    if (!mapInstance || query.trim().length === 0) {
      places = [];
      return;
    }

    isSearchingPlaces = true;
    try {
      const service = new google.maps.places.PlacesService(mapInstance);
      const request: google.maps.places.TextSearchRequest = {
        query,
        location: mapInstance.getCenter() || undefined,
        radius: 50000
      };

      service.textSearch(request, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          places = results.slice(0, 5);
        } else {
          places = [];
        }
        isSearchingPlaces = false;
      });
    } catch (error) {
      console.error('Error searching places:', error);
      places = [];
      isSearchingPlaces = false;
    }
  };

  const handlePlaceQueryChange = () => {
    clearTimeout(placeSearchTimeout);
    placeSearchTimeout = setTimeout(() => {
      searchPlaces(placeQuery);
    }, 300);
  };

  const selectPlace = (place: google.maps.places.PlaceResult) => {
    if (!mapInstance || !place.geometry?.location) return;

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    mapInstance.setCenter({ lat, lng });
    mapInstance.setZoom(15);

    placeQuery = place.name || '';
    places = [];
  };

  const assignAMap = (event: CustomEventInit<typeof AMap>) => {
    amap = event.detail;
  };

  $effect(() => {
    if (!isOpen) {
      clearTimeout(placeSearchTimeout);
      resetPickerState();
    }
  });

  $effect(() => {
    if (mapIframe && isOpen && !useGoogleMaps) {
      const handleMessage = (event: MessageEvent) => {
        untrack(() => {
          const loc = event.data;
          if (loc && loc.module === 'locationPicker') {
            console.debug('Received location from map iframe:', loc);
            selectedLocation = {
              name: loc.poiname,
              city: loc.cityname,
              address: loc.poiaddress,
              latitude: loc.latlng.lat,
              longitude: loc.latlng.lng,
              confirmed: true
            };
          }
        });
      };

      window.addEventListener('message', handleMessage, false);

      return () => {
        window.removeEventListener('message', handleMessage, false);
      };
    }
  });

  $effect(() => {
    if (googleMaps && isOpen && useGoogleMaps && browser) {
      const map = new google.maps.Map(googleMaps, {
        zoom: 15,
        colorScheme: isDarkMode() ? 'DARK' : 'LIGHT',
        gestureHandling: 'greedy',
        streetViewControl: false
      });
      mapInstance = map;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          map.setCenter(userLocation);
        },
        () => {
          map.setCenter({ lat: 39.9042, lng: 116.4074 });
        }
      );
      google.maps.event.addListener(map, 'idle', async () => {
        const center = map.getCenter();
        if (!center) return;

        const location = {
          name: placeQuery || '',
          latitude: center.lat(),
          longitude: center.lng(),
          confirmed: false
        };
        await convertCoordinates(location, amap);
        location.confirmed = true;
        selectedLocation = location;
      });

      return () => {
        google.maps.event.clearInstanceListeners(map);
        mapInstance = null;
      };
    }
  });

  const handleSave = () => {
    if (selectedLocation) {
      onLocationSelected(selectedLocation);
      isOpen = false;
      resetPickerState();
    }
  };

  const handleCancel = () => {
    isOpen = false;
    resetPickerState();
  };

  onMount(() => {
    window.addEventListener('amap-loaded', assignAMap);

    return () => {
      window.removeEventListener('amap-loaded', assignAMap);
    };
  });
</script>

<div class="modal" class:modal-open={isOpen}>
  <div class="modal-box max-w-4xl">
    <h3 class="mb-4 text-lg font-bold">{title}</h3>

    <div class="relative mb-4 flex-1">
      {#if useGoogleMaps}
        <div class="relative z-20 mb-3">
          <label class="input input-bordered w-full">
            <input
              type="text"
              bind:value={placeQuery}
              oninput={handlePlaceQueryChange}
              placeholder={m.search_place_placeholder()}
              class="grow"
            />
            {#if isSearchingPlaces}
              <span class="loading loading-spinner loading-sm z-10"></span>
            {:else if placeQuery}
              <button
                type="button"
                class="btn btn-ghost btn-circle btn-sm z-10"
                onclick={() => {
                  placeQuery = '';
                  places = [];
                }}
                aria-label={m.clear_search()}
              >
                <i class="fa-solid fa-times"></i>
              </button>
            {/if}
          </label>
          {#if places.length > 0}
            <div
              class="bg-base-100 border-base-300 absolute top-full mt-1 w-full rounded-lg border shadow-lg"
            >
              {#each places as place (place.place_id)}
                <button
                  type="button"
                  class="hover:bg-base-300 flex w-full cursor-pointer items-start gap-3 border-b border-current/10 px-4 py-3 text-left transition-colors last:border-b-0"
                  onclick={() => selectPlace(place)}
                >
                  <i class="fa-solid fa-location-dot mt-1 opacity-50"></i>
                  <div class="min-w-0 flex-1">
                    <div class="text-base font-medium">{place.name}</div>
                    <div class="text-base-content/60 text-sm">{place.formatted_address}</div>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <div class="relative h-[60vh]">
        <button
          type="button"
          class="btn btn-outline btn-circle not-hover:bg-base-300/25 absolute right-3 bottom-5 z-10 border-current/0 backdrop-blur-lg"
          style="--size: 2.6rem"
          class:btn-neutral={!useGoogleMaps}
          class:not-dark:btn-neutral={useGoogleMaps}
          aria-label={useGoogleMaps ? m.use_tencent_maps() : m.use_google_maps()}
          title={useGoogleMaps ? m.use_tencent_maps() : m.use_google_maps()}
          onclick={() => {
            useGoogleMaps = !useGoogleMaps;
            places = [];
            placeQuery = '';
          }}
        >
          {#if useGoogleMaps}
            <i class="fa-brands fa-qq fa-lg"></i>
          {:else}
            <i class="fa-brands fa-google fa-lg"></i>
          {/if}
        </button>

        {#if useGoogleMaps}
          <div
            bind:this={googleMaps}
            title={m.map_location_picker()}
            class="h-full w-full rounded-lg border"
          ></div>
          <div
            class="text-error absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl"
          >
            <div class="absolute bottom-0 left-1/2 -translate-x-1/2">
              <i class="fa-solid fa-location-dot fa-lg"></i>
            </div>
          </div>
        {:else}
          <iframe
            bind:this={mapIframe}
            frameborder="0"
            title={m.map_location_picker()}
            class="h-full w-full rounded-lg border"
            src="https://apis.map.qq.com/tools/locpicker?search=1&type=1&key={PUBLIC_TENCENT_MAPS_KEY}&referer=nearcade"
          ></iframe>
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
        disabled={!selectedLocation}
        onclick={handleSave}
      >
        {m.save_location()}
      </button>
    </div>
  </div>
  <div
    class="modal-backdrop"
    onclick={handleCancel}
    onkeydown={(e) => e.key === 'Escape' && handleCancel()}
    role="button"
    tabindex="0"
    aria-label={m.close_modal()}
  ></div>
</div>
