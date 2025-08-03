<script lang="ts">
  import { base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { getUserTypeBadgeClass, getUserTypeLabel } from '$lib/utils';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import type { PageData } from './$types';
  import { formatDistanceToNow } from 'date-fns';
  import { zhCN, enUS } from 'date-fns/locale';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title
    >{data.user.displayName ||
      (() => (data.user.name ? `@${data.user.name}` : ''))() ||
      m.anonymous_user()} -
    {m.profile()} - {m.app_name()}</title
  >
</svelte:head>

<div class="bg-base-100 pt-12">
  <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
    <!-- Profile Header -->
    <div class="bg-base-200 mb-8 rounded-lg p-6">
      <div class="flex flex-col items-center gap-6 sm:flex-row">
        <UserAvatar user={data.user} size="xl" />

        <!-- User Info -->
        <div class="flex-1">
          <div class="mb-2 flex items-center gap-3">
            <h1 class="text-2xl font-bold sm:text-3xl">
              {data.user.displayName ||
                (() => (data.user.name ? `@${data.user.name}` : ''))() ||
                m.anonymous_user()}
            </h1>
            <span class="badge {getUserTypeBadgeClass(data.user.userType)}">
              {getUserTypeLabel(data.user.userType)}
            </span>
          </div>

          {#if data.user.displayName && data.user.name && data.user.displayName !== data.user.name}
            <p class="text-base-content/70 mb-2">@{data.user.name}</p>
          {/if}

          <!-- University Info -->
          {#if data.university}
            <div class="mb-3 flex items-center gap-2">
              <i class="fa-solid fa-graduation-cap text-base-content/50"></i>
              <a
                href="{base}/universities/{data.university.slug || data.university.id}"
                class="hover:text-accent text-base-content/80 transition-colors"
              >
                {data.university.name}
              </a>
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
            <a href="{base}/settings" class="btn btn-sm btn-soft">
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
        <!-- Frequenting Arcades -->
        {#if data.user.frequentingArcades.length > 0}
          <div class="bg-base-200 rounded-lg p-6">
            <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
              <i class="fa-solid fa-gamepad"></i>
              {m.frequenting_arcades()}
            </h3>
            <div class="text-base-content/60 py-8 text-center">
              <i class="fa-solid fa-gamepad mb-2 text-3xl"></i>
              <p>{m.feature_in_development()}</p>
            </div>
          </div>
        {/if}

        <!-- Recent Activity -->
        <div class="bg-base-200 rounded-lg p-6">
          <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
            <i class="fa-solid fa-clock-rotate-left"></i>
            {m.recent_activity()}
          </h3>
          <div class="text-base-content/60 py-8 text-center">
            <i class="fa-solid fa-clock-rotate-left mb-2 text-3xl"></i>
            <p>{m.activity_log_feature_in_development()}</p>
          </div>
        </div>
      </div>

      <!-- Sidebar -->
      <div class="space-y-6">
        <!-- Quick Stats -->
        <div class="bg-base-200 rounded-lg p-4">
          <h3 class="mb-3 font-semibold">{m.statistics()}</h3>
          <div class="space-y-3">
            <div class="flex justify-between">
              <span class="text-base-content/70">{m.frequenting_arcades()}</span>
              <span class="font-medium">{data.user.frequentingArcades.length}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-base-content/70">{m.starred_arcades()}</span>
              <span class="font-medium">{data.user.starredArcades.length}</span>
            </div>
            {#if data.universityMembershipCount !== null}
              <div class="flex justify-between">
                <span class="text-base-content/70">{m.university()}</span>
                <span class="font-medium">{data.universityMembershipCount}</span>
              </div>
            {/if}
          </div>
        </div>

        <!-- Contact Info -->
        {#if data.user.email && !data.user.email.endsWith('.nearcade')}
          <div class="bg-base-200 rounded-lg p-4">
            <h3 class="mb-3 font-semibold">{m.contact()}</h3>
            <div class="space-y-2">
              <div class="flex items-center gap-2 text-sm">
                <i class="fa-solid fa-envelope text-base-content/50"></i>
                <span class="break-all">{data.user.email}</span>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
