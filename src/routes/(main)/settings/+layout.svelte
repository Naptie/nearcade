<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { requiresEmailBinding } from '$lib/auth/email';
  import { m } from '$lib/paraglide/messages';
  import { pageTitle } from '$lib/utils';
  import type { LayoutData } from './$types';

  let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

  const navigationItems = $derived([
    {
      href: resolve('/(main)/settings'),
      label: m.personal_settings(),
      icon: 'fa-user',
      exact: true
    },
    {
      href: resolve('/(main)/settings/starred-arcades'),
      label: m.starred_arcades(),
      icon: 'fa-star'
    },
    {
      href: resolve('/(main)/settings/frequenting-arcades'),
      label: m.frequenting_arcades(),
      icon: 'fa-clock'
    },
    {
      href: resolve('/(main)/settings/api-tokens'),
      label: m.api_tokens(),
      icon: 'fa-key'
    },
    {
      href: resolve('/(main)/settings/email'),
      label: m.email_settings(),
      icon: 'fa-envelope',
      warn: requiresEmailBinding(data.user)
    },
    {
      href: resolve('/(main)/settings/phone'),
      label: m.phone_settings(),
      icon: 'fa-phone',
      warn: !data.user.phoneCountryCode || !data.user.phone
    },
    {
      href: resolve('/(main)/settings/account'),
      label: m.account_settings(),
      icon: 'fa-cog'
    }
  ]);

  const isActive = (href: string, exact = false) => {
    if (exact) {
      return page.url.pathname === href;
    }
    return page.url.pathname.startsWith(href);
  };
</script>

<svelte:head>
  <title>{pageTitle(m.settings())}</title>
</svelte:head>

<div class="pt-12">
  <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
    <div class="lg:grid lg:grid-cols-12 lg:gap-8">
      <!-- Sidebar Navigation -->
      <div class="lg:col-span-3">
        <div class="sticky top-4">
          <div class="bg-base-200 rounded-xl p-4">
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
                  {#if item.warn}
                    <span
                      class="badge badge-warning badge-sm ml-auto transition-opacity"
                      class:opacity-0={isActive(item.href, item.exact)}
                      title={m.action_required()}
                    >
                      <i class="fa-solid fa-triangle-exclamation"></i>
                    </span>
                  {/if}
                </a>
              {/each}
            </nav>
          </div>
        </div>
      </div>

      <!-- Main Content -->
      <div class="mt-8 lg:col-span-9 lg:mt-0">
        <div class="bg-base-200 rounded-xl p-6">
          {@render children()}
        </div>
      </div>
    </div>
  </div>
</div>
