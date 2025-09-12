<script lang="ts">
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import {
    getDisplayName,
    getShopSourceUrl,
    getUserTypeBadgeClass,
    getUserTypeLabel,
    pageTitle
  } from '$lib/utils';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import ManagedArcade from '$lib/components/ManagedArcade.svelte';
  import ActivityItem from '$lib/components/ActivityItem.svelte';
  import type { PageData } from './$types';
  import type { Activity } from '$lib/types';
  import { formatDistanceToNow } from 'date-fns';
  import { zhCN, enUS } from 'date-fns/locale';
  import { onMount } from 'svelte';
  import type { Shop } from '$lib/types';
  import VerifiedCheckMark from '$lib/components/VerifiedCheckMark.svelte';

  let { data }: { data: PageData } = $props();

  const ARCADE_DISPLAY_LIMIT = 10;

  let radius = $state(10);

  // Activity loading state
  let activities = $state<Activity[]>([]);
  let isLoadingActivities = $state(true);
  let isLoadingMoreActivities = $state(false);
  let hasMoreActivities = $state(true);
  let activitiesPage = $state(1);
  let activitiesError = $state<string | null>(null);

  // Check if can view activities
  const canViewActivities = $derived(data.isOwnProfile || data.user.isActivityPublic !== false);

  const loadActivities = async (page = 1, append = false) => {
    if (!canViewActivities) return;

    const isInitialLoad = page === 1;
    if (isInitialLoad) {
      isLoadingActivities = true;
      activitiesError = null;
    } else {
      isLoadingMoreActivities = true;
    }

    try {
      const userId = data.user.name ? `@${data.user.name}` : data.user.id;
      const response = await fetch(
        resolve('/api/users/[id]/activities', {
          id: userId || ''
        }) + `?page=${page}&limit=10`
      );

      if (!response.ok) {
        throw new Error('Failed to load activities');
      }

      const result = (await response.json()) as {
        activities: Activity[];
        hasMore: boolean;
        page: number;
        limit: number;
      };

      if (append) {
        activities = [...activities, ...result.activities];
      } else {
        activities = result.activities;
      }

      hasMoreActivities = result.hasMore;
      activitiesPage = page;
    } catch (err) {
      console.error('Error loading activities:', err);
      activitiesError = err instanceof Error ? err.message : 'Failed to load activities';
    } finally {
      isLoadingActivities = false;
      isLoadingMoreActivities = false;
    }
  };

  const loadMoreActivities = async () => {
    if (!hasMoreActivities || isLoadingMoreActivities) return;
    await loadActivities(activitiesPage + 1, true);
  };

  onMount(() => {
    const savedRadius = localStorage.getItem('nearcade-radius');
    if (savedRadius) {
      radius = parseInt(savedRadius);
    }

    // Load activities when component mounts
    loadActivities();
  });
</script>

<svelte:head>
  <title>{pageTitle(getDisplayName(data.user), m.profile())}</title>
</svelte:head>

