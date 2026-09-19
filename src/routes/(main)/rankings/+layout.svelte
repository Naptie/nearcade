<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { m } from '$lib/paraglide/messages';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  const tabs = $derived([
    { route: '/(main)/rankings/metro', label: m.stations_ranking(), icon: 'fa-train-subway' },
    { route: '/(main)/rankings/campus', label: m.campus_rankings(), icon: 'fa-graduation-cap' },
    { route: '/(main)/rankings/region', label: m.region_rankings(), icon: 'fa-earth-asia' }
  ] as const);
</script>

<div class="mx-auto mb-6 px-2 pt-20 sm:container sm:px-4">
  <nav
    aria-label={m.ranking()}
    class="border-base-300 bg-base-200/50 flex flex-wrap gap-1 rounded-2xl border p-1.5"
  >
    {#each tabs as tab (tab.route)}
      <a
        href={resolve(tab.route)}
        aria-current={page.route.id === tab.route ? 'page' : undefined}
        class="focus-visible:outline-primary flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-center text-xs font-medium transition-colors focus-visible:outline-2 sm:flex-none sm:text-sm {page
          .route.id === tab.route
          ? 'bg-base-100 text-primary shadow-sm'
          : 'text-base-content/70 hover:bg-base-100/60 hover:text-base-content'}"
      >
        <i class="fa-solid {tab.icon}" aria-hidden="true"></i>
        {tab.label}
      </a>
    {/each}
  </nav>
</div>

<div class="ranking-content">
  {@render children()}
</div>

<style>
  /* The layout owns header clearance; retain the existing pages unchanged. */
  .ranking-content > :global(.pt-20) {
    padding-top: 0;
  }
</style>
