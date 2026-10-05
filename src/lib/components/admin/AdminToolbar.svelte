<script lang="ts">
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { m } from '$lib/paraglide/messages';

  export interface AdminFilterOption {
    value: string;
    label: string;
  }

  export interface AdminFilter {
    /** Query-param name, e.g. `status`. */
    name: string;
    /** Localized label rendered above the select. */
    label: string;
    options: AdminFilterOption[];
    /** Value meaning "no filter" — stripped from the URL. Defaults to `''`. */
    emptyValue?: string;
    /** Optional Tailwind width for the control, e.g. `lg:w-48`. */
    class?: string;
  }

  interface Props {
    /** Placeholder for the search field. */
    placeholder: string;
    /** Query-param used for the search term. Defaults to `search`. */
    searchParam?: string;
    /** Declarative select filters, rendered after the search field. */
    filters?: AdminFilter[];
    /** Shows a spinner inside the search field while a request is in flight. */
    loading?: boolean;
    /** Total row count for the active query, shown as a result summary. */
    total?: number | null;
    /** Extra controls appended after the filters. */
    extra?: Snippet;
    /** Full-width secondary row beneath the main controls, e.g. a date range. */
    advanced?: Snippet;
  }

  let {
    placeholder,
    searchParam = 'search',
    filters = [],
    loading = false,
    total = null,
    extra,
    advanced
  }: Props = $props();

  const DEBOUNCE_MS = 300;

  const uid = $props.id();
  const searchId = `admin-search-${uid}`;

  const emptyValueFor = (filter: AdminFilter) => filter.emptyValue ?? '';

  /** Snapshot of all toolbar-owned query params, read straight from the URL. */
  const readFromUrl = () => {
    const params = page.url.searchParams;
    const next: Record<string, string> = {};
    for (const filter of filters) {
      next[filter.name] = params.get(filter.name) ?? emptyValueFor(filter);
    }
    return {
      search: params.get(searchParam) ?? '',
      filters: next
    };
  };

  const initial = readFromUrl();

  let search = $state(initial.search);
  let filterValues = $state<Record<string, string>>(initial.filters);
  let composing = $state(false);
  /** True while a local edit has not yet been reflected in the URL. */
  let pending = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const sameFilters = (a: Record<string, string>, b: Record<string, string>) =>
    filters.every((filter) => (a[filter.name] ?? '') === (b[filter.name] ?? ''));

  const commit = () => {
    const url = new URL(page.url);
    const trimmed = search.trim();

    if (trimmed) url.searchParams.set(searchParam, trimmed);
    else url.searchParams.delete(searchParam);

    for (const filter of filters) {
      const value = filterValues[filter.name] ?? '';
      if (value === '' || value === emptyValueFor(filter)) url.searchParams.delete(filter.name);
      else url.searchParams.set(filter.name, value);
    }

    // Any change to search or filters invalidates the current page number.
    url.searchParams.delete('page');

    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${page.url.pathname}${page.url.search}${page.url.hash}`;
    if (next !== current) {
      goto(next, { replaceState: true, keepFocus: true, noScroll: true });
    }
  };

  const scheduleCommit = () => {
    clearTimeout(timer);
    timer = setTimeout(commit, DEBOUNCE_MS);
  };

  const handleSearchInput = () => {
    pending = true;
    // Skip while an IME composition is in flight; `compositionend` schedules instead.
    if (composing) return;
    scheduleCommit();
  };

  const handleSearchCompositionStart = () => {
    composing = true;
  };

  const handleSearchCompositionEnd = () => {
    composing = false;
    handleSearchInput();
  };

  const handleFilterChange = (filter: AdminFilter, value: string) => {
    pending = true;
    filterValues[filter.name] = value;
    clearTimeout(timer);
    commit();
  };

  const clearAll = () => {
    clearTimeout(timer);
    search = '';
    for (const filter of filters) {
      filterValues[filter.name] = emptyValueFor(filter);
    }
    commit();
  };

  // Reconcile with the URL when it changes from outside this component
  // (deep links, browser back/forward, programmatic navigation). While a local
  // edit is in flight the local state wins, so the cursor is never yanked.
  $effect(() => {
    const fromUrl = readFromUrl();
    const urlCaughtUp = fromUrl.search === search && sameFilters(fromUrl.filters, filterValues);

    if (urlCaughtUp) {
      pending = false;
      return;
    }
    if (pending) return;

    if (fromUrl.search !== search) search = fromUrl.search;
    if (!sameFilters(fromUrl.filters, filterValues)) filterValues = fromUrl.filters;
  });

  $effect(() => () => clearTimeout(timer));

  const activeCount = $derived(
    (search.trim() ? 1 : 0) +
      filters.filter(
        (filter) =>
          !!filterValues[filter.name] && filterValues[filter.name] !== emptyValueFor(filter)
      ).length
  );
</script>

<div class="bg-base-100 border-base-300 rounded-lg border p-4 shadow-sm">
  <div class="flex flex-col gap-4 lg:flex-row lg:items-end">
    <div class="form-control flex-1">
      <label class="label" for={searchId}>
        <span class="label-text font-medium">{m.search()}</span>
      </label>
      <label class="input input-bordered flex w-full items-center gap-2" for={searchId}>
        <i class="fa-solid fa-magnifying-glass text-base-content/50"></i>
        <input
          id={searchId}
          type="search"
          class="grow"
          {placeholder}
          autocomplete="off"
          bind:value={search}
          oninput={handleSearchInput}
          oncompositionstart={handleSearchCompositionStart}
          oncompositionend={handleSearchCompositionEnd}
        />
        {#if loading}
          <span class="loading loading-spinner loading-sm"></span>
        {/if}
      </label>
    </div>

    {#each filters as filter (filter.name)}
      <div class="form-control {filter.class ?? 'lg:w-48'}">
        <label class="label" for="admin-filter-{filter.name}-{uid}">
          <span class="label-text font-medium">{filter.label}</span>
        </label>
        <select
          id="admin-filter-{filter.name}-{uid}"
          class="select select-bordered w-full"
          value={filterValues[filter.name] ?? emptyValueFor(filter)}
          onchange={(event) => handleFilterChange(filter, event.currentTarget.value)}
        >
          {#each filter.options as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>
    {/each}

    {#if extra}
      <div class="form-control lg:w-auto">{@render extra()}</div>
    {/if}
  </div>

  {#if advanced}
    <div class="border-base-200 mt-4 border-t pt-4">{@render advanced()}</div>
  {/if}

  {#if total !== null || activeCount > 0}
    <div
      class="border-base-200 mt-4 flex flex-wrap items-center gap-2 border-t pt-3 not-sm:justify-center sm:justify-between"
    >
      {#if total !== null}
        <span class="text-base-content/60 text-sm">
          {m.admin_filter_result_count({ count: total })}
        </span>
      {:else}
        <span></span>
      {/if}

      {#if activeCount > 0}
        <div class="flex flex-wrap items-center gap-2">
          <span class="badge badge-soft badge-sm">
            {m.admin_active_filter_count({ count: activeCount })}
          </span>
          <button type="button" class="btn btn-ghost btn-xs" onclick={clearAll}>
            <i class="fa-solid fa-xmark"></i>
            {m.admin_clear_filters()}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>
