<script lang="ts">
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { pageTitle } from '$lib/utils';
  import StatCard from '$lib/components/admin/StatCard.svelte';
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
    <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      <!-- Total Users (site admin only) -->
      {#if data.stats.totalUsers !== undefined}
        <StatCard
          label={m.admin_users()}
          value={data.stats.totalUsers}
          icon="fa-user"
          iconBgClass="bg-blue-100"
          iconClass="text-blue-600"
          trend={data.trends?.totalUsers}
          trendColor="#2563eb"
          delta={data.recentActivity?.newUsers}
        />
      {/if}

      <!-- Total Clubs -->
      {#if data.stats.totalClubs !== undefined}
        <StatCard
          label={m.admin_clubs()}
          value={data.stats.totalClubs}
          icon="fa-users"
          iconBgClass="bg-green-100"
          iconClass="text-green-600"
          trend={data.trends?.totalClubs}
          trendColor="#16a34a"
          delta={data.recentActivity?.newClubs}
        />
      {/if}

      <!-- Total Posts -->
      {#if data.stats.totalPosts !== undefined}
        <StatCard
          label={m.admin_posts()}
          value={data.stats.totalPosts}
          icon="fa-file-lines"
          iconBgClass="bg-blue-100"
          iconClass="text-blue-600"
          trend={data.trends?.totalPosts}
          trendColor="#2563eb"
          delta={data.recentActivity?.newPosts}
        />
      {/if}

      <!-- Total Shops (site admin only) -->
      {#if data.stats.totalShops !== undefined}
        <StatCard
          label={m.admin_arcade_shops()}
          value={data.stats.totalShops}
          icon="fa-gamepad"
          iconBgClass="bg-orange-100"
          iconClass="text-orange-600"
          trend={data.trends?.totalShops}
          trendColor="#ea580c"
          delta={data.recentActivity?.newShops}
        />
      {/if}

      <!-- Total Shop Changelog Entries (site admin only) -->
      {#if data.stats.totalShopChangelogs !== undefined}
        <StatCard
          label={m.admin_shop_changelogs()}
          value={data.stats.totalShopChangelogs}
          icon="fa-clock-rotate-left"
          iconBgClass="bg-amber-100"
          iconClass="text-amber-600"
          trend={data.trends?.totalShopChangelogs}
          trendColor="#d97706"
          delta={data.recentActivity?.newShopChangelogs}
        />
      {/if}

      <!-- Total Universities -->
      {#if data.stats.totalUniversities !== undefined && data.stats.totalUniversityChangelogs !== undefined}
        <StatCard
          label={m.admin_universities()}
          value={data.stats.totalUniversities}
          icon="fa-graduation-cap"
          iconBgClass="bg-purple-100"
          iconClass="text-purple-600"
          trend={data.trends?.totalUniversities}
          trendColor="#7c3aed"
          delta={data.recentActivity?.newUniversityChangelogs}
          deltaLabel={m.admin_university_changelogs()}
        />
      {/if}

      <!-- Total Machines (site admin only) -->
      {#if data.stats.totalMachines !== undefined}
        <StatCard
          label={m.admin_machines()}
          value={data.stats.totalMachines}
          icon="fa-server"
          iconBgClass="bg-teal-100"
          iconClass="text-teal-600"
          trend={data.trends?.totalMachines}
          trendColor="#0d9488"
          delta={data.recentActivity?.newMachines}
        />
      {/if}

      <!-- Total Images (site admin only) -->
      {#if data.stats.totalImages !== undefined}
        <StatCard
          label={m.admin_images()}
          value={data.stats.totalImages}
          icon="fa-images"
          iconBgClass="bg-pink-100"
          iconClass="text-pink-600"
          trend={data.trends?.totalImages}
          trendColor="#db2777"
          delta={data.recentActivity?.newImages}
        />
      {/if}

      <!-- Total Invites -->
      {#if data.stats.totalInvites !== undefined}
        <StatCard
          label={m.admin_invites()}
          value={data.stats.totalInvites}
          icon="fa-link"
          iconBgClass="bg-indigo-100"
          iconClass="text-indigo-600"
          trend={data.trends?.totalInvites}
          trendColor="#4f46e5"
          delta={data.recentActivity?.newInvites}
        />
      {/if}

      <!-- Total Join Requests -->
      {#if data.stats.totalJoinRequests !== undefined}
        <StatCard
          label={m.join_requests()}
          value={data.stats.totalJoinRequests}
          icon="fa-user-plus"
          iconBgClass="bg-yellow-100"
          iconClass="text-yellow-600"
          trend={data.trends?.totalJoinRequests}
          trendColor="#ca8a04"
          delta={data.recentActivity?.newJoinRequests}
        />
      {/if}

      <!-- Total OAuth Clients (site admin only) -->
      {#if data.stats.totalOAuthClients !== undefined}
        <StatCard
          label={m.admin_oauth_clients()}
          value={data.stats.totalOAuthClients}
          icon="fa-key"
          iconBgClass="bg-slate-100"
          iconClass="text-slate-600"
          trend={data.trends?.totalOAuthClients}
          trendColor="#475569"
          delta={data.recentActivity?.newOAuthClients}
        />
      {/if}

      <!-- Total Shop Delete Requests (site admin only) -->
      {#if data.stats.totalShopDeleteRequests !== undefined}
        <StatCard
          label={m.shop_delete_requests()}
          value={data.stats.totalShopDeleteRequests}
          icon="fa-trash-can"
          iconBgClass="bg-red-100"
          iconClass="text-red-600"
          trend={data.trends?.totalShopDeleteRequests}
          trendColor="#dc2626"
          delta={data.recentActivity?.newShopDeleteRequests}
        />
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
          <a href={resolve('/admin/data-updates')} class="btn btn-soft">
            <i class="fa-solid fa-arrows-rotate mr-2"></i>
            {m.admin_data_updates()}
          </a>
          <a href={resolve('/admin/images')} class="btn btn-soft">
            <i class="fa-solid fa-images mr-2"></i>
            {m.admin_images()}
          </a>
          <a href={resolve('/admin/machines')} class="btn btn-soft">
            <i class="fa-solid fa-server mr-2"></i>
            {m.admin_machines()}
          </a>
          <a href={resolve('/admin/oauth-clients')} class="btn btn-soft">
            <i class="fa-solid fa-key mr-2"></i>
            {m.admin_oauth_clients()}
          </a>
          <a href={resolve('/(main)/shops/delete-requests')} class="btn btn-soft">
            <i class="fa-solid fa-trash-can mr-2"></i>
            {m.shop_delete_requests()}
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
        <a href={resolve('/admin/invites')} class="btn btn-soft">
          <i class="fa-solid fa-link mr-2"></i>
          {m.admin_invites()}
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
