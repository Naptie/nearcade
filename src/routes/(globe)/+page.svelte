<script lang="ts">
  import { browser } from '$app/environment';
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve, base } from '$app/paths';
  import { GITHUB_LINK } from '$lib';
  import AuthModal from '$lib/components/AuthModal.svelte';
  import FancyButton from '$lib/components/FancyButton.svelte';
  import LocationPickerModal from '$lib/components/LocationPickerModal.svelte';
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
  import { fromPath } from '$lib/utils/scoped';
  import { viewport } from '$lib/utils/viewport.svelte';
  import { getContext, onMount } from 'svelte';
  import type { PageData } from './$types';
  import AttendanceReportBlame from '$lib/components/AttendanceReportBlame.svelte';
  import { fade, slide } from 'svelte/transition';

  import { IS_ANDROID_OR_IOS, IS_LOW_DATA } from '$lib/utils/index.client';
  import { env } from '$env/dynamic/public';
  import { page } from '$app/state';
  import { LIMIT_OPTIONS, RADIUS_OPTIONS } from '$lib/constants';
  import { SvelteURLSearchParams } from 'svelte/reactivity';

  let { data }: { data: PageData } = $props();

  let isLeavingShop = $state(false);

  let showCollapse = $state(false);
  let starredReady = $state(false);
  let mode = $state(0);
  let radius = $state(
    browser
      ? (() => {
          const v = parseInt(localStorage.getItem('nearcade-radius') || '');
          return RADIUS_OPTIONS.includes(v as (typeof RADIUS_OPTIONS)[number]) ? v : 10;
        })()
      : 10
  );
  let limit = $state(
    browser
      ? (() => {
          const v = parseInt(localStorage.getItem('nearcade-result-count') || '');
          return LIMIT_OPTIONS.includes(v as (typeof LIMIT_OPTIONS)[number]) ? v : 20;
        })()
      : 20
  );
  let location = $state<{
    name: string;
    latitude: number;
    longitude: number;
    confirmed: boolean;
  } | null>(null);

  const showIcpLicense =
    env.PUBLIC_ICP_LICENSE_ENABLED_ORIGINS?.split(',').includes(page.url.origin) &&
    env.PUBLIC_ICP_LICENSE;

  $effect(() => {
    if (browser) {
      localStorage.setItem('nearcade-radius', radius.toString());
      localStorage.setItem('nearcade-result-count', limit.toString());
    }
  });
  let isLoadingLocation = $state(false);
  let isLoading = $state(false);
  let locationError = $state('');
  let isLocationPickerOpen = $state(false);
  let amap: typeof AMap | undefined = $state(getContext<AMapContext>('amap')?.amap);

  let universityQuery = $state('');
  let universities = $state<University[]>([]);
  let isSearchingUniversities = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | undefined;
  let searchRequestId = $state(0);

  let showGlobe = $state(browser && !IS_ANDROID_OR_IOS && !IS_LOW_DATA);
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

    const params = new SvelteURLSearchParams({
      latitude: location.latitude.toString(),
      longitude: location.longitude.toString(),
      radius: radius.toString(),
      limit: limit.toString()
    });

    if (location.name) {
      params.set('name', location.name);
    }

    goto(resolve('/(main)/discover') + `?${params.toString()}`);
  };

  const assignAMap = (event: CustomEventInit<typeof AMap>) => {
    amap = event.detail;
  };

  const handleLeave = async (shop: { id: number }) => {
    isLeavingShop = true;
    try {
      const response = await fetch(fromPath(`/api/shops/${shop.id}/attendance`), {
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

    // Defer the heavy starred-shops list until after the initial mount so
    // the globe -> landing transition isn't blocked by it.
    const starredTimer = setTimeout(() => {
      starredReady = true;
    }, 100);

    // Clean up any leftover exit-transition class from a previous navigation
    document.documentElement.classList.remove('globe-exiting-landing');
    document.documentElement.classList.remove('globe-exiting-to-landing');
    document.getElementById('globe-root')?.classList.remove('globe-exiting-landing');

    return () => {
      window.removeEventListener('amap-loaded', assignAMap);
      clearInterval(interval);
      clearTimeout(starredTimer);
    };
  });
</script>

<svelte:head>
  <title>{m.app_name()} | {m.greeting()}</title>
  <meta name="description" content={m.meta_description_home()} />
  <meta property="og:title" content={m.app_name()} />
  <meta property="og:description" content={m.meta_description_home()} />
  <meta name="twitter:title" content={m.app_name()} />
  <meta name="twitter:description" content={m.meta_description_home()} />
</svelte:head>

<!-- Landing page content sits above the fixed globe background (z-0).
     Outer containers are pointer-events-none so empty areas pass clicks through
     to the globe canvas; only the interactive children opt back in. -->
<div class="relative" class:pointer-events-none={!showCollapse}>
  <div class="hero min-h-screen">
    <div
      class="hero-top-bar bg-base-100/50 pointer-events-auto absolute top-4 right-4 z-10 flex items-center gap-0.5 rounded-full backdrop-blur-lg md:gap-1 lg:gap-2"
      in:fade={{ delay: 300, duration: 400 }}
      out:fade={{ duration: 300 }}
    >
      <LocaleSwitch />
      <button
        type="button"
        class="btn btn-ghost btn-sm lg:btn-md flex items-center gap-2"
        onclick={() => {
          window.dispatchEvent(new CustomEvent('nearcade-donate'));
        }}
      >
        <i class="fa-solid fa-heart fa-lg"></i>
        <span class="hidden lg:inline">{m.donate()}</span>
      </button>
      <a href={resolve('/globe')} class="btn btn-ghost btn-sm lg:btn-md flex items-center gap-2">
        <i class="fa-solid fa-globe fa-lg"></i>
        <span class="hidden lg:inline">{m.globe()}</span>
      </a>
      <a
        href={resolve('/(main)/rankings')}
        class="btn btn-ghost btn-sm lg:btn-md flex items-center gap-2"
      >
        <i class="fa-solid fa-trophy fa-lg"></i>
        <span class="hidden lg:inline">{m.campus_rankings()}</span>
      </a>
      <AuthModal size="lg" />
    </div>

    <div
      class="hero-content my-10 text-center not-sm:px-0"
      in:fade={{ delay: 400, duration: 400 }}
      out:fade={{ duration: 300 }}
    >
      <div
        class="xs:w-[97vw] ss:w-[90vw] pointer-events-auto flex w-screen flex-col gap-6 px-8 py-6 transition-all duration-600 sm:max-w-3xl"
        class:mt-72={showGlobe}
      >
        <SiteTitle
          class="title xs:text-5xl ss:text-6xl text-4xl sm:text-8xl xl:text-9xl {showGlobe
            ? 'title-base-content'
            : ''}"
        />
        <p class="text-base-content/80 mx-auto mb-4 text-xl leading-relaxed sm:text-2xl">
          {m.greeting()}
        </p>

        <div class="flex flex-col gap-3 md:flex-row">
          <button
            type="button"
            class="btn btn-primary flex-2 grow basis-0 py-5 shadow-none hover:shadow-lg dark:shadow-neutral-700/70"
            onclick={() => {
              showCollapse = !showCollapse;
            }}
          >
            {m.discover()}
            <span class="transition {showCollapse ? '-rotate-180' : 'rotate-0'}">
              <i class="fa-solid fa-angle-down fa-sm"></i>
            </span>
          </button>
          <div class="flex flex-1 flex-row gap-2">
            <div class="join w-full">
              <a
                href={resolve('/(main)/shops')}
                class="btn btn-soft hover:bg-primary join-item hover:text-primary-content flex flex-1 items-center gap-2 py-5 text-nowrap sm:gap-2 dark:hover:bg-white dark:hover:text-black"
              >
                <i class="fa-solid fa-gamepad fa-lg"></i>
                <span>{m.find_arcades()}</span>
              </a>
              <!-- Desktop: FancyButtons with hover expansion -->
              {#if viewport.sm}
                <FancyButton
                  href={resolve('/(main)/universities')}
                  class="fa-solid fa-graduation-cap fa-lg"
                  btnCls="btn-soft hover:bg-primary join-item hover:text-primary-content py-5 text-nowrap sm:gap-2 dark:hover:bg-white dark:hover:text-black"
                  text={m.find_universities()}
                  expanded={!viewport.md}
                  override={!viewport.md}
                  square={false}
                />
                <FancyButton
                  href={resolve('/(main)/clubs')}
                  class="fa-solid fa-users fa-lg"
                  btnCls="btn-soft hover:bg-primary join-item hover:text-primary-content py-5 text-nowrap sm:gap-2 dark:hover:bg-white dark:hover:text-black"
                  text={m.find_clubs()}
                  expanded={!viewport.md}
                  override={!viewport.md}
                  square={false}
                />
              {:else}
                <!-- Mobile: three-dots dropdown for universities + clubs -->
                <div class="relative">
                  <div class="dropdown dropdown-end">
                    <div
                      tabindex="0"
                      role="button"
                      class="join-item btn btn-soft hover:bg-primary hover:text-primary-content flex items-center gap-2 py-5 text-nowrap not-sm:flex-1 sm:gap-2 dark:hover:bg-white dark:hover:text-black"
                      aria-label={m.more_actions()}
                    >
                      <i class="fa-solid fa-ellipsis fa-lg"></i>
                    </div>
                    <ul
                      tabindex="-1"
                      class="dropdown-content menu bg-base-100 border-base-300 join join-vertical rounded-3xl hover:shadow-lg"
                    >
                      <a
                        href={resolve('/(main)/universities')}
                        class="btn btn-ghost hover:bg-primary join-item hover:text-primary-content flex w-full items-center gap-2 rounded-full px-3 py-2 text-sm text-nowrap dark:hover:bg-white dark:hover:text-black"
                      >
                        <i class="fa-solid fa-graduation-cap"></i>
                        {m.find_universities()}
                      </a>
                      <a
                        href={resolve('/(main)/clubs')}
                        class="btn btn-ghost hover:bg-primary join-item hover:text-primary-content flex w-full items-center gap-2 rounded-full px-3 py-2 text-sm text-nowrap dark:hover:bg-white dark:hover:text-black"
                      >
                        <i class="fa-solid fa-users"></i>
                        {m.find_clubs()}
                      </a>
                    </ul>
                  </div>
                </div>
              {/if}
            </div>
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
            {#if showCollapse}
              <fieldset
                class="fieldset rounded-box w-full p-4 pt-2"
                class:not-sm:px-0={mode === 2}
                transition:slide
              >
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
                    <option value={0}>{m.unlimited()}</option>
                  </select>
                </div>
                <div class="hidden sm:block">
                  <span class="label my-1 flex w-full items-center justify-between">
                    <span>{m.search_radius()}</span>
                    <span class="text-sm font-medium"
                      >{radius === 0 ? m.unlimited() : `${radius} km`}</span
                    >
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={RADIUS_OPTIONS.length}
                    step="1"
                    class="range range-sm range-nuetral w-full"
                    value={radius === 0
                      ? RADIUS_OPTIONS.length
                      : RADIUS_OPTIONS.indexOf(radius as (typeof RADIUS_OPTIONS)[number])}
                    oninput={(e) => {
                      const target = e.target as HTMLInputElement;
                      if (target) {
                        const idx = parseInt(target.value);
                        radius = idx >= RADIUS_OPTIONS.length ? 0 : RADIUS_OPTIONS[idx];
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
                    <span class:opacity-100={radius === 0}>{m.unlimited()}</span>
                  </div>
                </div>

                <div class="flex flex-col gap-1 sm:hidden">
                  <span class="label mt-1 w-full">{m.result_count()}</span>
                  <select class="select w-full" bind:value={limit}>
                    {#each LIMIT_OPTIONS as l (l)}
                      <option value={l}>{l}</option>
                    {/each}
                  </select>
                </div>
                <div class="hidden sm:block">
                  <span class="label my-1 flex w-full items-center justify-between">
                    <span>{m.result_count()}</span>
                    <span class="text-sm font-medium">{limit}</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={LIMIT_OPTIONS.length - 1}
                    step="1"
                    class="range range-sm range-nuetral w-full"
                    value={LIMIT_OPTIONS.indexOf(limit as (typeof LIMIT_OPTIONS)[number])}
                    oninput={(e) => {
                      const target = e.target as HTMLInputElement;
                      if (target) {
                        limit = LIMIT_OPTIONS[parseInt(target.value)];
                      }
                    }}
                  />
                  <div
                    class="mt-1 flex w-full justify-between text-xs leading-tight font-light opacity-50 md:leading-snug lg:leading-normal"
                  >
                    {#each LIMIT_OPTIONS as l, i (l)}
                      <span
                        class:opacity-100={i === 0 ||
                          i === LIMIT_OPTIONS.length - 1 ||
                          i === Math.floor(LIMIT_OPTIONS.length / 2)}>{l}</span
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
                        locationError =
                          typeof error === 'string' ? error : m.location_unknown_error();
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
                  <div class="mt-3 space-y-3">
                    {#if isSearchingUniversities}
                      <span class="loading loading-spinner loading-sm"></span>
                    {/if}
                    {#if universities.length > 0}
                      <div
                        class="bg-base-100 border-base-300 max-h-[40vh] w-full overflow-y-auto rounded-lg border shadow-none transition hover:shadow-lg dark:border-neutral-700 dark:shadow-neutral-700/70"
                      >
                        {#each universities as university (university.name)}
                          <div
                            id={university.name}
                            class="border-base-200 border-b last:border-b-0"
                          >
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
                  <div class="mt-3 flex w-full justify-center">
                    <button
                      type="button"
                      class="btn btn-soft btn-primary w-full"
                      onclick={() => {
                        isLocationPickerOpen = true;
                      }}
                    >
                      <i class="fa-solid fa-map-location-dot"></i>
                      {location ? m.selected_location() : m.select_location_on_map()}
                    </button>
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
            {/if}
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
              class="collapse-content flex max-w-full flex-col items-center gap-2"
              class:pt-4={!showCollapse}
            >
              {#if starredReady}
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
                      href={resolve('/(main)/shops/[id]', {
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
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <div
      class="hero-bottom-bar pointer-events-auto absolute bottom-4 flex w-full flex-row-reverse items-center justify-between gap-0.5 px-3 md:gap-1 lg:gap-2 lg:px-4 xl:px-6"
      in:fade={{ delay: 500, duration: 400 }}
      out:fade={{ duration: 300 }}
    >
      <div class="flex items-center gap-0.5 md:gap-1 lg:gap-2">
        <a
          href={GITHUB_LINK}
          target="_blank"
          class="btn btn-ghost btn-sm lg:btn-md flex items-center gap-2"
        >
          <i class="fa-brands fa-github fa-lg"></i>
          <span class="hidden lg:inline">GitHub</span>
        </a>
        <SocialMediaModal
          name="QQ"
          class="fa-brands fa-qq fa-lg"
          description={m.qq_description()}
          image="{base}/group-chat-qq.jpg"
        />
        <ThemeSwitch />
      </div>
      {#if showIcpLicense}
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          class="text-base-content/60 hover:text-base-content text-xs transition sm:text-sm md:text-base"
          >{env.PUBLIC_ICP_LICENSE}</a
        >
      {/if}
    </div>
  </div>
</div>

<LocationPickerModal
  bind:isOpen={isLocationPickerOpen}
  title={m.select_location_on_map()}
  onLocationSelected={(loc: { longitude: number; latitude: number; name: string }) => {
    location = {
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      confirmed: true
    };
  }}
/>

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

  :global(.title-base-content) {
    color: oklch(0.86768 0.001 17.911);
  }
</style>
