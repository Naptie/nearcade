<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { PageData } from './$types';
  import { page } from '$app/state';
  import { adaptiveNewTab, formatDateTime, pageTitle, parseRelativeTime } from '$lib/utils';
  import { SvelteSet } from 'svelte/reactivity';
  import { toast, toastError } from '$lib/notifications/toast.svelte';
  import { topStatus, UGC_CONTENT_TYPES } from '$lib/ugc/types';
  import {
    ugcTypeLabel,
    UGC_TYPE_ICONS,
    AUDIT_STATUSES,
    auditStatusColor,
    auditStatusLabel
  } from '$lib/ugc/labels';
  import { getLocale } from '$lib/paraglide/runtime';
  import AuditStatuses from '$lib/ugc/components/AuditStatuses.svelte';

  let { data }: { data: PageData } = $props();

  // Local search state (not derived from `data`): keeps the field editable
  // while the debounced navigation runs, so focus/IME composition are never
  // interrupted (mirrors the client-side search pattern on the users page).
  let searchQuery = $state('');
  let searchInput: HTMLInputElement | undefined = $state();
  let composing = false;
  let searchTimeout: ReturnType<typeof setTimeout> | undefined;
  let busy = $state(false);

  // Reconcile only on *external* changes (first render, back/forward, filter
  // clicks, batch-action reloads) — never while the user is typing/composing.
  $effect(() => {
    const urlSearch = data.search ?? '';
    if (urlSearch !== searchQuery && !composing && document.activeElement !== searchInput) {
      searchQuery = urlSearch;
    }
  });

  const handleSearchCompositionStart = () => {
    composing = true;
  };

  const handleSearchCompositionEnd = () => {
    composing = false;
  };

  const handleSearchInput = () => {
    // Never navigate mid-composition (IME); the commit fires `input` again.
    if (composing) return;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      updateSearch();
    }, 300);
  };

  const updateSearch = () => {
    const url = new URL(page.url);
    if (searchQuery.trim()) {
      url.searchParams.set('search', searchQuery.trim());
    } else {
      url.searchParams.delete('search');
    }
    url.searchParams.delete('page');
    goto(url.toString());
  };

  // Per-page selection + "select all matching" (db-wide) mode. Selection is
  // by CONTENT HASH (each list item is one hash).
  let selected = new SvelteSet<string>();
  let selectAllMatching = $state(false);

  /** Precise content-type options for the single-select filter. */
  const TYPES: { value: string; label: string; icon: string }[] = [
    { value: 'all', label: m.all_types(), icon: 'fa-shield-halved' },
    ...UGC_CONTENT_TYPES.map((type) => ({
      value: type,
      label: ugcTypeLabel(type),
      icon: UGC_TYPE_ICONS[type]
    }))
  ];

  /** Count for a type option under the current status/search filter. */
  const typeCount = (value: string): number =>
    value === 'all'
      ? Object.values(data.typeCounts ?? {}).reduce((sum, n) => sum + n, 0)
      : (data.typeCounts?.[value] ?? 0);

  const setFilter = (key: string, value: string) => {
    const url = new URL(page.url);
    url.searchParams.set(key, value);
    url.searchParams.delete('page');
    goto(url.toString());
  };

  // Selection -------------------------------------------------------------

  const currentPageIds = $derived(data.items.map((item) => item.hash));

  const toggleSelect = (hash: string) => {
    if (selected.has(hash)) {
      selected.delete(hash);
    } else {
      selected.add(hash);
    }
    selectAllMatching = false;
  };

  const toggleSelectPage = () => {
    const allSelected = currentPageIds.every((id) => selected.has(id));
    if (allSelected) {
      for (const id of currentPageIds) selected.delete(id);
    } else {
      for (const id of currentPageIds) selected.add(id);
    }
    selectAllMatching = false;
  };

  /** True select-all: actions operate on every hash matching the filter. */
  const enableSelectAllMatching = () => {
    selectAllMatching = true;
    selected.clear();
    for (const id of currentPageIds) selected.add(id);
  };

  const selectionCount = $derived(selectAllMatching ? data.totalCount : selected.size);

  // Actions ---------------------------------------------------------------

  const currentQuery = () => ({
    type: data.type !== 'all' ? data.type : undefined,
    status: data.status !== 'all' ? data.status : undefined,
    search: data.search || undefined
  });

  const runAction = async (action: string, hashes?: string[]): Promise<number> => {
    const response = await fetch(resolve('/api/admin/ugc-entries'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        ...(hashes && !selectAllMatching ? { hashes } : { all: true, query: currentQuery() })
      })
    });
    if (!response.ok) {
      let message = '';
      try {
        message = ((await response.json()) as { message?: string }).message ?? '';
      } catch {
        // ignore parse failure
      }
      throw new Error(message || m.internal_server_error());
    }
    const body = (await response.json()) as { affected?: number };
    return body.affected ?? 0;
  };

  const dispatch = async (
    action: 'dispatch_audit' | 'mark_pass' | 'remove_all' | 'restore',
    hashes?: string[]
  ) => {
    if (
      action === 'remove_all' &&
      !confirm(m.admin_ugc_confirm_remove_all_hash({ count: String(selectionCount) }))
    ) {
      return;
    }
    if (action === 'restore' && !confirm(m.admin_ugc_restore_confirm())) {
      return;
    }
    busy = true;
    try {
      const affected = await runAction(action, hashes ?? [...selected]);
      toast(m.admin_ugc_action_done({ count: String(affected) }), { type: 'success' });
      selected.clear();
      selectAllMatching = false;
      await goto(page.url.toString(), { replaceState: true, noScroll: true });
    } catch (err) {
      toastError(err instanceof Error ? err.message : m.internal_server_error());
    } finally {
      busy = false;
    }
  };

  // Live list ---------------------------------------------------------------

  // Keep the entries list fresh: re-run the load every 5s (page visible) and
  // pause while a batch action request is in flight so results never race.
  let documentVisible = $state(true);
  $effect(() => {
    documentVisible = !document.hidden;
    const onVisibility = () => (documentVisible = !document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });
  $effect(() => {
    if (!documentVisible || busy) return;
    const interval = setInterval(async () => {
      if (!busy) await goto(page.url.toString(), { replaceState: true, noScroll: true });
    }, 5000);
    return () => clearInterval(interval);
  });

  // Active jobs -----------------------------------------------------------

  interface JobsQueue {
    queued: number;
    items: { hash: string; text: string; [key: string]: unknown }[];
  }
  interface JobsData {
    audit: JobsQueue;
    translation: JobsQueue;
  }

  let jobsOpen = $state(false);
  let jobsData = $state<JobsData | null>(null);
  let jobsBusy = $state(false);
  let jobsTotal = $state(0);

  const fetchJobs = async (): Promise<JobsData> => {
    const response = await fetch(resolve('/api/admin/ugc/jobs'));
    if (!response.ok) throw new Error(m.internal_server_error());
    return (await response.json()) as JobsData;
  };

  const openJobs = async () => {
    jobsOpen = true;
    jobsBusy = true;
    await refreshJobs();
    jobsBusy = false;
  };

  const refreshJobs = async () => {
    try {
      jobsData = await fetchJobs();
      jobsTotal = jobsData.audit.queued + jobsData.translation.queued;
    } catch {
      jobsData = null;
      jobsTotal = 0;
    }
  };

  const closeJobs = () => {
    jobsOpen = false;
  };

  // Keep a frequent refresh interval while the jobs panel is open.
  $effect(() => {
    if (!jobsOpen) return;
    const interval = setInterval(refreshJobs, 1000);
    return () => clearInterval(interval);
  });

  // Keep an infrequent refresh interval while the jobs panel is closed, to update the badge count.
  $effect(() => {
    if (jobsOpen) return;
    const interval = setInterval(refreshJobs, 10000);
    return () => clearInterval(interval);
  });
</script>

<svelte:head>
  <title>{pageTitle(m.admin_ugc(), m.admin_panel())}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <!-- Page Header -->
  <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
    <div class="not-sm:text-center">
      <h1 class="text-base-content text-3xl font-bold">{m.admin_ugc()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_ugc_description()}</p>
    </div>

    <div class="flex items-center gap-2">
      <div class="stats shadow">
        <div class="stat">
          <div class="stat-title">{m.admin_ugc_stat_unique()}</div>
          <div class="stat-value text-primary">{data.totalCount || 0}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Filters -->
  <div class="bg-base-100 border-base-300 rounded-lg border p-4 shadow-sm">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <label class="form-control w-full max-w-xs">
        <span class="label-text mb-1 font-medium">{m.search()}</span>
        <label class="input input-bordered flex items-center gap-2">
          <i class="fa-solid fa-magnifying-glass text-base-content/50"></i>
          <input
            type="text"
            class="grow"
            placeholder={m.admin_ugc_search_placeholder()}
            bind:value={searchQuery}
            bind:this={searchInput}
            oninput={handleSearchInput}
            oncompositionstart={handleSearchCompositionStart}
            oncompositionend={handleSearchCompositionEnd}
          />
        </label>
      </label>
      <div class="flex flex-wrap items-end gap-3">
        <label class="form-control min-w-44">
          <span class="label-text mb-1 font-medium">{m.admin_type_header()}</span>
          <select
            class="select select-bordered w-full"
            value={data.type}
            onchange={(event) => setFilter('type', event.currentTarget.value)}
          >
            {#each TYPES as typeOption (typeOption.value)}
              <option value={typeOption.value}>
                {typeOption.label} ({typeCount(typeOption.value)})
              </option>
            {/each}
          </select>
        </label>
        <label class="form-control">
          <span class="label-text mb-1 font-medium">{m.admin_ugc_status_filter()}</span>
          <select
            class="select select-bordered w-full min-w-36"
            value={data.status}
            onchange={(event) => setFilter('status', event.currentTarget.value)}
          >
            {#each AUDIT_STATUSES as statusOption (statusOption.value)}
              <option value={statusOption.value}>{statusOption.label}</option>
            {/each}
          </select>
        </label>
      </div>
    </div>
  </div>

  <!-- Batch toolbar -->
  <div
    class="bg-base-100 border-base-300 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 shadow-sm"
  >
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <button class="btn btn-ghost btn-sm" onclick={toggleSelectPage} disabled={busy}>
        <i
          class="fa-solid {currentPageIds.every((id) => selected.has(id))
            ? 'fa-square-minus'
            : 'fa-square-check'}"
        ></i>
        {currentPageIds.every((id) => selected.has(id))
          ? m.admin_ugc_deselect_page()
          : m.admin_ugc_select_page()}
      </button>
      <button
        class="btn btn-ghost btn-sm"
        onclick={enableSelectAllMatching}
        disabled={busy || selectAllMatching}
      >
        {m.admin_ugc_select_all({ count: String(data.totalCount || 0) })}
      </button>
      {#if selectionCount > 0}
        <span class="text-base-content/70 font-medium">
          {selectionCount}
          {m.admin_ugc_selected()}
        </span>
        {#if selectAllMatching}
          <span class="badge badge-info badge-soft badge-sm">{m.admin_ugc_all_matching()}</span>
        {/if}
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <div class="indicator">
        {#if jobsTotal > 0}
          <span class="indicator-item badge badge-info badge-soft badge-sm">{jobsTotal}</span>
        {/if}
        <button class="btn btn-soft btn-sm" onclick={() => openJobs()}>
          <i class="fa-solid fa-list-check"></i>
          {m.admin_ugc_jobs()}
        </button>
      </div>
      <button
        class="btn btn-primary btn-soft btn-sm"
        disabled={busy || selectionCount === 0}
        onclick={() => dispatch('dispatch_audit')}
      >
        <i class="fa-solid fa-robot"></i>
        {m.admin_ugc_dispatch_audit()}
      </button>
      <button
        class="btn btn-success btn-soft btn-sm"
        disabled={busy || selectionCount === 0}
        onclick={() => dispatch('mark_pass')}
      >
        <i class="fa-solid fa-check"></i>
        {m.admin_ugc_mark_pass()}
      </button>
      <button
        class="btn btn-soft btn-sm"
        disabled={busy || selectionCount === 0}
        title={m.admin_ugc_restore_hint()}
        onclick={() => dispatch('restore')}
      >
        <i class="fa-solid fa-rotate-left"></i>
        {m.admin_ugc_restore()}
      </button>
      <button
        class="btn btn-error btn-soft btn-sm"
        disabled={busy || selectionCount === 0}
        onclick={() => dispatch('remove_all')}
      >
        <i class="fa-solid fa-trash"></i>
        {m.admin_ugc_remove_all_hash()}
      </button>
    </div>
  </div>

  <!-- Hash list -->
  {#if data.items.length === 0}
    <div class="py-12 text-center">
      <div class="text-base-content/20 mb-4 text-6xl">
        <i class="fa-solid fa-shield-halved"></i>
      </div>
      <h3 class="mb-2 text-xl font-semibold">{m.admin_ugc_empty()}</h3>
    </div>
  {:else}
    <div class="bg-base-100 border-base-300 rounded-lg border shadow-sm">
      <div class="divide-base-200 divide-y">
        {#each data.items as item (item.hash)}
          <div class="hover:bg-base-200/50 flex gap-3 p-4 transition-colors">
            <!-- Selection -->
            <div class="flex items-start pt-0.5">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                checked={selected.has(item.hash)}
                disabled={busy}
                onchange={() => toggleSelect(item.hash)}
              />
            </div>

            <!-- Main content -->
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5">
                <a
                  href={item.href}
                  aria-label={m.admin_ugc_occurrence_heading()}
                  class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5"
                >
                  <span class="badge badge-soft badge-sm badge-{auditStatusColor(topStatus(item))}">
                    {auditStatusLabel(topStatus(item))}
                  </span>
                  {#each item.types as type (type)}
                    <span class="badge badge-ghost badge-sm gap-1">
                      <i class="fa-solid {UGC_TYPE_ICONS[type]} text-[0.65rem]"></i>
                      {ugcTypeLabel(type)}
                    </span>
                  {/each}
                  <span class="text-base-content/60 text-xs">
                    {m.admin_ugc_occurrences({ count: item.occurrences })}
                  </span>
                  <i class="fa-solid fa-chevron-right text-base-content/30 text-xs"></i>
                </a>
                {#if item.occurrences === 1 && item.sourceHref}
                  <a
                    class="btn btn-ghost btn-xs"
                    href={item.sourceHref}
                    target={adaptiveNewTab()}
                    aria-label={m.view()}
                    title={m.view()}
                  >
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    {m.view()}
                  </a>
                {/if}
              </div>

              {#if item.text}
                <p
                  class="text-base-content/60 mt-1 line-clamp-2 text-sm break-all whitespace-pre-wrap"
                >
                  {item.text}
                </p>
              {/if}

              <div
                class="text-base-content/50 mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs"
              >
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {#if item.auditSource}
                    <span class="badge badge-soft badge-sm">
                      {item.auditSource === 'llm'
                        ? m.ai()
                        : item.auditSource === 'prefilter'
                          ? m.admin_ugc_source_prefilter()
                          : m.admin_ugc_source_manual()}
                    </span>
                  {/if}
                  {#if typeof item.auditScore === 'number' && item.auditScore > 0}
                    <span class="badge badge-soft badge-sm">
                      <i class="fa-solid fa-gauge-high"></i>
                      {(item.auditScore * 100).toFixed(0)}%
                    </span>
                  {/if}
                  <AuditStatuses {item} />
                </div>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {#if item.occurrences === 1 && item.authorName}
                    <span><i class="fa-solid fa-user mr-1"></i>@{item.authorName}</span>
                  {/if}
                  {#if item.updatedAt}
                    {@const updatedAt = new Date(item.updatedAt)}
                    <span title={formatDateTime(updatedAt)}
                      >{parseRelativeTime(updatedAt, getLocale())}</span
                    >
                  {/if}
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Pagination -->
    <div class="flex justify-center gap-2">
      {#if (data.currentPage || 1) > 1}
        <a
          href="?page={(data.currentPage || 1) -
            1}&status={data.status}&type={data.type}{data.search
            ? `&search=${encodeURIComponent(data.search)}`
            : ''}"
          class="btn btn-soft"
        >
          {m.previous_page()}
        </a>
      {/if}
      <span class="btn btn-disabled btn-soft">
        {m.page({ page: data.currentPage || 1 })}
      </span>
      {#if data.hasMore}
        <a
          href="?page={(data.currentPage || 1) +
            1}&status={data.status}&type={data.type}{data.search
            ? `&search=${encodeURIComponent(data.search)}`
            : ''}"
          class="btn btn-soft"
        >
          {m.next_page()}
        </a>
      {/if}
    </div>
  {/if}
</div>

<!-- Active jobs modal -->
<dialog class="modal" class:modal-open={jobsOpen}>
  <div class="modal-box max-w-2xl">
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-bold">
          {m.admin_ugc_jobs_title()}
        </h3>
        <button class="btn btn-ghost btn-sm btn-circle" onclick={closeJobs} aria-label={m.close()}>
          <i class="fa-solid fa-xmark fa-lg"></i>
        </button>
      </div>

      {#if jobsBusy}
        <div class="flex justify-center py-8">
          <span class="loading loading-spinner loading-lg"></span>
        </div>
      {:else if !jobsData}
        <p class="text-base-content/50 py-8 text-center">{m.admin_ugc_jobs_empty()}</p>
      {:else}
        <!-- Audit queue -->
        <div class="border-base-300 overflow-hidden rounded-lg border">
          <div class="bg-base-200/70 flex items-center justify-between px-4 py-2.5">
            <div class="flex items-center gap-2">
              <span
                class="bg-error/10 text-error flex size-7 items-center justify-center rounded-full"
              >
                <i class="fa-solid fa-shield-halved text-xs"></i>
              </span>
              <h4 class="text-base-content text-sm font-semibold">
                {m.admin_ugc_jobs_audit_queue()}
              </h4>
            </div>
            <span class="badge badge-error badge-soft badge-sm">{jobsData.audit.queued}</span>
          </div>
          {#if jobsData.audit.items.length === 0}
            <p class="text-base-content/50 px-4 py-5 text-center text-sm">
              {m.admin_ugc_jobs_empty()}
            </p>
          {:else}
            <ul class="divide-base-200 max-h-72 divide-y overflow-y-auto text-sm">
              {#each jobsData.audit.items as job, i (job.hash)}
                <li
                  class="flex items-start gap-3 px-4 py-2.5 {i === 0
                    ? 'bg-primary/5 ring-primary/30 ring-1 ring-inset'
                    : ''}"
                >
                  <span class="text-base-content/40 mt-0.5 font-mono text-xs">#{i + 1}</span>
                  <i class="fa-solid fa-shield-halved text-error/60 mt-1 text-xs"></i>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="font-mono text-xs break-all"
                        >{String(job.hash).slice(0, 18)}…</span
                      >
                      {#if job.kind}
                        <span class="badge badge-ghost badge-xs">{String(job.kind)}</span>
                      {/if}
                      {#if job.refId}
                        <span class="text-base-content/40 font-mono text-xs"
                          >#{String(job.refId)}</span
                        >
                      {/if}
                      {#if i === 0}
                        <span class="badge badge-primary badge-soft badge-xs"
                          >{m.admin_ugc_jobs_next()}</span
                        >
                      {/if}
                    </div>
                    <p class="text-base-content/60 mt-0.5 line-clamp-1 break-all">
                      {String(job.text ?? '')}
                    </p>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <!-- Translation queue -->
        <div class="border-base-300 overflow-hidden rounded-lg border">
          <div class="bg-base-200/70 flex items-center justify-between px-4 py-2.5">
            <div class="flex items-center gap-2">
              <span
                class="bg-info/10 text-info flex size-7 items-center justify-center rounded-full"
              >
                <i class="fa-solid fa-language text-xs"></i>
              </span>
              <h4 class="text-base-content text-sm font-semibold">
                {m.admin_ugc_jobs_translation_queue()}
              </h4>
            </div>
            <span class="badge badge-info badge-soft badge-sm">{jobsData.translation.queued}</span>
          </div>
          {#if jobsData.translation.items.length === 0}
            <p class="text-base-content/50 px-4 py-5 text-center text-sm">
              {m.admin_ugc_jobs_empty()}
            </p>
          {:else}
            <ul class="divide-base-200 max-h-72 divide-y overflow-y-auto text-sm">
              {#each jobsData.translation.items as job, i (String(job.hash) + String((job as { targets?: string[] }).targets))}
                <li
                  class="flex items-start gap-3 px-4 py-2.5 {i === 0
                    ? 'bg-primary/5 ring-primary/30 ring-1 ring-inset'
                    : ''}"
                >
                  <span class="text-base-content/40 mt-0.5 font-mono text-xs">#{i + 1}</span>
                  <i class="fa-solid fa-language text-info/60 mt-1 text-xs"></i>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="font-mono text-xs break-all"
                        >{String(job.hash).slice(0, 18)}…</span
                      >
                      {#each (job as { targets?: string[] }).targets ?? [] as target (target)}
                        <span class="badge badge-ghost badge-xs"
                          >{String(target).toUpperCase()}</span
                        >
                      {/each}
                      {#if i === 0}
                        <span class="badge badge-primary badge-soft badge-xs"
                          >{m.admin_ugc_jobs_next()}</span
                        >
                      {/if}
                    </div>
                    <p class="text-base-content/60 mt-0.5 line-clamp-1 break-all">
                      {String(job.text ?? '')}
                    </p>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={closeJobs}>{m.close()}</button>
  </form>
</dialog>
