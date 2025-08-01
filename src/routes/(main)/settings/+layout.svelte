<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { m } from '$lib/paraglide/messages';

  let { children }: { children: import('svelte').Snippet } = $props();

  const navigationItems = [
    {
      href: `${base}/settings`,
      label: m.personal_settings(),
      icon: 'fa-user',
      exact: true
    },
    {
      href: `${base}/settings/frequenting-arcades`,
      label: m.frequenting_arcades(),
      icon: 'fa-clock'
    },
    {
      href: `${base}/settings/starred-arcades`,
      label: m.starred_arcades(),
      icon: 'fa-star'
    },
    {
      href: `${base}/settings/account`,
      label: m.account_settings(),
      icon: 'fa-cog'
    }
  ];

  const isActive = (href: string, exact = false) => {
    if (exact) {
      return page.url.pathname === href;
    }
    return page.url.pathname.startsWith(href);
  };
</script>

<svelte:head>
  <title>{m.settings()} - {m.app_name()}</title>
</svelte:head>

<div class="pt-12">
  <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
    <div class="lg:grid lg:grid-cols-12 lg:gap-8">
      <!-- Sidebar Navigation -->
      <div class="lg:col-span-3">
        <div class="sticky top-4">
          <div class="bg-base-200 rounded-lg p-4">
            <h2 class="mb-4 text-lg font-semibold">{m.settings()}</h2>
            <nav class="space-y-1">
              {#each navigationItems as item (item.href)}
                <a
                  href={item.href}
                  class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
                  class:bg-primary={isActive(item.href, item.exact)}
                  class:text-primary-content={isActive(item.href, item.exact)}
                  class:hover:bg-base-300={!isActive(item.href, item.exact)}
                >
                  <i class="fa-solid {item.icon} fa-sm"></i>
                  {item.label}
                </a>
              {/each}
            </nav>
          </div>
        </div>
      </div>

      <!-- Main Content -->
      <div class="mt-8 lg:col-span-9 lg:mt-0">
        <div class="bg-base-200 rounded-lg p-6">
          {@render children()}
        </div>
      </div>
    </div>
  </div>
</div>