<div class="bg-base-100 pt-12">
  <div class="mx-auto px-4 py-8 sm:container sm:px-6 lg:px-8">
    <!-- Profile Header -->
    <div class="bg-base-200 mb-8 rounded-xl p-6">
      <div class="flex flex-col items-center gap-6 sm:flex-row">
        <UserAvatar user={data.user} size="xl" />

        <!-- User Info -->
        <div class="flex-1">
          <div class="mb-2 flex flex-wrap items-center gap-3">
            <h1 class="text-2xl font-bold sm:text-3xl">
              {getDisplayName(data.user)}
            </h1>
            <span class="badge text-nowrap {getUserTypeBadgeClass(data.user.userType)}">
              {getUserTypeLabel(data.user.userType)}
            </span>
          </div>

          {#if data.user.displayName && data.user.name && data.user.displayName !== data.user.name}
            <p class="text-base-content/70 mb-2">@{data.user.name}</p>
          {/if}

          <!-- University Info -->
          {#if data.universityMembership}
            {@const university = data.universityMembership.university}
            {@const universityLink = resolve('/(main)/universities/[id]', {
              id: university.slug || university.id
            })}
            <div class="mb-3 flex items-center gap-2">
              <i class="fa-solid fa-graduation-cap text-base-content/50"></i>
              <a
                href={universityLink}
                class="hover:text-accent text-base-content/80 transition-colors"
              >
                {university.name}
              </a>
              {#if data.universityMembership.verifiedAt}
                <VerifiedCheckMark href={data.isOwnProfile ? `${universityLink}/verify` : ''} />
              {/if}
            </div>
          {/if}

          <!-- Bio -->
          {#if data.user.bio}
            <p class="text-base-content/80 mb-3 max-w-2xl">
              {data.user.bio}
            </p>
          {/if}

          <!-- Join Date -->
          {#if data.user.joinedAt}
            <p class="text-base-content/60 flex items-center gap-2 text-sm">
              <i class="fa-solid fa-calendar"></i>
              {m.joined_on({ date: new Date(data.user.joinedAt).toLocaleDateString() })}
            </p>
          {/if}

          <!-- Last Active / Online Status -->
          {#if data.user.lastActiveAt}
            {@const lastActiveDate = new Date(data.user.lastActiveAt)}
            {@const isOnline = Date.now() - lastActiveDate.getTime() < 2 * 60 * 1000}
            <div class="text-base-content/60 flex items-center gap-2 text-sm">
              <i class="fa-solid fa-clock"></i>
              {#if isOnline}
                <span class="flex items-center gap-2">
                  <span class="font-medium text-green-600">{m.online()}</span>
                  <span class="h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
                </span>
              {:else}
                <span>
                  {m.last_active_at({
                    time: formatDistanceToNow(lastActiveDate, {
                      addSuffix: true,
                      locale: getLocale() === 'en' ? enUS : zhCN
                    })
                  })}
                </span>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Edit Button (if own profile) -->
        {#if data.isOwnProfile}
          <div class="shrink-0">
            <a href={resolve('/(main)/settings')} class="btn btn-sm btn-soft">
              <i class="fa-solid fa-edit"></i>
              {m.edit()}
            </a>
          </div>
        {/if}
      </div>
    </div>

    <!-- Content Sections -->
    <div class="grid grid-cols-1 gap-8 lg:grid-cols-3">
      <!-- Main Content -->
      <div class="space-y-8 lg:col-span-2">
        <!-- Recent Activity -->
        <div class="bg-base-200 rounded-xl p-6">
          <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
            <i class="fa-solid fa-clock-rotate-left"></i>
            {m.recent_activity()}
          </h3>

          {#if !canViewActivities}
            <div class="text-base-content/60 py-8 text-center">
              <i class="fa-solid fa-lock mb-2 text-3xl"></i>
              <p>{m.activities_are_private()}</p>
            </div>
          {:else if isLoadingActivities}
            <div class="text-base-content/60 py-8 text-center">
              <span class="loading loading-spinner loading-lg"></span>
              <p class="mt-2">{m.loading()}</p>
            </div>
          {:else if activitiesError}
            <div class="text-base-content/60 py-8 text-center">
              <i class="fa-solid fa-exclamation-triangle text-error mb-2 text-3xl"></i>
              <p>{activitiesError}</p>
              <button class="btn btn-sm btn-outline mt-4" onclick={() => loadActivities()}>
                {m.try_again()}
              </button>
            </div>
          {:else if activities.length > 0}
            <div class="space-y-3">
              {#each activities as activity (activity.id)}
                <ActivityItem {activity} />
              {/each}
            </div>

            <!-- Load More Button -->
            {#if hasMoreActivities}
              <div class="mt-4 text-center">
                <button
                  class="btn btn-soft btn-sm"
                  onclick={loadMoreActivities}
                  disabled={isLoadingMoreActivities}
                >
                  {#if isLoadingMoreActivities}
                    <span class="loading loading-spinner loading-sm"></span>
                  {/if}
                  {m.load_more()}
                </button>
              </div>
            {/if}
          {:else}
            <div class="text-base-content/60 py-8 text-center">
              <i class="fa-solid fa-clock-rotate-left mb-2 text-3xl"></i>
              <p>{m.no_recent_activity()}</p>
            </div>
          {/if}
        </div>

        <!-- Frequenting Arcades -->
        {#if (data.user.frequentingArcades && data.user.frequentingArcades.length > 0) || data.isOwnProfile}
          <div class="bg-base-200 rounded-xl p-6">
            <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
              <i class="fa-solid fa-clock"></i>
              {m.frequenting_arcades()}
            </h3>
            {#if data.user.frequentingArcades && data.user.frequentingArcades.length > 0}
              <div class="space-y-3">
                {#each data.user.frequentingArcades as shop (shop._id)}
                  <ManagedArcade {shop} {radius} />
                {/each}
              </div>
            {:else}
              <div class="text-base-content/60 py-8 text-center">
                <i class="fa-solid fa-clock mb-4 text-4xl"></i>
                <p>{m.no_frequenting_arcades()}</p>
                {#if data.isOwnProfile}
                  <a
                    href={resolve('/(main)/settings/frequenting-arcades')}
                    class="hover:text-accent mt-2 text-sm transition-colors"
                  >
                    {m.add_arcade_to_get_started()}
                  </a>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Starred Arcades -->
        {#if (data.user.starredArcades && data.user.starredArcades.length > 0) || data.isOwnProfile}
          <div class="bg-base-200 rounded-xl p-6">
            <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
              <i class="fa-solid fa-star"></i>
              {m.starred_arcades()}
            </h3>
            {#if data.user.starredArcades && data.user.starredArcades.length > 0}
              <div class="space-y-3">
                {#each data.user.starredArcades as shop (shop._id)}
                  <ManagedArcade {shop} {radius} />
                {/each}
              </div>
            {:else}
              <div class="text-base-content/60 py-8 text-center">
                <i class="fa-solid fa-star mb-4 text-4xl"></i>
                <p>{m.no_starred_arcades()}</p>
                {#if data.isOwnProfile}
                  <a
                    href={resolve('/(main)/settings/starred-arcades')}
                    class="hover:text-accent mt-2 text-sm transition-colors"
                  >
                    {m.add_arcade_to_get_started()}
                  </a>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Sidebar -->
      <div class="space-y-6">
        <!-- Quick Stats -->
        <div class="bg-base-200 rounded-xl p-6">
          <h3 class="mb-3 flex items-center gap-2 font-semibold">
            <i class="fa-solid fa-chart-line"></i>
            {m.statistics()}
          </h3>
          <div class="space-y-3">
            <div class="flex justify-between">
              <span class="text-base-content/70">{m.frequenting_arcades()}</span>
              <span class="font-medium">{data.frequentingArcadesCount}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-base-content/70">{m.starred_arcades()}</span>
              <span class="font-medium">{data.starredArcadesCount}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-base-content/70">{m.universities()}</span>
              <span class="font-medium">{data.universityMembershipCount}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-base-content/70">{m.clubs()}</span>
              <span class="font-medium">{data.clubMembershipCount}</span>
            </div>
          </div>
        </div>

        {#snippet arcade(shop: Shop)}
          <div class="flex items-center justify-between gap-1 text-sm">
            <a
              href={getShopSourceUrl(shop)}
              target="_blank"
              class="hover:text-accent transition-colors"
            >
              {shop.name}
            </a>
            <a
              href="{resolve('/(main)/discover')}?longitude={shop.location
                ?.coordinates[0]}&latitude={shop.location
                ?.coordinates[1]}&name={shop.name}&radius={radius}"
              target="_blank"
              class="btn btn-ghost btn-circle btn-xs"
              title={m.explore_nearby()}
              aria-label={m.explore_nearby()}
            >
              <i class="fa-solid fa-map-location-dot"></i>
            </a>
          </div>
        {/snippet}

        <!-- Sidebar Frequenting Arcades -->
        {#if data.user.frequentingArcades && data.user.frequentingArcades.length > 0}
          <div class="bg-base-200 rounded-xl p-6">
            <h3 class="mb-3 flex items-center gap-2 font-semibold">
              <i class="fa-solid fa-clock"></i>
              {m.frequenting_arcades()}
            </h3>
            <div class="space-y-2">
              {#each data.user.frequentingArcades.slice(0, ARCADE_DISPLAY_LIMIT) as shop (shop._id)}
                {@render arcade(shop)}
              {/each}
              {#if data.user.frequentingArcades.length > ARCADE_DISPLAY_LIMIT}
                <div class="text-base-content/60 text-xs">
                  {m.and_x_more({
                    count: data.user.frequentingArcades.length - ARCADE_DISPLAY_LIMIT
                  })}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Sidebar Starred Arcades -->
        {#if data.user.starredArcades && data.user.starredArcades.length > 0}
          <div class="bg-base-200 rounded-xl p-6">
            <h3 class="mb-3 flex items-center gap-2 font-semibold">
              <i class="fa-solid fa-star"></i>
              {m.starred_arcades()}
            </h3>
            <div class="space-y-2">
              {#each data.user.starredArcades.slice(0, ARCADE_DISPLAY_LIMIT) as shop (shop._id)}
                {@render arcade(shop)}
              {/each}
              {#if data.user.starredArcades.length > ARCADE_DISPLAY_LIMIT}
                <div class="text-base-content/60 text-xs">
                  {m.and_x_more({ count: data.user.starredArcades.length - ARCADE_DISPLAY_LIMIT })}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Contact Info -->
        {#if data.user.email && !data.user.email.endsWith('.nearcade')}
          <div class="bg-base-200 rounded-xl p-6">
            <h3 class="mb-3 flex items-center gap-2 font-semibold">
              <i class="fa-solid fa-envelope"></i>
              {m.contact()}
            </h3>
            <div class="space-y-2">
              <div class="flex items-center gap-2 text-sm">
                <i class="fa-solid fa-envelope text-base-content/50"></i>
                <a
                  class="hover:text-accent break-all transition-colors"
                  href="mailto:{data.user.email}">{data.user.email}</a
                >
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
