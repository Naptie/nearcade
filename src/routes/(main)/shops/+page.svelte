<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import { resolve } from '$app/paths';
  import {
    aggregateGames,
    formatShopAddress,
    getGameName,
    getMyLocation,
    pageTitle
  } from '$lib/utils';
  import { hasBoundPhone } from '$lib/utils';
  import { phoneRequiredToast } from '$lib/notifications/phone-required';
  import { PAGINATION, GAME_TITLES } from '$lib/constants';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import type { PublicUser } from '$lib/auth/types';
  import type { Shop, ShopApiAddress } from '$lib/types';
  import AttendanceReportBlame from '$lib/components/AttendanceReportBlame.svelte';
  import ShopFilterPanel from '$lib/components/ShopFilterPanel.svelte';
  import T from '$lib/ugc/components/T.svelte';
  import {
    emptyShopFilterState,
    SHOP_SORT_OPTIONS,
    type ShopFilterState,
    type ShopSearchSort
  } from '$lib/schemas/shop-filter';
  import { countActiveFilters, serializeShopFilterState } from '$lib/utils/shops/filter';

  /**
   * A stored shop whose address has been projected to the public shape (localized
   * region names), plus the live values the page load attaches.
   */
  type CardShop = Omit<Shop, 'address'> & {
    address: ShopApiAddress;
    _rankingScore?: number;
    nameHl?: string;
    currentAttendance?: number;
    currentReportedAttendance?: {
      reportedAt: string;
      reportedBy: PublicUser;
      comment: string | null;
    } | null;
  };

  let { data }: { data: PageData } = $props();

  const pageLocale = $derived(getLocale());

  // Initial capture is intentional: the $effect below re-syncs after every
  // load (back/forward included).
  // svelte-ignore state_referenced_locally
  let searchQuery = $state(data.query);
  // svelte-ignore state_referenced_locally
  let sortValue = $state<ShopSearchSort>(data.sort);
  let filterPanelOpen = $state(false);
  let isSearching = $state(false);
  let locating = $state(false);

  // Re-sync the URL-driven controls after every load (back/forward included).
  $effect(() => {
    searchQuery = data.query;
    sortValue = data.sort;
  });

  const hasPhone = $derived(hasBoundPhone(data.user) || data.user?.userType === 'site_admin');
  const canCreateShop = $derived(!!data.user && hasPhone);
  const activeCount = $derived(countActiveFilters(data.filter));

  // ── URL state ──

  const buildShopUrl = (
    overrides: {
      q?: string;
      sort?: ShopSearchSort;
      page?: number;
      filter?: ShopFilterState;
    } = {}
  ) => {
    const applied = $state.snapshot(data.filter) ?? emptyShopFilterState();
    const params = new SvelteURLSearchParams();
    const q = (overrides.q ?? searchQuery).trim();
    const sort = overrides.sort ?? sortValue;
    if (q) params.set('q', q);
    if (sort !== 'relevance') params.set('sort', sort);
    if (overrides.page && overrides.page > 1) params.set('page', String(overrides.page));
    const filter = overrides.filter ?? applied;
    if (serializeShopFilterState(filter) !== serializeShopFilterState(emptyShopFilterState())) {
      params.set('f', serializeShopFilterState(filter));
    }
    const qs = params.toString();
    return resolve('/(main)/shops') + (qs ? `?${qs}` : '');
  };

  const handleSearch = async (event: Event) => {
    event.preventDefault();
    isSearching = true;
    await goto(buildShopUrl({ q: searchQuery, page: 1 }));
    isSearching = false;
  };

  const handleSortChange = async (event: Event) => {
    sortValue = (event.target as HTMLSelectElement).value as ShopSearchSort;
    await goto(buildShopUrl({ sort: sortValue, page: 1 }));
  };

  const handleApplyFilter = async (filter: ShopFilterState) => {
    filterPanelOpen = false;
    isSearching = true;
    await goto(buildShopUrl({ filter, page: 1 }));
    isSearching = false;
  };

  const handlePageChange = (newPage: number) => {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    params.set('page', newPage.toString());
    goto(resolve('/(main)/shops') + `?${params.toString()}`);
  };

  // ── Quick chips + summary chips (applied immediately) ──

  const applyFilterUpdate = (mutate: (filter: ShopFilterState) => void) => {
    const next = structuredClone($state.snapshot(data.filter)) as ShopFilterState;
    mutate(next);
    return goto(buildShopUrl({ filter: next, page: 1 }));
  };

  const deleteHoursKey = (filter: ShopFilterState, key: 'openNow' | 'is24h') => {
    if (filter.hours) {
      delete filter.hours[key];
      if (Object.keys(filter.hours).length === 0) delete filter.hours;
    }
  };

  const toggleOpenNow = () =>
    applyFilterUpdate((filter) => {
      if (filter.hours?.openNow) deleteHoursKey(filter, 'openNow');
      else filter.hours = { ...(filter.hours ?? {}), openNow: true };
    });

  const toggle24h = () =>
    applyFilterUpdate((filter) => {
      if (filter.hours?.is24h) deleteHoursKey(filter, 'is24h');
      else filter.hours = { ...(filter.hours ?? {}), is24h: true };
    });

  const toggleNearMe = async () => {
    if (data.filter.geo) {
      await applyFilterUpdate((filter) => {
        delete filter.geo;
      });
      return;
    }
    locating = true;
    try {
      const { latitude, longitude } = await getMyLocation();
      await applyFilterUpdate((filter) => {
        filter.geo = { mode: 'near', lat: latitude, lng: longitude, radiusKm: 10 };
      });
    } catch {
      // Location unavailable — leave the filter untouched.
    } finally {
      locating = false;
    }
  };

  const removeRegionChip = (regionId: string) =>
    applyFilterUpdate((filter) => {
      filter.regions = (filter.regions ?? []).filter((id) => id !== regionId);
      if (filter.regions.length === 0) delete filter.regions;
    });

  const removeScheduleChip = (key: 'openAt' | 'opensBy' | 'closesFrom') =>
    applyFilterUpdate((filter) => {
      if (filter.hours) {
        delete filter.hours[key];
        if (Object.keys(filter.hours).length === 0) delete filter.hours;
      }
    });

  const clearAllFilters = async () => {
    await goto(buildShopUrl({ filter: emptyShopFilterState(), page: 1 }));
  };

  // ── Chip labels ──

  const SCHEDULE_KEYS = ['openAt', 'opensBy', 'closesFrom'] as const;
  const SCHEDULE_LABELS: Record<(typeof SCHEDULE_KEYS)[number], () => string> = {
    openAt: () => m.filter_schedule_openAt(),
    opensBy: () => m.filter_schedule_opensBy(),
    closesFrom: () => m.filter_schedule_closesFrom()
  };

  const formatChipMinute = (minute: number) =>
    `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

  const gameLeafCount = (expr: NonNullable<ShopFilterState['games']>): number =>
    expr.children.reduce((count, child) => count + ('op' in child ? gameLeafCount(child) : 1), 0);

  // ── Card helpers ──

  const handleCreateShop = () => {
    if (!data.user) {
      window.dispatchEvent(new CustomEvent('nearcade-login'));
      return;
    }
    if (!canCreateShop) {
      phoneRequiredToast();
      return;
    }
    goto(resolve('/(main)/shops/new'));
  };

  const getTotalMachines = (shop: Pick<Shop, 'games'>): number => {
    return shop.games.reduce((total, game) => total + game.quantity, 0);
  };

  const getGameInfo = (gameId: number) => {
    return GAME_TITLES.find((g) => g.id === gameId);
  };

  const SORT_LABELS: Record<ShopSearchSort, () => string> = {
    relevance: () => m.sort_relevance(),
    name_asc: () => m.sort_name_asc(),
    name_desc: () => m.sort_name_desc(),
    distance: () => m.sort_distance(),
    machines_desc: () => m.sort_machines_desc(),
    machines_asc: () => m.sort_machines_asc(),
    titles_desc: () => m.sort_titles_desc(),
    attendance_desc: () => m.sort_attendance_desc(),
    id_asc: () => m.sort_id_asc(),
    id_desc: () => m.sort_id_desc(),
    updated_desc: () => m.sort_updated_desc(),
    created_desc: () => m.sort_created_desc()
  };
</script>

<svelte:head>
  <title>{pageTitle(m.browse_shops())}</title>
  <meta name="description" content={m.browse_search_shops()} />
  <meta property="og:title" content={pageTitle(m.browse_shops())} />
  <meta property="og:description" content={m.browse_search_shops()} />
  <meta name="twitter:title" content={pageTitle(m.browse_shops())} />
  <meta name="twitter:description" content={m.browse_search_shops()} />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-8 sm:px-6 lg:px-8">
  <!-- Header -->
  <div class="mb-4 flex items-center gap-3">
    <h1 class="flex-1 text-3xl font-bold">{m.browse_shops()}</h1>
    <!-- Three-dots dropdown for shop-level actions -->
    <div class="dropdown dropdown-end">
      <button
        type="button"
        tabindex="0"
        class="btn btn-circle btn-soft"
        aria-label={m.more_actions()}
        title={m.more_actions()}
      >
        <i class="fa-solid fa-ellipsis"></i>
      </button>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <ul tabindex="0" class="dropdown-content menu bg-base-200 rounded-box z-10 w-56 p-2 shadow">
        <li>
          <button type="button" onclick={handleCreateShop}>
            <i class="fa-solid fa-plus"></i>
            {m.create_shop()}
          </button>
        </li>
        <li>
          <a href={resolve('/(main)/shops/delete-requests')}>
            <i class="fa-solid fa-trash-can-arrow-up"></i>
            {m.shop_delete_requests()}
          </a>
        </li>
      </ul>
    </div>
  </div>

  <!-- Search Bar -->
  <div class="mb-4">
    <form onsubmit={handleSearch} class="flex gap-2 sm:gap-4">
      <!-- Filter panel -->
      <button
        type="button"
        class="btn btn-soft hover:btn-accent"
        class:btn-primary={activeCount > 0}
        aria-label={m.filter_title()}
        onclick={() => (filterPanelOpen = true)}
      >
        <i class="fa-solid fa-filter"></i>
        {#if activeCount > 0}
          <span class="badge badge-sm">{activeCount}</span>
        {/if}
      </button>

      <!-- Sort -->
      <select
        class="select select-bordered w-36 sm:w-44"
        aria-label={m.filter_sort()}
        value={sortValue}
        onchange={handleSortChange}
      >
        {#each SHOP_SORT_OPTIONS.filter((option) => option !== 'distance' || !!data.filter.geo) as option (option)}
          <option value={option}>{SORT_LABELS[option]()}</option>
        {/each}
      </select>

      <div class="flex-1">
        <input
          type="text"
          bind:value={searchQuery}
          placeholder={m.search_shops()}
          class="input input-bordered w-full"
        />
      </div>
      <button
        type="submit"
        class="btn btn-primary"
        class:btn-soft={!searchQuery}
        class:btn-disabled={isSearching}
      >
        {#if isSearching}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          <i class="fa-solid fa-search"></i>
        {/if}
        <span class="not-sm:hidden">{m.search()}</span>
      </button>
    </form>

    <!-- Quick chips + active filter summary -->
    <div class="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="btn btn-xs rounded-full {data.filter.hours?.openNow ? 'btn-primary' : 'btn-soft'}"
        onclick={toggleOpenNow}
      >
        <i class="fa-solid fa-clock"></i>
        {m.filter_open_now()}
      </button>
      <button
        type="button"
        class="btn btn-xs rounded-full {data.filter.hours?.is24h ? 'btn-primary' : 'btn-soft'}"
        onclick={toggle24h}
      >
        <i class="fa-solid fa-business-time"></i>
        {m.filter_open_24h()}
      </button>
      <button
        type="button"
        class="btn btn-xs rounded-full {data.filter.geo ? 'btn-primary' : 'btn-soft'}"
        onclick={toggleNearMe}
      >
        {#if locating}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          <i class="fa-solid fa-location-crosshairs"></i>
        {/if}
        {m.filter_near_me()}
      </button>

      {#each data.filter.regions ?? [] as regionId (regionId)}
        {@const label = data.regionLabels?.[regionId]}
        <button
          type="button"
          class="btn btn-xs btn-primary btn-soft rounded-full"
          onclick={() => removeRegionChip(regionId)}
        >
          <i class="fa-solid fa-earth-asia"></i>
          <span>{label?.name ?? regionId}</span>
          {#if label?.path}
            <span class="opacity-50">{label.path}</span>
          {/if}
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      {/each}
      {#if data.filter.geo}
        <button
          type="button"
          class="btn btn-xs btn-primary btn-soft rounded-full"
          onclick={toggleNearMe}
        >
          {m.filter_radius_option({ radius: data.filter.geo.radiusKm })}
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      {/if}
      {#if data.filter.games}
        <button
          type="button"
          class="btn btn-xs btn-primary btn-soft rounded-full"
          onclick={() =>
            applyFilterUpdate((filter) => {
              delete filter.games;
            })}
        >
          <i class="fa-solid fa-gamepad"></i>
          {m.filter_games_chip({ count: gameLeafCount(data.filter.games) })}
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      {/if}
      {#each SCHEDULE_KEYS as key (key)}
        {#if data.filter.hours?.[key]}
          <button
            type="button"
            class="btn btn-xs btn-primary btn-soft rounded-full"
            onclick={() => removeScheduleChip(key)}
          >
            {SCHEDULE_LABELS[key]()}
            {formatChipMinute(data.filter.hours[key].minute)}
            <i class="fa-solid fa-xmark text-xs"></i>
          </button>
        {/if}
      {/each}
      {#if data.filter.machines}
        <button
          type="button"
          class="btn btn-xs btn-primary btn-soft rounded-full"
          onclick={() =>
            applyFilterUpdate((filter) => {
              delete filter.machines;
            })}
        >
          <i class="fa-solid fa-desktop"></i>
          {m.filter_section_machines()}
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      {/if}
      {#if data.filter.activity}
        <button
          type="button"
          class="btn btn-xs btn-primary btn-soft rounded-full"
          onclick={() =>
            applyFilterUpdate((filter) => {
              delete filter.activity;
            })}
        >
          <i class="fa-solid fa-user"></i>
          {m.filter_section_activity()}
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      {/if}
      {#if data.filter.status?.closed && data.filter.status.closed !== 'include'}
        <button
          type="button"
          class="btn btn-xs btn-primary btn-soft rounded-full"
          onclick={() =>
            applyFilterUpdate((filter) => {
              delete filter.status;
            })}
        >
          {data.filter.status.closed === 'exclude'
            ? m.filter_closed_exclude()
            : m.filter_closed_only()}
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      {/if}
      {#if data.filter.advanced}
        <button
          type="button"
          class="btn btn-xs btn-primary btn-soft rounded-full"
          onclick={() =>
            applyFilterUpdate((filter) => {
              delete filter.advanced;
            })}
        >
          {m.filter_section_advanced()}
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      {/if}
      {#if activeCount > 0}
        <button type="button" class="btn btn-ghost btn-xs text-error" onclick={clearAllFilters}>
          {m.clear_filters()}
        </button>
      {/if}
    </div>
  </div>

  <!-- Results -->
  <div class="space-y-6">
    {#await data.shopsData}
      <!-- Loading State with Skeleton -->
      <div class="flex items-center justify-between">
        <div class="skeleton h-4 w-48"></div>
        <div class="skeleton h-4 w-32"></div>
      </div>

      <!-- Shop Grid Skeleton -->
      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
        {#each Array(6) as _, idx (idx)}
          <div class="card bg-base-200 min-w-0 shadow-sm">
            <div class="card-body p-5">
              <div class="mb-2 flex flex-col gap-2">
                <div class="skeleton h-6 w-3/4"></div>
                <div class="skeleton h-4 w-full"></div>
              </div>
              <div class="mb-1 flex flex-wrap gap-2">
                <div class="skeleton h-6 w-20"></div>
                <div class="skeleton h-6 w-16"></div>
                <div class="skeleton h-6 w-24"></div>
              </div>
              <div class="mt-auto flex items-center justify-between gap-1">
                <div class="skeleton h-4 w-24"></div>
                <div class="skeleton h-4 w-20"></div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:then shopsData}
      {#if shopsData.shops.length > 0 || shopsData.exactMatch}
        <!-- Results Header -->
        <div class="flex items-center justify-between">
          <div class="text-base-content/60 text-sm">
            {#if data.query}
              {m.showing_results_for({ query: data.query })}
            {:else if activeCount > 0}
              {m.showing_filtered_shops()}
            {:else}
              {m.showing_all_shops()}
            {/if}
          </div>
          <div class="text-base-content/60 text-sm">
            {#if shopsData.approximateTotal}≈&nbsp;{/if}
            {m.shops_available({ count: shopsData.totalCount })}
          </div>
        </div>

        {#if shopsData.exactMatch}
          <!-- Exact match pin for numeric queries -->
          {@const aggregatedExact = aggregateGames(shopsData.exactMatch)}
          <div class="flex flex-col gap-1">
            <div class="text-base-content/60 text-xs font-semibold tracking-wide uppercase">
              <i class="fa-solid fa-crosshairs"></i>
              {m.filter_exact_match()}
            </div>
            <div class="max-w-md">
              {@render shopCard(shopsData.exactMatch, aggregatedExact, true)}
            </div>
          </div>
        {/if}

        <!-- Shop Grid -->
        <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {#each shopsData.shops as shop (shop.id)}
            {@const aggregated = aggregateGames(shop)}
            {@render shopCard(shop, aggregated, false)}
          {/each}
        </div>

        <!-- Pagination -->
        {#if shopsData.totalCount > PAGINATION.PAGE_SIZE}
          <div class="flex justify-center">
            <div class="join">
              {#if shopsData.hasPrevPage}
                <button
                  class="join-item btn"
                  onclick={() => handlePageChange(shopsData.currentPage - 1)}
                  aria-label={m.previous_page()}
                >
                  <i class="fa-solid fa-chevron-left"></i>
                </button>
              {/if}

              <button class="join-item btn btn-active">
                {shopsData.currentPage} / {Math.ceil(shopsData.totalCount / PAGINATION.PAGE_SIZE)}
              </button>

              {#if shopsData.hasNextPage}
                <button
                  class="join-item btn"
                  onclick={() => handlePageChange(shopsData.currentPage + 1)}
                  aria-label={m.next_page()}
                >
                  <i class="fa-solid fa-chevron-right"></i>
                </button>
              {/if}
            </div>
          </div>
        {/if}
      {:else}
        <!-- No Results -->
        <div class="py-12 text-center">
          <div class="text-base-content/40 mb-4">
            <i class="fa-solid fa-store text-4xl"></i>
          </div>
          <h3 class="mb-2 text-xl font-semibold">
            {#if data.query || activeCount > 0}
              {m.no_shops_found_for({ query: data.query || m.filter_title() })}
            {:else}
              {m.no_shops_available()}
            {/if}
          </h3>
          <p class="text-base-content/60">
            {m.try_different_search_or_check_later()}
          </p>
        </div>
      {/if}
    {:catch err}
      <!-- Error State -->
      <div class="py-12 text-center">
        <div class="text-error mb-4">
          <i class="fa-solid fa-exclamation-triangle text-4xl"></i>
        </div>
        <h3 class="mb-2 text-xl font-semibold">{m.failed_to_load_shops()}</h3>
        <p class="text-base-content/60 mb-4">
          {err?.message || m.error_occurred()}
        </p>
        <button class="btn btn-primary" onclick={() => window.location.reload()}>
          <i class="fa-solid fa-refresh"></i>
          {m.try_again()}
        </button>
      </div>
    {/await}
  </div>
</div>

<ShopFilterPanel
  bind:open={filterPanelOpen}
  applied={data.filter}
  regionLabels={data.regionLabels}
  onapply={handleApplyFilter}
  onclose={() => (filterPanelOpen = false)}
/>

{#snippet shopCard(shop: CardShop, aggregated: Shop['games'], pinned: boolean)}
  <a
    href={resolve('/(main)/shops/[id]', {
      id: shop.id.toString()
    })}
    class="card bg-base-200 group min-w-0 shadow-sm ring-2 transition hover:shadow-md {pinned
      ? 'ring-primary'
      : 'ring-primary/0 hover:ring-primary'}"
  >
    <div
      class="group-hover:from-primary from-warning/50 dark:from-warning/30 pointer-events-none absolute inset-0 rounded-2xl bg-linear-to-br to-transparent to-55% transition-colors"
      style:opacity="{(shop._rankingScore || 0) * 20}%"
    ></div>
    <div class="card-body p-5">
      <!-- Shop Header -->
      <div class="mb-2 flex flex-col">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0 flex-1">
            {#if shop.nameHl}
              <h3 class="truncate text-lg font-semibold" title={shop.name}>
                {@html shop.nameHl}
              </h3>
            {:else}
              <h3 class="truncate text-lg font-semibold" title={shop.name}>
                <T
                  text={shop.name}
                  field="shop_name"
                  translation={shop._t?.shop_name?.[pageLocale]}
                />
              </h3>
            {/if}
          </div>
        </div>

        <div class="text-base-content/80 flex items-start gap-2 text-sm">
          <i class="fa-solid fa-location-dot text-primary mt-0.5 shrink-0"></i>
          <span class="line-clamp-2">
            {@html formatShopAddress(shop)}
          </span>
        </div>
      </div>

      <!-- Games Info -->
      <div class="mb-1">
        <div class="flex flex-wrap gap-2">
          {#each aggregated.slice(0, 6) as game (game.titleId)}
            {@const gameInfo = getGameInfo(game.titleId)}
            {#if gameInfo}
              <div class="badge badge-soft badge-sm">
                <span class="max-w-16 truncate">
                  {getGameName(gameInfo.key) || game.name}
                </span>
                <span class="text-xs opacity-70">×{game.quantity}</span>
              </div>
            {/if}
          {/each}
          {#if aggregated.length > 6}
            <div class="badge badge-soft badge-sm">+{aggregated.length - 6}</div>
          {/if}
        </div>
      </div>

      <!-- Stats -->
      <div class="mt-auto flex items-center justify-between gap-1 text-sm">
        <div class="text-base-content/60 flex items-center gap-1">
          <i class="fa-solid fa-desktop"></i>
          <span>{m.machines({ count: getTotalMachines(shop) })}</span>
        </div>
        {#if shop.isClosed}
          <div class="text-error">
            <span>{m.shop_permanently_closed()}</span>
          </div>
        {:else if shop.currentReportedAttendance}
          <AttendanceReportBlame reportedAttendance={shop.currentReportedAttendance}>
            <div class="text-accent flex items-center gap-1">
              <i class="fa-solid fa-user"></i>
              <span>{m.in_attendance({ count: shop.currentAttendance || 0 })}</span>
            </div>
          </AttendanceReportBlame>
        {:else}
          <div
            class="text-base-content/60 flex items-center gap-1"
            class:text-primary={(shop.currentAttendance ?? 0) > 0}
          >
            <i class="fa-solid fa-user"></i>
            <span>{m.in_attendance({ count: shop.currentAttendance || 0 })}</span>
          </div>
        {/if}
      </div>
    </div>
  </a>
{/snippet}
