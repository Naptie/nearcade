<script lang="ts">
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { pageTitle } from '$lib/utils';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{pageTitle(m.admin_dashboard(), m.admin_panel())}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <!-- Page Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-base-content text-3xl font-bold">{m.admin_dashboard()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_dashboard_description()}</p>
    </div>
  </div>

  {#if data.stats}
    <!-- Statistics Cards -->
    <div
      class="grid grid-cols-1 gap-6 md:grid-cols-2"
      class:lg:grid-cols-3={data.stats.totalUsers !== undefined &&
        data.stats.totalShops !== undefined}
    >
      <!-- Total Users (site admin only) -->
      {#if data.stats.totalUsers !== undefined}
        <div class="bg-base-100 border-base-300 rounded-lg border p-6 shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-base-content/60 text-sm font-medium">{m.admin_users()}</p>
              <p class="text-base-content text-2xl font-bold">{data.stats.totalUsers}</p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <i class="fa-solid fa-user text-lg text-blue-600"></i>
            </div>
          </div>
          {#if data.recentActivity?.newUsers !== undefined}
            <div class="mt-4 flex items-center text-sm">
              <span class="font-medium text-green-600">+{data.recentActivity.newUsers}</span>
              <span class="text-base-content/60 ml-1">{m.admin_new_this_week()}</span>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Total Universities -->
      {#if data.stats.totalUniversities !== undefined}
        <div class="bg-base-100 border-base-300 rounded-lg border p-6 shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-base-content/60 text-sm font-medium">{m.admin_universities()}</p>
              <p class="text-base-content text-2xl font-bold">{data.stats.totalUniversities}</p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
              <i class="fa-solid fa-graduation-cap text-lg text-purple-600"></i>
            </div>
          </div>
        </div>
      {/if}

      <!-- Total Clubs -->
      {#if data.stats.totalClubs !== undefined}
        <div class="bg-base-100 border-base-300 rounded-lg border p-6 shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-base-content/60 text-sm font-medium">{m.admin_clubs()}</p>
              <p class="text-base-content text-2xl font-bold">{data.stats.totalClubs}</p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <i class="fa-solid fa-users text-lg text-green-600"></i>
            </div>
          </div>
          {#if data.recentActivity?.newClubs !== undefined}
            <div class="mt-4 flex items-center text-sm">
              <span class="font-medium text-green-600">+{data.recentActivity.newClubs}</span>
              <span class="text-base-content/60 ml-1">{m.admin_new_this_week()}</span>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Total Posts -->
      {#if data.stats.totalPosts !== undefined}
        <div class="bg-base-100 border-base-300 rounded-lg border p-6 shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-base-content/60 text-sm font-medium">{m.admin_posts()}</p>
              <p class="text-base-content text-2xl font-bold">{data.stats.totalPosts}</p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <i class="fa-solid fa-file-lines text-lg text-blue-600"></i>
            </div>
          </div>
          {#if data.recentActivity?.newPosts !== undefined}
            <div class="mt-4 flex items-center text-sm">
              <span class="font-medium text-green-600">+{data.recentActivity.newPosts}</span>
              <span class="text-base-content/60 ml-1">{m.admin_new_this_week()}</span>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Total Shops (site admin only) -->
      {#if data.stats.totalShops !== undefined}
        <div class="bg-base-100 border-base-300 rounded-lg border p-6 shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-base-content/60 text-sm font-medium">{m.admin_arcade_shops()}</p>
              <p class="text-base-content text-2xl font-bold">{data.stats.totalShops}</p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100">
              <i class="fa-solid fa-gamepad text-lg text-orange-600"></i>
            </div>
          </div>
        </div>
      {/if}

      <!-- Total Invites -->
      {#if data.stats.totalInvites !== undefined}
        <div class="bg-base-100 border-base-300 rounded-lg border p-6 shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-base-content/60 text-sm font-medium">{m.admin_invites()}</p>
              <p class="text-base-content text-2xl font-bold">{data.stats.totalInvites}</p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100">
              <i class="fa-solid fa-link text-lg text-indigo-600"></i>
            </div>
          </div>
          {#if data.recentActivity?.newInvites !== undefined}
            <div class="mt-4 flex items-center text-sm">
              <span class="font-medium text-green-600">+{data.recentActivity.newInvites}</span>
              <span class="text-base-content/60 ml-1">{m.admin_new_this_week()}</span>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Pending Join Requests -->
      {#if data.stats.pendingJoinRequests !== undefined}
        <div class="bg-base-100 border-base-300 rounded-lg border p-6 shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-base-content/60 text-sm font-medium">{m.pending_requests()}</p>
              <p class="text-base-content text-2xl font-bold">{data.stats.pendingJoinRequests}</p>
            </div>
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100">
              <i class="fa-solid fa-user-plus text-lg text-yellow-600"></i>
            </div>
          </div>
          {#if data.recentActivity?.newJoinRequests !== undefined}
            <div class="mt-4 flex items-center text-sm">
              <span class="font-medium text-yellow-600">+{data.recentActivity.newJoinRequests}</span
              >
              <span class="text-base-content/60 ml-1">{m.admin_new_this_week()}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Quick Actions -->
    <div class="bg-base-100 border-base-300 rounded-lg border p-6 shadow-sm">
      <h2 class="text-base-content mb-4 text-xl font-semibold">{m.admin_quick_actions()}</h2>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {#if data.user.userType === 'site_admin'}
          <a href={resolve('/admin/users')} class="btn btn-soft">
            <i class="fa-solid fa-user mr-2"></i>
            {m.admin_users()}
          </a>
        {/if}
        <a href={resolve('/admin/universities')} class="btn btn-soft">
          <i class="fa-solid fa-graduation-cap mr-2"></i>
          {m.admin_universities()}
        </a>
        <a href={resolve('/admin/clubs')} class="btn btn-soft">
          <i class="fa-solid fa-users mr-2"></i>
          {m.admin_clubs()}
        </a>
        <a href={resolve('/admin/join-requests')} class="btn btn-soft">
          <i class="fa-solid fa-user-plus mr-2"></i>
          {m.join_requests()}
        </a>
      </div>
    </div>
  {:else}
    <div class="bg-base-100 border-base-300 rounded-lg border p-6 shadow-sm">
      <div class="py-8 text-center">
        <i class="fa-solid fa-exclamation-triangle text-warning mb-4 text-4xl"></i>
        <h3 class="text-base-content mb-2 text-lg font-semibold">
          {m.admin_unable_to_load_statistics()}
        </h3>
        <p class="text-base-content/60">{m.admin_error_loading_data()}</p>
      </div>
    </div>
  {/if}
</div>
