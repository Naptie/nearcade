<script lang="ts">
  import { browser } from '$app/environment';
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve, base } from '$app/paths';
  import { PUBLIC_TENCENT_MAPS_KEY } from '$env/static/public';
  import { GITHUB_LINK } from '$lib';
  import AuthModal from '$lib/components/AuthModal.svelte';
  import FancyButton from '$lib/components/FancyButton.svelte';
  import LocaleSwitch from '$lib/components/LocaleSwitch.svelte';
  import SiteTitle from '$lib/components/SiteTitle.svelte';
  import SocialMediaModal from '$lib/components/SocialMediaModal.svelte';
  import ThemeSwitch from '$lib/components/ThemeSwitch.svelte';
  import { m } from '$lib/paraglide/messages';
  import type { AMapContext, Campus, University } from '$lib/types';
  import {
    adaptiveNewTab,
    convertCoordinates,
    formatRegionLabel,
    formatShopAddress,
    getMyLocation,
    getShopOpeningHours
  } from '$lib/utils';
  import { fromPath, isDarkMode } from '$lib/utils/scoped';
  import { getContext, untrack, onMount } from 'svelte';
  import type { PageData } from './$types';
  import AttendanceReportBlame from '$lib/components/AttendanceReportBlame.svelte';
  import { getLocale } from '$lib/paraglide/runtime';

  let { data }: { data: PageData } = $props();

  let isLeavingShop = $state(false);

  let showCollapse = $state(false);
  let mode = $state(0);
  let radius = $state(10);
  let location = $state<{
    name: string;
    latitude: number;
    longitude: number;
    confirmed: boolean;
  } | null>(null);

  const RADIUS_OPTIONS = [1, 2, 5, 10, 15, 20, 25, 30];

  $effect(() => {
    if (browser) {
      localStorage.setItem('nearcade-radius', radius.toString());
    }
  });
  let isLoadingLocation = $state(false);
  let isLoading = $state(false);
  let locationError = $state('');
  let googleMaps = $state<HTMLDivElement>();
  let tencentMaps = $state<HTMLIFrameElement>();
  let useGoogleMaps = $state(false);
  let amap: typeof AMap | undefined = $state(getContext<AMapContext>('amap')?.amap);

  let universityQuery = $state('');
  let universities = $state<University[]>([]);
  let isSearchingUniversities = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | undefined;
  let searchRequestId = $state(0);

  let placeQuery = $state('');
  let places = $state<google.maps.places.PlaceResult[]>([]);
  let isSearchingPlaces = $state(false);
  let placeSearchTimeout: ReturnType<typeof setTimeout> | undefined;
  let mapInstance = $state<google.maps.Map | null>(null);

  let now = $state(new Date());

  const searchUniversities = async (query: string, requestId: number) => {
    if (query.trim().length === 0) {
      universities = [];
      return;
    }

    isSearchingUniversities = true;
    try {
      const response = await fetch(fromPath(`/api/universities?q=${encodeURIComponent(query)}`));
      const data = (await response.json()) as { universities: University[] };

      // Only update if this is still the latest request
      if (requestId === searchRequestId) {
        universities = data.universities || [];
      }
    } catch (error) {
      console.error('Error searching universities:', error);
      if (requestId === searchRequestId) {
        universities = [];
      }
    } finally {
      if (requestId === searchRequestId) {
        isSearchingUniversities = false;
      }
    }
  };

  const handleUniversityQueryChange = () => {
    clearTimeout(searchTimeout);
    searchRequestId++;
    const currentRequestId = searchRequestId;

    searchTimeout = setTimeout(() => {
      searchUniversities(universityQuery, currentRequestId);
    }, 150);
  };

  const selectUniversity = (university: University, campus: Campus) => {
    location = {
      name: `${university.name}${campus.name ? ` (${campus.name})` : ''}`,
      latitude: campus.location.coordinates[1],
      longitude: campus.location.coordinates[0],
      confirmed: true
    };
    universityQuery = location.name;
    universities = [];
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
        query: query,
        location: mapInstance.getCenter() || undefined,
        radius: 50000 // 50km radius for search
      };

      service.textSearch(request, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          places = results.slice(0, 5); // Limit to 5 results
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

  // Reset selections when mode changes
  $effect(() => {
    if (mode === 0) {
      // Reset location for "My Location" mode
      location = null;
      locationError = '';
    } else if (mode === 1) {
      // Reset for university mode
      location = null;
      universityQuery = '';
      universities = [];
    } else if (mode === 2) {
      // Reset for map mode
      location = null;
      placeQuery = '';
      places = [];
    }
  });

  $effect(() => {
    if (tencentMaps) {
      const handleMessage = (event: MessageEvent) => {
        untrack(async () => {
          var loc = event.data;
          if (loc && loc.module == 'locationPicker') {
            console.debug('Received location from map iframe:', loc);
            location = {
              name: loc.poiname,
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
    if (googleMaps) {
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
        location = {
          name: placeQuery || '',
          latitude: center.lat(),
          longitude: center.lng(),
          confirmed: false
        };
        await convertCoordinates(location, amap);
        location.confirmed = true;
      });

      return () => {
        google.maps.event.clearInstanceListeners(map);
        mapInstance = null;
      };
    }
  });

  const handleGo = () => {
    if (location) {
      go(false);
    }
  };

  const go = async (convert: boolean = true) => {
    if (!location) return;
    isLoading = true;

    if (convert) {
      await convertCoordinates(location, amap);
    }

    goto(
      resolve('/(main)/discover') +
        `?latitude=${location.latitude}&longitude=${location.longitude}&radius=${radius}${location.name ? `&name=${encodeURIComponent(location.name)}` : ''}`
    );
  };

  const assignAMap = (event: CustomEventInit<typeof AMap>) => {
    amap = event.detail;
  };

  const handleLeave = async (shop: { source: string; id: number }) => {
    isLeavingShop = true;
    try {
      const response = await fetch(fromPath(`/api/shops/${shop.source}/${shop.id}/attendance`), {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to leave');
      }

      await invalidateAll();
    } catch (error) {
      console.error('Error leaving:', error);
      // TODO: Show error toast
    } finally {
      isLeavingShop = false;
    }
  };

  onMount(() => {
    window.addEventListener('amap-loaded', assignAMap);

    const interval = setInterval(() => {
      now = new Date();
    }, 1000);

    const savedRadius = localStorage.getItem('nearcade-radius');
    if (savedRadius) {
      const parsedRadius = parseInt(savedRadius);
      if (RADIUS_OPTIONS.includes(parsedRadius)) {
        radius = parsedRadius;
      }
    }

    return () => {
      window.removeEventListener('amap-loaded', assignAMap);
      clearInterval(interval);
    };
  });
</script>

<svelte:head>
  <title>{m.app_name()}</title>
  <meta name="description" content={m.greeting()} />
  <meta property="og:title" content={m.app_name()} />
  <meta property="og:description" content={m.greeting()} />
  <meta name="twitter:title" content={m.app_name()} />
  <meta name="twitter:description" content={m.greeting()} />
</svelte:head>

<div class="hero from-base-200 via-base-100 to-base-200 relative min-h-screen bg-linear-to-br">
  <div class="absolute top-4 right-4 z-10 flex items-center gap-0.5 md:gap-1 lg:gap-2">
    <LocaleSwitch />
    <FancyButton
      callback={() => {
        window.dispatchEvent(new CustomEvent('nearcade-donate'));
      }}
      class="fa-solid fa-heart fa-lg"
      text={m.donate()}
      stayExpandedOnWideScreens
    />
    <FancyButton
      href={resolve('/globe')}
      class="fa-solid fa-globe fa-lg"
      text={m.globe()}
      stayExpandedOnWideScreens
    />
    <FancyButton
      href={resolve('/(main)/rankings')}
      class="fa-solid fa-trophy fa-lg"
      text={m.campus_rankings()}
      stayExpandedOnWideScreens
    />
    <AuthModal size="lg" />
  </div>

  <div class="hero-content my-10 text-center not-sm:px-0">
    <div class="flex max-w-fit flex-col gap-6">
      <SiteTitle
        class="text-6xl sm:text-8xl xl:text-9xl {getLocale() === 'zh'
          ? 'xs:px-10 sm:px-14 md:px-18'
          : ''}"
      />
      <p class="text-base-content/80 mx-auto mb-4 text-xl leading-relaxed sm:text-2xl">
        {m.greeting()}
      </p>

      <div class="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          class="btn btn-primary grow py-5 shadow-none hover:shadow-lg dark:shadow-neutral-700/70"
          onclick={() => {
            showCollapse = !showCollapse;
          }}
        >
          {m.discover()}
          <span class="transition {showCollapse ? '-rotate-180' : 'rotate-0'}">
            <i class="fa-solid fa-angle-down fa-sm"></i>
          </span>
        </button>
        <div class="join not-sm:w-full">
          <FancyButton
            href={resolve('/(main)/shops')}
            class="fa-solid fa-gamepad fa-lg"
            btnCls="not-sm:flex-1 not-sm:hover:flex-2 btn-soft hover:bg-primary join-item hover:text-primary-content py-5 text-nowrap sm:gap-2 dark:hover:bg-white dark:hover:text-black"
            text={m.find_arcades()}
            square={false}
            padding={8}
          />
          <FancyButton
            href={resolve('/(main)/universities')}
            class="fa-solid fa-graduation-cap fa-lg"
            btnCls="not-sm:flex-1 not-sm:hover:flex-2 btn-soft hover:bg-primary join-item hover:text-primary-content py-5 text-nowrap sm:gap-2 dark:hover:bg-white dark:hover:text-black"
            text={m.find_universities()}
            square={false}
            padding={8}
          />
          <FancyButton
            href={resolve('/(main)/clubs')}
            class="fa-solid fa-users fa-lg"
            btnCls="not-sm:flex-1 not-sm:hover:flex-2 btn-soft hover:bg-primary join-item hover:text-primary-content py-5 text-nowrap sm:gap-2 dark:hover:bg-white dark:hover:text-black"
            text={m.find_clubs()}
            square={false}
            padding={8}
          />
        </div>
      </div>
      <div
        class="bg-base-200/60 dark:bg-base-200/90 bg-opacity-30 collapse-transition border-base-300 collapse -mt-5 h-0 rounded-xl border shadow-none backdrop-blur-2xl hover:shadow-lg dark:border-neutral-700 dark:shadow-neutral-700/70"
        class:collapse-open={showCollapse}
        class:min-h-fit={showCollapse}
        class:h-full={showCollapse}
        class:mt-0={showCollapse}
        class:opacity-0={!showCollapse}
      >
        <div class="collapse-content flex flex-col items-center gap-4" class:pt-4={showCollapse}>
          <fieldset class="fieldset rounded-box w-full p-4 pt-2" class:not-sm:px-0={mode === 2}>
            <div class="flex flex-col gap-1 sm:hidden">
              <span class="label w-full">{m.discover_from()}</span>
              <select class="select w-full" bind:value={mode}>
                <option value={0}>{m.my_location()}</option>
                <option value={1}>{m.a_university()}</option>
                <option value={2}>{m.a_place_on_map()}</option>
              </select>
            </div>
            <div class="hidden sm:block">
              <span class="label w-full">{m.discover_from()}</span>
              <div class="tabs tabs-border mb-1 w-full">
                <button
                  class="tab flex-1 flex-nowrap whitespace-nowrap transition"
                  class:tab-active={mode === 0}
                  onclick={() => (mode = 0)}
                >
                  <i class="fa-solid fa-location-dot mr-2"></i>
                  {m.my_location()}
                </button>
                <button
                  class="tab flex-1 flex-nowrap whitespace-nowrap transition"
                  class:tab-active={mode === 1}
                  onclick={() => (mode = 1)}
                >
                  <i class="fa-solid fa-graduation-cap mr-2"></i>
                  {m.a_university()}
                </button>
                <button
                  class="tab flex-1 flex-nowrap whitespace-nowrap transition"
                  class:tab-active={mode === 2}
                  onclick={() => (mode = 2)}
                >
                  <i class="fa-solid fa-map-location-dot mr-2"></i>
                  {m.a_place_on_map()}
                </button>
              </div>
            </div>

            <div class="flex flex-col gap-1 sm:hidden">
              <span class="label mt-1 w-full">{m.search_radius()}</span>
              <select class="select w-full" bind:value={radius}>
                {#each RADIUS_OPTIONS as r (r)}
                  <option value={r}>{r} km</option>
                {/each}
              </select>
            </div>
            <div class="hidden sm:block">
              <span class="label my-1 flex w-full items-center justify-between">
                <span>{m.search_radius()}</span>
                <span class="text-sm font-medium">{radius} km</span>
              </span>
              <input
                type="range"
                min={0}
                max={RADIUS_OPTIONS.length - 1}
                step="1"
                class="range range-sm range-nuetral w-full"
                value={RADIUS_OPTIONS.indexOf(radius)}
                oninput={(e) => {
                  const target = e.target as HTMLInputElement;
                  if (target) {
                    radius = RADIUS_OPTIONS[parseInt(target.value)];
                  }
                }}
              />
              <div
                class="mt-1 flex w-full justify-between text-xs leading-tight font-light opacity-50 md:leading-snug lg:leading-normal"
              >
                {#each RADIUS_OPTIONS as r, i (r)}
                  <span
                    class:opacity-100={i === 0 ||
                      i === RADIUS_OPTIONS.length - 1 ||
                      i === Math.floor(RADIUS_OPTIONS.length / 2)}>{r} km</span
                  >
                {/each}
              </div>
            </div>

            {#if mode === 0}
              {#if locationError}
                <div class="alert alert-error mt-2 text-sm">
                  <i class="fa-solid fa-exclamation-triangle"></i>
                  {locationError}
                </div>
              {/if}
              <button
                class="btn btn-primary mt-3"
                onclick={async () => {
                  isLoadingLocation = true;
                  locationError = '';
                  try {
                    const loc = await getMyLocation();
                    location = {
                      name: m.my_location(),
                      latitude: loc.latitude,
                      longitude: loc.longitude,
                      confirmed: false
                    };
                    go();
                  } catch (error) {
                    console.error('Error getting location:', error);
                    locationError = typeof error === 'string' ? error : m.location_unknown_error();
                  } finally {
                    isLoadingLocation = false;
                  }
                }}
                disabled={isLoadingLocation || isLoading}
              >
                {#if isLoading}
                  <span class="loading loading-spinner loading-sm"></span>
                  {m.loading()}
                {:else if isLoadingLocation}
                  <span class="loading loading-spinner loading-sm"></span>
                  {m.getting_location()}
                {:else}
                  <i class="fa-solid fa-location-dot"></i>
                  {m.get_my_location()}
                {/if}
              </button>
            {:else if mode === 1}
              <div class="flex flex-col gap-1">
                <span class="label mt-1 w-full">{m.university()}</span>
                <input
                  type="text"
                  placeholder={m.search_university()}
                  class="input w-full pr-10"
                  bind:value={universityQuery}
                  oninput={handleUniversityQueryChange}
                />
              </div>
              <div
                class="mt-3 w-[65vw] max-w-md min-w-full space-y-3 sm:w-[60vw] md:w-[55vw] lg:w-[50vw]"
              >
                {#if isSearchingUniversities}
                  <span class="loading loading-spinner loading-sm"></span>
                {/if}
                {#if universities.length > 0}
                  <div
                    class="bg-base-100 border-base-300 max-h-[40vh] w-full overflow-y-auto rounded-lg border shadow-none transition hover:shadow-lg dark:border-neutral-700 dark:shadow-neutral-700/70"
                  >
                    {#each universities as university (university.name)}
                      <div id={university.name} class="border-base-200 border-b last:border-b-0">
                        {#if university.campuses.length === 1}
                          {@const campus = university.campuses[0]}
                          <button
                            class="hover:bg-base-200 flex w-full items-center justify-between p-3 text-left transition-colors"
                            onclick={(e) => {
                              // Prevent button action if <a> was clicked
                              if ((e.target as Element).closest('a')) return;
                              selectUniversity(university, university.campuses[0]);
                            }}
                          >
                            <div>
                              <a
                                href={resolve('/(main)/universities/[id]', {
                                  id: university.slug || university.id
                                })}
                                target={adaptiveNewTab()}
                                class="hover:text-accent text-base font-medium transition-colors"
                              >
                                {university.name}
                              </a>
                              <div class="text-base-content/60 text-sm">
                                {university.type} · {university.majorCategory} ·
                                <span class="not-sm:hidden">
                                  {formatRegionLabel(campus, true, '')}
                                </span>
                                <span class="sm:hidden">
                                  {formatRegionLabel(campus, false, '')}
                                </span>
                              </div>
                            </div>
                            <i class="fa-solid fa-chevron-right fa-sm opacity-50"></i>
                          </button>
                        {:else}
                          <div class="p-3">
                            <div>
                              <a
                                href={resolve('/(main)/universities/[id]', {
                                  id: university.slug || university.id
                                })}
                                target={adaptiveNewTab()}
                                class="hover:text-accent text-base font-medium transition-colors"
                                >{university.name}</a
                              >
                              <div class="text-base-content/60 text-sm">
                                {university.type} · {university.majorCategory} ·
                                {m.campus_count({
                                  count: university.campuses.length
                                })}
                              </div>
                            </div>
                            <div class="mt-2 space-y-1">
                              {#each university.campuses as campus (campus.id)}
                                <button
                                  id="{university.name}-{campus.name}"
                                  class="hover:bg-base-200 flex w-full items-center justify-between rounded-lg px-4 py-2 text-left transition-colors"
                                  onclick={() => selectUniversity(university, campus)}
                                >
                                  <div class="flex items-center gap-2 text-sm">
                                    <i class="fa-solid fa-building fa-sm opacity-50"></i>
                                    <span>{campus.name || m.main_campus()}</span>
                                    <span class="text-base-content/60 text-xs not-sm:hidden"
                                      >{formatRegionLabel(campus, true)}</span
                                    >
                                    <span class="text-base-content/60 text-xs sm:hidden"
                                      >{formatRegionLabel(campus, false)}</span
                                    >
                                  </div>
                                  <i class="fa-solid fa-chevron-right fa-xs opacity-50"></i>
                                </button>
                              {/each}
                            </div>
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
                <div role="alert" class="alert alert-warning">
                  <i class="fa-solid fa-triangle-exclamation fa-lg"></i>
                  <span>{m.university_warning()}</span>
                </div>
              </div>
            {:else if mode === 2}
              <div
                class="ss:w-[89vw] relative mt-3 w-[85vw] max-w-6xl min-w-full sm:w-[75vw] md:w-[65vw] lg:w-[50vw]"
              >
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
                            class="hover:bg-base-300 flex w-full cursor-pointer items-start gap-3 border-b border-current/10 px-4 py-3 text-left transition-colors last:border-b-0"
                            onclick={() => selectPlace(place)}
                          >
                            <i class="fa-solid fa-location-dot mt-1 opacity-50"></i>
                            <div class="min-w-0 flex-1">
                              <div class="text-base font-medium">{place.name}</div>
                              <div class="text-base-content/60 text-sm">
                                {place.formatted_address}
                              </div>
                            </div>
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
                <div class="relative h-[80vh]">
                  <button
                    class="btn btn-outline btn-circle not-hover:bg-base-300/25 absolute right-3 bottom-5 z-10 border-current/0 backdrop-blur-lg"
                    style="--size: 2.6rem"
                    class:btn-neutral={!useGoogleMaps}
                    class:not-dark:btn-neutral={useGoogleMaps}
                    aria-label={useGoogleMaps ? m.use_tencent_maps() : m.use_google_maps()}
                    title={useGoogleMaps ? m.use_tencent_maps() : m.use_google_maps()}
                    onclick={() => (useGoogleMaps = !useGoogleMaps)}
                  >
                    {#if useGoogleMaps}
                      <i class="fa-brands fa-qq fa-lg"></i>
                    {:else}
                      <i class="fa-brands fa-google fa-lg"></i>
                    {/if}
                  </button>
                  {#if useGoogleMaps}
                    <div
                      id="gmap"
                      bind:this={googleMaps}
                      title={m.map_location_picker()}
                      class="h-full w-full rounded-xl border"
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
                      id="qmap"
                      frameborder="0"
                      bind:this={tencentMaps}
                      title={m.map_location_picker()}
                      class="h-full w-full rounded-xl border"
                      src="https://apis.map.qq.com/tools/locpicker?search=1&type=1&key={PUBLIC_TENCENT_MAPS_KEY}&referer=nearcade"
                    >
                    </iframe>
                  {/if}
                </div>
              </div>
            {/if}
            {#if mode !== 0}
              {#if location}
                <div
                  class="alert alert-soft mt-3 text-sm transition-colors {location.confirmed
                    ? 'alert-success'
                    : 'alert-warning'}"
                >
                  <i class="fa-solid fa-location-dot fa-lg"></i>
                  <div>
                    <h3 class="font-bold">{location.name || m.selected_location()}</h3>
                    <div class="text-sm">
                      ({location.longitude.toFixed(6)}, {location.latitude.toFixed(6)})
                    </div>
                  </div>
                </div>
              {/if}
              <button
                class="btn btn-primary mt-3"
                disabled={!location || isLoading}
                onclick={handleGo}
              >
                {#if isLoading}
                  <span class="loading loading-spinner loading-sm"></span>
                  {m.loading()}
                {:else}
                  {m.go()}
                {/if}
              </button>
            {/if}
          </fieldset>
        </div>
      </div>

      <!-- Starred Shops Real-time Attendance -->
      {#if data.starredShops.length > 0}
        <div
          class="bg-base-200/60 dark:bg-base-200/90 bg-opacity-30 collapse-transition border-base-300 collapse -mt-5 h-0 rounded-xl border shadow-none backdrop-blur-2xl hover:shadow-lg dark:border-neutral-700 dark:shadow-neutral-700/70"
          class:collapse-open={!showCollapse}
          class:min-h-fit={!showCollapse}
          class:h-full={!showCollapse}
          class:mt-0={!showCollapse}
          class:opacity-0={showCollapse}
        >
          <div
            class="collapse-content flex max-w-full min-w-full flex-col items-center gap-2 sm:max-w-[80vw] md:max-w-[70vw] lg:max-w-[60vw]"
            class:pt-4={!showCollapse}
          >
            {#each data.starredShops as shop (shop._id)}
              {@const openingHours = getShopOpeningHours(shop)}
              {@const isShopOpen =
                openingHours &&
                now >= openingHours.openTolerated &&
                now <= openingHours.closeTolerated}
              {@const isInAttendance = (shop as { isInAttendance?: boolean }).isInAttendance}
              <div
                class="bg-base-100 hover:border-primary w-full rounded-lg border border-current/0 px-3 py-2 text-start transition hover:shadow-md {isInAttendance
                  ? 'border-warning hover:border-warning/50 bg-linear-to-br from-orange-600/30 via-amber-600/30 to-yellow-500/30 hover:from-orange-600/10 hover:via-amber-600/10 hover:to-yellow-500/10'
                  : ''}"
              >
                <a
                  href={resolve('/(main)/shops/[source]/[id]', {
                    source: shop.source,
                    id: shop.id.toString()
                  })}
                  class="flex items-center justify-between gap-4"
                >
                  <div class="min-w-0 flex-1">
                    <h3
                      class="truncate text-base font-semibold"
                      class:text-warning={isInAttendance}
                    >
                      {shop.name}
                    </h3>
                    <p class="text-base-content/70 truncate text-xs">
                      {formatShopAddress(shop)}
                    </p>
                  </div>
                  {#if isInAttendance}
                    <button
                      class="btn btn-error btn-soft btn-sm"
                      disabled={isLeavingShop}
                      onclick={(e) => {
                        e.preventDefault();
                        handleLeave(shop);
                      }}
                    >
                      {#if isLeavingShop}
                        <span class="loading loading-spinner loading-xs"></span>
                      {:else}
                        <i class="fa-solid fa-stop"></i>
                      {/if}
                      {m.leave()}
                    </button>
                  {:else if isShopOpen}
                    {@const currentAttendance = shop.totalAttendance || 0}
                    {@const reportedAttendance = shop.currentReportedAttendance}
                    <div class="text-right">
                      {#if reportedAttendance}
                        <AttendanceReportBlame {reportedAttendance} class="tooltip-left">
                          <div class="text-accent text-sm not-sm:hidden">
                            {m.in_attendance({ count: currentAttendance })}
                          </div>
                          <div class="text-accent text-sm sm:hidden">
                            <i class="fa-solid fa-user"></i>
                            {currentAttendance}
                          </div>
                        </AttendanceReportBlame>
                      {:else}
                        <div
                          class="text-base-content/60 text-sm not-sm:hidden"
                          class:text-primary={currentAttendance > 0}
                        >
                          {m.in_attendance({ count: currentAttendance })}
                        </div>
                        <div
                          class="text-base-content/60 text-sm sm:hidden"
                          class:text-primary={currentAttendance > 0}
                        >
                          <i class="fa-solid fa-user"></i>
                          {currentAttendance}
                        </div>
                      {/if}
                    </div>
                  {:else}
                    <div class="text-error text-sm">{m.closed()}</div>
                  {/if}
                </a>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>

  <div class="absolute right-4 bottom-4 flex items-center gap-0.5 md:gap-1 lg:gap-2">
    <FancyButton
      href={GITHUB_LINK}
      target="_blank"
      class="fa-brands fa-github fa-lg"
      text="GitHub"
      stayExpandedOnWideScreens
    />
    <SocialMediaModal
      name="QQ"
      class="fa-brands fa-qq fa-lg"
      description={m.qq_description()}
      image="{base}/group-chat-qq.jpg"
    />
    <ThemeSwitch />
  </div>
</div>

<style lang="postcss">
  @reference "tailwindcss";

  .tabs-border .tab:before {
    width: 100%;
    left: 0;
  }
  .collapse-transition {
    transition-property: grid-template-rows, height, opacity, border-color, box-shadow, margin-top;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 300ms, 300ms, 300ms, 150ms, 150ms, 300ms;
  }

  :global(gmp-internal-camera-control) {
    @apply -translate-y-10;
  }
</style>
