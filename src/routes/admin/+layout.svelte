<script lang="ts">
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import SiteTitle from '$lib/components/SiteTitle.svelte';
  import AuthModal from '$lib/components/AuthModal.svelte';
  import LocaleSwitch from '$lib/components/LocaleSwitch.svelte';
  import { getDisplayName, getUserTypeLabel } from '$lib/utils';
  import { browser } from '$app/environment';

  let { children, data } = $props();

  let isDrawerOpen = $state(false);

  $effect(() => {
    if (browser) {
      const callback = () => {
        if (window.innerWidth >= 640) {
          isDrawerOpen = false;
        }
      };
      callback();
      window.addEventListener('resize', callback);
      return () => {
        window.removeEventListener('resize', callback);
      };
    }
  });

  // Sidebar navigation items
  const navigationItems = [
    {
      id: 'dashboard',
      label: m.admin_dashboard(),
      icon: 'fa-chart-line',
      href: `${base}/admin`,
      requiresSiteAdmin: false
    },
    {
      id: 'users',
      label: m.admin_users(),
      icon: 'fa-users',
      href: `${base}/admin/users`,
      requiresSiteAdmin: true
    },
    {
      id: 'universities',
      label: m.admin_universities(),
      icon: 'fa-building-columns',
      href: `${base}/admin/universities`,
      requiresSiteAdmin: false
    },
    {
      id: 'clubs',
      label: m.admin_clubs(),
      icon: 'fa-users-gear',
      href: `${base}/admin/clubs`,
      requiresSiteAdmin: false
    },
    {
      id: 'shops',
      label: m.admin_shops(),
      icon: 'fa-gamepad',
      href: `${base}/admin/shops`,
      requiresSiteAdmin: true
    },
    {
      id: 'invites',
      label: m.admin_invites(),
      icon: 'fa-link',
      href: `${base}/admin/invites`,
      requiresSiteAdmin: false
    },
    {
      id: 'join-requests',
      label: m.join_requests(),
      icon: 'fa-user-plus',
      href: `${base}/admin/join-requests`,
      requiresSiteAdmin: false
    }
  ];

  // Filter navigation items based on user permissions
  const visibleItems = $derived(
    navigationItems.filter(
      (item) => !item.requiresSiteAdmin || data.user?.userType === 'site_admin'
    )
  );

  const currentPath = $derived(page.url.pathname);
</script>

{#snippet sidebar()}
  <div class="bg-base-100 h-full p-4">
    <h2 class="text-base-content mb-4 text-lg font-semibold">
      {m.admin_panel()}
    </h2>

    <!-- User Info -->
    <div class="bg-base-200 mb-4 rounded-lg p-3">
      <div class="flex items-center gap-2">
        {#if data.user?.image}
          <img src={data.user.image} alt={getDisplayName(data.user)} class="h-8 w-8 rounded-full" />
        {:else}
          <div class="bg-primary/20 flex h-8 w-8 items-center justify-center rounded-full">
            <i class="fa-solid fa-user text-primary text-sm"></i>
          </div>
        {/if}
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">
            {getDisplayName(data.user)}
          </div>
          <div class="text-base-content/60 text-xs">
            {getUserTypeLabel(data.user?.userType)}
          </div>
        </div>
      </div>
    </div>

    <!-- Navigation Menu -->
    <nav class="space-y-1">
      {#each visibleItems as item (item.id)}
        <a
          href={item.href}
          class="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors
                {currentPath === item.href
            ? 'bg-primary text-primary-content'
            : 'text-base-content hover:bg-base-200'}"
        >
          <i class="fa-solid {item.icon} w-4"></i>
          <span class="w-[calc(100%-1rem)] truncate text-sm font-medium">{item.label}</span>
        </a>
      {/each}
    </nav>
  </div>
{/snippet}

<div class="drawer bg-base-200 min-h-screen">
  <input id="admin-sidebar" type="checkbox" class="drawer-toggle" bind:checked={isDrawerOpen} />
  <div class="drawer-content">
    <!-- Top Navigation -->
    <nav
      class="navbar bg-base-100 border-base-300 justify-between gap-0.5 border-b px-6 shadow-sm md:gap-1 lg:gap-2"
    >
      <div class="flex items-center gap-0.5">
        <!-- Mobile drawer toggle button -->
        <label
          for="admin-sidebar"
          class="btn btn-circle btn-ghost sm:hidden"
          aria-label={m.sidebar()}
          title={m.sidebar()}
        >
          <i class="fa-solid fa-bars"></i>
        </label>
        <SiteTitle class="text-2xl sm:text-3xl md:text-4xl" />
      </div>
      <div class="flex items-center gap-0.5 md:gap-1 lg:gap-2">
        <LocaleSwitch />
        <AuthModal size="sm" />
      </div>
    </nav>

    <div class="flex min-h-[calc(100vh-4rem)]">
      <!-- Sidebar -->
      <aside class="border-base-300 w-64 min-w-36 border-r shadow-sm not-sm:hidden">
        {@render sidebar()}
      </aside>

      <!-- Main Content -->
      <main class="flex-1 p-6 sm:max-w-[calc(100%-16rem)]">
        {@render children()}
      </main>
    </div>
  </div>
  <div class="drawer-side z-10">
    <label for="admin-sidebar" aria-label={m.close()} class="drawer-overlay"></label>
    {@render sidebar()}
  </div>
</div>
