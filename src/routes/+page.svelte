<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve, base } from '$app/paths';
  import { PUBLIC_QQMAP_KEY } from '$env/static/public';
  import { GITHUB_LINK } from '$lib';
  import AuthModal from '$lib/components/AuthModal.svelte';
  import FancyButton from '$lib/components/FancyButton.svelte';
  import LocaleSwitch from '$lib/components/LocaleSwitch.svelte';
  import SiteTitle from '$lib/components/SiteTitle.svelte';
  import SocialMediaModal from '$lib/components/SocialMediaModal.svelte';
  import { m } from '$lib/paraglide/messages';
  import type { AMapContext, Campus, University } from '$lib/types';
  import { formatRegionLabel } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import { getContext, untrack, onMount } from 'svelte';

  let showCollapse = $state(false);
  let mode = $state(0);
  let radius = $state(10);
  let location = $state({
    name: '',
    latitude: undefined as number | undefined,
    longitude: undefined as number | undefined
  });

  const RADIUS_OPTIONS = [1, 2, 5, 10, 15, 20, 25, 30];

  onMount(() => {
    const savedRadius = localStorage.getItem('nearcade-radius');
    if (savedRadius) {
      const parsedRadius = parseInt(savedRadius);
      if (RADIUS_OPTIONS.includes(parsedRadius)) {
        radius = parsedRadius;
      }
    }
  });

  $effect(() => {
    if (browser) {
      localStorage.setItem('nearcade-radius', radius.toString());
    }
  });
  let isLoadingLocation = $state(false);
  let isLoading = $state(false);
  let locationError = $state('');
  let mapIframe = $state<HTMLIFrameElement>();
  let amap: typeof AMap | undefined = $state(getContext<AMapContext>('amap')?.amap);

  let universityQuery = $state('');
  let universities = $state<University[]>([]);
  let isSearchingUniversities = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | undefined;

  const getMyLocation = () => {
    if (!navigator.geolocation) {
      locationError = m.location_not_supported();
      return;
    }

    isLoadingLocation = true;
    locationError = '';

    navigator.geolocation.getCurrentPosition(
      // Success callback
      (position) => {
        location.name = m.my_location();
        location.latitude = position.coords.latitude;
        location.longitude = position.coords.longitude;
        isLoadingLocation = false;
        go();
      },
      // Error callback
      (error) => {
        isLoadingLocation = false;
        switch (error.code) {
          case error.PERMISSION_DENIED:
            locationError = m.location_permission_denied();
            break;
          case error.POSITION_UNAVAILABLE:
            locationError = m.location_unavailable();
            break;
          case error.TIMEOUT:
            locationError = m.location_timeout();
            break;
          default:
            locationError = m.location_unknown_error();
            break;
        }
        console.error('Geolocation error:', error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  };

  let searchRequestId = $state(0);

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
    location.name = `${university.name}${campus.name ? ` (${campus.name})` : ''}`;
    location.latitude = campus.location.coordinates[1];
    location.longitude = campus.location.coordinates[0];
    universityQuery = location.name;
    universities = [];
  };

  // Reset selections when mode changes
  $effect(() => {
    if (mode === 0) {
      // Reset location for "My Location" mode
      location.name = m.my_location();
      location.latitude = undefined;
      location.longitude = undefined;
      locationError = '';
    } else if (mode === 1) {
      // Reset for university mode
      location.name = '';
      location.latitude = undefined;
      location.longitude = undefined;
      universityQuery = '';
      universities = [];
    } else if (mode === 2) {
      // Reset for map mode
      location.name = '';
      location.latitude = undefined;
      location.longitude = undefined;
    }
  });

  $effect(() => {
    if (mapIframe) {
      const handleMessage = (event: MessageEvent) => {
        untrack(async () => {
          var loc = event.data;
          if (loc && loc.module == 'locationPicker') {
            console.debug('Received location from map iframe:', loc);
            location.name = loc.poiname;
            location.latitude = loc.latlng.lat;
            location.longitude = loc.latlng.lng;
          }
        });
      };

      window.addEventListener('message', handleMessage, false);

      return () => {
        window.removeEventListener('message', handleMessage, false);
      };
    }
  });

  const handleGo = () => {
    if (location.latitude && location.longitude) {
      go(false);
    }
  };

  const go = async (convert: boolean = true) => {
    isLoading = true;

    if (convert) {
      if (amap && location.latitude !== undefined && location.longitude !== undefined) {
        await new Promise<void>((resolve, reject) => {
          amap!.convertFrom(
            [location.longitude, location.latitude],
            'gps',
            (
              status: string,
              response: { info: string; locations: { lat: number; lng: number }[] }
            ) => {
              if (status === 'complete' && response.info === 'ok') {
                const result = response.locations[0];
                location.latitude = result.lat;
                location.longitude = result.lng;
                resolve();
              } else {
                console.error('AMap conversion failed:', status, response);
                reject(new Error('AMap conversion failed'));
              }
            }
          );
        });
      } else {
        console.warn('AMap not available or location not set, skipping conversion');
      }
    }

    goto(
      resolve('/(main)/discover') +
        `?latitude=${location.latitude}&longitude=${location.longitude}&radius=${radius}${location.name ? `&name=${encodeURIComponent(location.name)}` : ''}`
    );
  };

  const assignAMap = (event: CustomEventInit<typeof AMap>) => {
    amap = event.detail;
  };

  onMount(() => {
    if (browser) {
      window.addEventListener('amap-loaded', assignAMap);
      return () => {
        window.removeEventListener('amap-loaded', assignAMap);
      };
    }
  });
</script>

<svelte:head>
  <title>{m.app_name()}</title>
</svelte:head>

<div class="hero from-base-200 via-base-100 to-base-200 relative min-h-screen bg-gradient-to-br">
  <div class="absolute top-4 right-4 z-10 flex items-center gap-0.5 md:gap-1 lg:gap-2">
    <LocaleSwitch />
    <FancyButton
      callback={() => {
        window.dispatchEvent(new CustomEvent('nearcade-donate'));
      }}
      class="fa-solid fa-heart fa-lg"
      text={m.donate()}
    />
    <FancyButton
      href={resolve('/(main)/rankings')}
      class="fa-solid fa-trophy fa-lg"
      text={m.campus_rankings()}
    />
    <AuthModal size="lg" />
  </div>

  <div class="hero-content my-10 text-center">
    <div class="flex max-w-fit flex-col gap-6">
      <SiteTitle class="text-6xl sm:text-8xl xl:text-9xl" />
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
        <div class="join">
          <a
            href={resolve('/(main)/universities')}
            class="btn btn-soft hover:bg-primary join-item hover:text-primary-content flex-1 gap-2 py-5 text-nowrap sm:px-6 dark:hover:bg-white dark:hover:text-black"
          >
            {m.find_university()}
            <i class="fa-solid fa-graduation-cap fa-lg"></i>
          </a>
          <a
            href={resolve('/(main)/clubs')}
            class="btn btn-soft hover:bg-primary join-item hover:text-primary-content flex-1 gap-2 py-5 text-nowrap sm:px-6 dark:hover:bg-white dark:hover:text-black"
          >
            {m.find_clubs()}
            <i class="fa-solid fa-users fa-lg"></i>
          </a>
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
        <div
          class="collapse-content flex flex-col items-center gap-4 pt-0 transition-[padding] duration-300"
          class:pt-4={showCollapse}
        >
          <fieldset class="fieldset rounded-box w-full p-4 pt-2">
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
                onclick={getMyLocation}
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
                                target="_blank"
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
                                target="_blank"
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
              <div class="mt-3">
                <iframe
                  id="mapPage"
                  frameborder="0"
                  bind:this={mapIframe}
                  title={m.map_location_picker()}
                  class="h-[80vh] w-[75vw] min-w-full rounded-xl border sm:w-[70vw] md:w-[65vw] lg:w-[50vw]"
                  src="https://apis.map.qq.com/tools/locpicker?search=1&type=1&key={PUBLIC_QQMAP_KEY}&referer=nearcade"
                >
                </iframe>
              </div>
            {/if}
            {#if mode !== 0}
              <button
                class="btn btn-primary mt-3"
                disabled={!(location.latitude && location.longitude) || isLoading}
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
    </div>
  </div>
  <div class="absolute right-4 bottom-4 flex items-center gap-0.5 md:gap-1 lg:gap-2">
    <FancyButton
      href={GITHUB_LINK}
      target="_blank"
      class="fa-brands fa-github fa-lg"
      text="GitHub"
    />
    <SocialMediaModal
      name="QQ"
      class="fa-brands fa-qq fa-lg"
      description={m.qq_description()}
      image="{base}/group-chat-qq.jpg"
    />
  </div>
</div>

<style>
  .tabs-border .tab:before {
    width: 100%;
    left: 0;
  }
  .collapse-transition {
    transition-property: grid-template-rows, height, opacity, border-color, box-shadow, margin-top;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 300ms, 300ms, 300ms, 150ms, 150ms, 300ms;
  }
</style>
