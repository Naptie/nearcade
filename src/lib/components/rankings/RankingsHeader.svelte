<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { parseRelativeTime, pageTitle } from '$lib/utils';
  import { getLocale } from '$lib/paraglide/runtime';
  import { SORT_CRITERIA } from '$lib/constants';
  import type { SortCriteria } from '$lib/types';

  interface Props {
    title: string;
    description: string;
    cached: boolean;
    stale: boolean;
    cacheTime: Date;
    sortBy: SortCriteria;
  }

  let { title, description, cached, stale, cacheTime, sortBy = $bindable() }: Props = $props();

  const getSortLabel = (sortKey: string): string => {
    const criteria = SORT_CRITERIA.find((s) => s.key === sortKey);
    // @ts-expect-error custom index
    const f = m[`sort_by_${criteria.key}`];
    // @ts-expect-error custom index
    return typeof f === 'function' ? f() : m.sort_by_game_machines({ game: m[criteria.key]() });
  };
</script>

<svelte:head>
  <title>{pageTitle(title)}</title>
  <meta name="description" content={description} />
  <meta property="og:title" content={pageTitle(title)} />
  <meta property="og:description" content={description} />
  <meta name="twitter:title" content={pageTitle(title)} />
  <meta name="twitter:description" content={description} />
</svelte:head>

<div class="xs:flex-row mb-6 flex flex-col items-center justify-between gap-4 not-sm:px-2">
  <div class="grow">
    <div class="not-xs:justify-center mb-2 flex items-center gap-4">
      <h1 class="text-3xl font-bold">{title}</h1>
      <div class="hidden items-center gap-2 whitespace-nowrap sm:flex">
        {#if stale}
          <div class="badge badge-warning badge-sm">
            <i class="fas fa-clock"></i>
            {m.updated_at({ time: parseRelativeTime(cacheTime, getLocale()) })}
          </div>
        {:else if cached}
          <div class="badge badge-success badge-sm">
            <i class="fas fa-check"></i>
            {m.updated_at({ time: parseRelativeTime(cacheTime, getLocale()) })}
          </div>
        {/if}
      </div>
    </div>
    <p class="text-base-content/70">
      {description}
    </p>
  </div>
  <div class="flex flex-col gap-1">
    <label class="label not-md:mx-auto" for="sort-select">
      <span class="label-text">{m.sort_by()}</span>
    </label>
    <select id="sort-select" class="select select-bordered w-full pe-8" bind:value={sortBy}>
      {#each SORT_CRITERIA as criteria (criteria.key)}
        <option value={criteria.key}>{getSortLabel(criteria.key)}</option>
      {/each}
    </select>
  </div>
</div>
