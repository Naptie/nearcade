<script lang="ts">
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { formatDateTime, pageTitle } from '$lib/utils';
  import StatCard from '$lib/components/admin/StatCard.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const stats = $derived((data.stats ?? null) as Record<string, number> | null);
  const trends = $derived(
    (data.trends ?? null) as Record<string, Array<{ date: string; value: number }>> | null
  );

  const deltaOf = (metric: string) => {
    const entry = data.deltas?.[metric];
    return entry ? { added: entry.added, removed: entry.removed } : { added: null, removed: null };
  };
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
      {#if data.snapshotMeta?.capturedAt}
        <p class="text-base-content/40 mt-1 text-xs">
          {m.admin_snapshot_captured_at({ time: formatDateTime(data.snapshotMeta.capturedAt) })}
        </p>
      {/if}
    </div>
  </div>

  {#if stats}
    <!-- Statistics Cards -->
    <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      <!-- Total Users (site admin only) -->
      {#if stats.totalUsers !== undefined}
        {@const delta = deltaOf('users')}
        <StatCard
          label={m.admin_users()}
          value={stats.totalUsers}
          icon="fa-user"
          iconBgClass="bg-blue-100"
          iconClass="text-blue-600"
          trend={trends?.totalUsers}
          trendColor="#2563eb"
          added={delta.added}
          removed={delta.removed}
        />
      {/if}

      <!-- Total Clubs -->
      {#if stats.totalClubs !== undefined}
        {@const delta = deltaOf('clubs')}
        <StatCard
          label={m.admin_clubs()}
          value={stats.totalClubs}
          icon="fa-users"
          iconBgClass="bg-green-100"
          iconClass="text-green-600"
          trend={trends?.totalClubs}
          trendColor="#16a34a"
          added={delta.added}
          removed={delta.removed}
        />
      {/if}

      <!-- Total Posts -->
      {#if stats.totalPosts !== undefined}
        {@const delta = deltaOf('posts')}
        <StatCard
          label={m.admin_posts()}
          value={stats.totalPosts}
          icon="fa-file-lines"
          iconBgClass="bg-blue-100"
          iconClass="text-blue-600"
          trend={trends?.totalPosts}
          trendColor="#2563eb"
          added={delta.added}
          removed={delta.removed}
        />
      {/if}

      <!-- Total Shops (site admin only) -->
      {#if stats.totalShops !== undefined}
        {@const delta = deltaOf('shops')}
        <StatCard
          label={m.admin_arcade_shops()}
          value={stats.totalShops}
          icon="fa-gamepad"
          iconBgClass="bg-orange-100"
          iconClass="text-orange-600"
          trend={trends?.totalShops}
          trendColor="#ea580c"
          added={delta.added}
          removed={delta.removed}
        />
      {/if}

      <!-- Total Shop Changelog Entries (site admin only) -->
      {#if stats.totalShopChangelogs !== undefined}
        {@const delta = deltaOf('shopChangelogs')}
        <StatCard
          label={m.admin_shop_changelogs()}
          value={stats.totalShopChangelogs}
          icon="fa-clock-rotate-left"
          iconBgClass="bg-amber-100"
          iconClass="text-amber-600"
          trend={trends?.totalShopChangelogs}
          trendColor="#d97706"
          added={delta.added}
          removed={delta.removed}
        />
      {/if}

      <!-- Total Universities: stock total, changelog curve (user-activity signal) -->
      {#if stats.totalUniversities !== undefined && stats.totalUniversityChangelogs !== undefined}
        {@const delta = deltaOf('universityChangelogs')}
        <StatCard
          label={m.admin_universities()}
          value={stats.totalUniversities}
          icon="fa-graduation-cap"
          iconBgClass="bg-purple-100"
          iconClass="text-purple-600"
          trend={trends?.totalUniversities}
          trendColor="#7c3aed"
          added={delta.added}
          removed={delta.removed}
          deltaLabel={m.admin_university_changelogs()}
        />
      {/if}

      <!-- Total Machines (site admin only) -->
      {#if stats.totalMachines !== undefined}
        {@const delta = deltaOf('machines')}
        <StatCard
          label={m.admin_machines()}
          value={stats.totalMachines}
          icon="fa-server"
          iconBgClass="bg-teal-100"
          iconClass="text-teal-600"
          trend={trends?.totalMachines}
          trendColor="#0d9488"
          added={delta.added}
          removed={delta.removed}
        />
      {/if}

      <!-- Total Images (site admin only) -->
      {#if stats.totalImages !== undefined}
        {@const delta = deltaOf('images')}
        <StatCard
          label={m.admin_images()}
          value={stats.totalImages}
          icon="fa-images"
          iconBgClass="bg-pink-100"
          iconClass="text-pink-600"
          trend={trends?.totalImages}
          trendColor="#db2777"
          added={delta.added}
          removed={delta.removed}
        />
      {/if}

      <!-- Total Invites -->
      {#if stats.totalInvites !== undefined}
        {@const delta = deltaOf('invites')}
        <StatCard
          label={m.admin_invites()}
          value={stats.totalInvites}
          icon="fa-link"
          iconBgClass="bg-indigo-100"
          iconClass="text-indigo-600"
          trend={trends?.totalInvites}
          trendColor="#4f46e5"
          added={delta.added}
          removed={delta.removed}
        />
      {/if}

      <!-- Total Join Requests -->
      {#if stats.totalJoinRequests !== undefined}
        {@const delta = deltaOf('joinRequests')}
        <StatCard
          label={m.join_requests()}
          value={stats.totalJoinRequests}
          icon="fa-user-plus"
          iconBgClass="bg-yellow-100"
          iconClass="text-yellow-600"
          trend={trends?.totalJoinRequests}
          trendColor="#ca8a04"
          added={delta.added}
          removed={delta.removed}
        />
      {/if}

      <!-- Total OAuth Clients (site admin only) -->
      {#if stats.totalOAuthClients !== undefined}
        {@const delta = deltaOf('oauthClients')}
        <StatCard
          label={m.admin_oauth_clients()}
          value={stats.totalOAuthClients}
          icon="fa-key"
          iconBgClass="bg-slate-100"
          iconClass="text-slate-600"
          trend={trends?.totalOAuthClients}
          trendColor="#475569"
          added={delta.added}
          removed={delta.removed}
        />
      {/if}

      <!-- Total Shop Delete Requests (site admin only) -->
      {#if stats.totalShopDeleteRequests !== undefined}
        {@const delta = deltaOf('shopDeleteRequests')}
        <StatCard
          label={m.shop_delete_requests()}
          value={stats.totalShopDeleteRequests}
          icon="fa-trash-can"
          iconBgClass="bg-red-100"
          iconClass="text-red-600"
          trend={trends?.totalShopDeleteRequests}
          trendColor="#dc2626"
          added={delta.added}
          removed={delta.removed}
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
