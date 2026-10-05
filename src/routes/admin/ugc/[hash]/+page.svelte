<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { PageData } from './$types';
  import { page } from '$app/state';
  import { adaptiveNewTab, formatDate } from '$lib/utils';
  import { SvelteSet } from 'svelte/reactivity';
  import { toast, toastError } from '$lib/notifications/toast.svelte';
  import {
    ugcTypeLabel,
    UGC_TYPE_ICONS,
    auditStatusColor,
    auditStatusLabel,
    ugcReasonLabel,
    isKnownUgcReason,
    shortUgcModelName
  } from '$lib/ugc/labels';
  import { topStatus, type UgcContentType } from '$lib/ugc/types';
  import type { UgcOccurrenceItem } from './+page.server';
  import AuditStatuses from '$lib/ugc/components/AuditStatuses.svelte';
  import AdminPage from '$lib/components/admin/AdminPage.svelte';
  import AdminPanel from '$lib/components/admin/AdminPanel.svelte';
  import AdminPagination from '$lib/components/admin/AdminPagination.svelte';
  import AdminEmptyState from '$lib/components/admin/AdminEmptyState.svelte';

  let { data }: { data: PageData } = $props();

  let busy = $state(false);

  /** Live (non-removed) occurrences across the WHOLE hash, not just the page. */
  const nonRemovedTotal = $derived(
    data.summary ? data.summary.occurrences - (data.summary.statusCounts.removed ?? 0) : 0
  );

  const listBase = $derived(page.url.pathname.replace(/\/[^/]+\/?$/, ''));
  const backParam = $derived(page.url.searchParams.get('back'));
  // `back` carries the whole list query, so it survives the occurrence
  // pagination links (AdminPagination preserves every other query param).
  const listHref = $derived(listBase + (backParam ? `?${backParam}` : ''));

  // Occurrence selection (this page) for batch removal/restoration.
  let selectedOccurrences = new SvelteSet<string>();

  const currentPageIds = $derived((data.occurrences ?? []).map((o) => o._id));
  /** Removed occurrences on this page — the only ones restorable. */
  const selectedRemovedIds = $derived(
    (data.occurrences ?? [])
      .filter((o) => o.auditStatus === 'removed' && selectedOccurrences.has(o._id))
      .map((o) => o._id)
  );

  const toggleSelect = (id: string) => {
    if (selectedOccurrences.has(id)) {
      selectedOccurrences.delete(id);
    } else {
      selectedOccurrences.add(id);
    }
  };

  const toggleSelectPage = () => {
    const allSelected = currentPageIds.every((id) => selectedOccurrences.has(id));
    if (allSelected) {
      for (const id of currentPageIds) selectedOccurrences.delete(id);
    } else {
      for (const id of currentPageIds) selectedOccurrences.add(id);
    }
  };

  const selectionCount = $derived(selectedOccurrences.size);

  const postAction = async (payload: Record<string, unknown>): Promise<number> => {
    const response = await fetch(resolve('/api/admin/ugc-entries'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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

  const refresh = async () => {
    await invalidateAll();
  };

  const runHashAction = async (
    action: 'dispatch_audit' | 'mark_pass' | 'remove_all' | 'restore',
    extra: Record<string, unknown> = {}
  ) => {
    if (
      action === 'remove_all' &&
      !confirm(m.admin_ugc_confirm_remove_with_reason({ count: String(nonRemovedTotal) }))
    ) {
      return;
    }
    if (action === 'restore' && !confirm(m.admin_ugc_restore_confirm())) {
      return;
    }
    busy = true;
    try {
      const payload: Record<string, unknown> = { action, hashes: [data.hash], ...extra };
      if (
        (action === 'remove_all' || action === 'mark_pass') &&
        reasonDraft.trim() &&
        reasonDraft.trim() !== (data.summary?.auditReason ?? '')
      ) {
        payload.reason = reasonDraft.trim();
      }
      const affected = await postAction(payload);
      toast(m.admin_ugc_action_done({ count: String(affected) }), { type: 'success' });
      await refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : m.internal_server_error());
    } finally {
      busy = false;
    }
  };

  // Review metadata (reason/score) editing — independent of audit actions.
  // Score is edited as a 0–100 percentage; stored as 0–1 (auditScore).
  let reasonDraft = $state('');
  let scoreDraft = $state<number | null>(null);
  let metaEdited = $state(false);
  const storedScorePercent = $derived(
    typeof data.summary?.auditScore === 'number' ? Math.round(data.summary.auditScore * 100) : null
  );
  const metaDirty = $derived(
    reasonDraft !== (data.summary?.auditReason ?? '') || scoreDraft !== storedScorePercent
  );
  // Load (and re-load after polling/actions) the stored values into the
  // inputs until the admin actually edits them — a plain dirty-comparison
  // sync would never fire on first render because the empty drafts always
  // differ from a populated summary.
  $effect(() => {
    const reason = data.summary?.auditReason ?? '';
    const percent = storedScorePercent;
    if (!metaEdited) {
      reasonDraft = reason;
      scoreDraft = percent;
    }
  });

  const saveMeta = async () => {
    busy = true;
    try {
      const payload: Record<string, unknown> = { action: 'edit_meta', hashes: [data.hash] };
      const currentReason = data.summary?.auditReason ?? '';
      const nextReason = reasonDraft.trim();
      if (nextReason !== currentReason) {
        if (nextReason === '') {
          payload.unset = true;
        } else {
          payload.reason = nextReason;
        }
      }
      if (scoreDraft !== storedScorePercent) {
        if (scoreDraft === null) {
          payload.unset = true;
        } else {
          payload.score = scoreDraft / 100;
        }
      }
      if (payload.reason === undefined && payload.score === undefined && !payload.unset) {
        return;
      }
      await postAction(payload);
      metaEdited = false;
      toast(m.admin_ugc_meta_saved(), { type: 'success' });
      await refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : m.internal_server_error());
    } finally {
      busy = false;
    }
  };

  const runOccurrenceAction = async (entry: UgcOccurrenceItem) => {
    if (!confirm(m.admin_ugc_confirm_remove({ count: '1' }))) return;
    busy = true;
    try {
      const affected = await postAction({ action: 'remove', ids: [entry._id] });
      toast(m.admin_ugc_action_done({ count: String(affected) }), { type: 'success' });
      await refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : m.internal_server_error());
    } finally {
      busy = false;
    }
  };

  const runOccurrenceRestore = async (entry: UgcOccurrenceItem) => {
    if (!confirm(m.admin_ugc_restore_confirm())) return;
    busy = true;
    try {
      const affected = await postAction({ action: 'restore', ids: [entry._id] });
      toast(m.admin_ugc_action_done({ count: String(affected) }), { type: 'success' });
      await refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : m.internal_server_error());
    } finally {
      busy = false;
    }
  };

  const runBatchRestore = async () => {
    if (selectedRemovedIds.length === 0) return;
    if (!confirm(m.admin_ugc_restore_confirm())) return;
    busy = true;
    try {
      const affected = await postAction({ action: 'restore', ids: selectedRemovedIds });
      toast(m.admin_ugc_action_done({ count: String(affected) }), { type: 'success' });
      selectedOccurrences.clear();
      await refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : m.internal_server_error());
    } finally {
      busy = false;
    }
  };

  const runBatchRemove = async () => {
    const count = selectionCount;
    if (count === 0) return;
    if (!confirm(m.admin_ugc_confirm_remove({ count: String(count) }))) return;
    busy = true;
    try {
      const affected = await postAction({ action: 'remove', ids: [...selectedOccurrences] });
      toast(m.admin_ugc_action_done({ count: String(affected) }), { type: 'success' });
      selectedOccurrences.clear();
      await refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : m.internal_server_error());
    } finally {
      busy = false;
    }
  };

  const removedTotal = $derived(data.summary?.statusCounts.removed ?? 0);

  // Live detail view: refresh every 5s while visible, paused during actions.
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
      if (!busy) await refresh();
    }, 5000);
    return () => clearInterval(interval);
  });

  const typeLabel = (type: UgcContentType): string => ugcTypeLabel(type);
</script>

<AdminPage title={m.admin_ugc_content_hash()} backHref={listHref} backLabel={m.admin_ugc()}>
  {#snippet actions()}
    <!-- Hash-level actions -->
    <button
      class="btn btn-success btn-soft btn-sm"
      disabled={busy || nonRemovedTotal === 0}
      onclick={() => runHashAction('mark_pass')}
    >
      <i class="fa-solid fa-check"></i>
      {m.admin_ugc_mark_pass()}
    </button>
    <button
      class="btn btn-info btn-soft btn-sm"
      disabled={busy || nonRemovedTotal === 0}
      onclick={() => runHashAction('dispatch_audit')}
    >
      <i class="fa-solid fa-robot"></i>
      {m.admin_ugc_reaudit()}
    </button>
    <button
      class="btn btn-error btn-soft btn-sm"
      disabled={busy || nonRemovedTotal === 0}
      onclick={() => runHashAction('remove_all')}
    >
      <i class="fa-solid fa-broom"></i>
      {m.admin_ugc_remove_all_hash()}
    </button>
    {#if removedTotal > 0}
      <button
        class="btn btn-warning btn-soft btn-sm"
        disabled={busy}
        title={m.admin_ugc_restore_hint()}
        onclick={() => runHashAction('restore')}
      >
        <i class="fa-solid fa-rotate-left"></i>
        {m.admin_ugc_restore()}
      </button>
    {/if}
  {/snippet}

  <!--
    The 64-char hash stays body content rather than AdminPage's `description`:
    that slot has no `font-mono text-xs break-all`, so the hash would render at
    body size in a proportional font and overflow narrow screens.
  -->
  <p class="text-base-content/60 font-mono text-xs break-all">{data.hash}</p>

  <!-- Summary card -->
  {#if data.summary}
    <AdminPanel padded>
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="badge badge-soft badge-sm badge-{auditStatusColor(topStatus(data.summary))}">
          {auditStatusLabel(topStatus(data.summary))}
        </span>
        {#each data.summary.types as type (type)}
          <span class="badge badge-ghost badge-sm gap-1">
            <i class="fa-solid {UGC_TYPE_ICONS[type]} text-[0.65rem]"></i>
            {typeLabel(type)}
          </span>
        {/each}
      </div>

      {#if data.summary.text}
        <p class="text-base-content/70 mt-2 text-sm break-all whitespace-pre-wrap">
          {data.summary.text}
        </p>
      {/if}

      <div class="mt-3 flex flex-wrap gap-1.5">
        <AuditStatuses item={data.summary} />
        {#if data.summary.auditModel}
          <span
            class="badge badge-soft badge-sm font-mono"
            title="{m.admin_ugc_model()}: {data.summary.auditModel}"
          >
            <i class="fa-solid fa-microchip"></i>
            {shortUgcModelName(data.summary.auditModel)}
          </span>
        {/if}
      </div>

      <!-- Review metadata editor (reason/score) — independent of audit actions -->
      <div class="border-base-200 mt-4 border-t pt-4">
        <div class="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label class="form-control">
            <span class="label-text mb-1 text-xs font-medium">{m.admin_ugc_reason()}</span>
            <input
              type="text"
              class="input input-bordered input-sm w-full"
              placeholder={m.admin_ugc_reason_placeholder()}
              bind:value={reasonDraft}
              oninput={() => (metaEdited = true)}
              disabled={busy}
            />
          </label>
          <label class="form-control">
            <span class="label-text mb-1 text-xs font-medium">{m.admin_ugc_score()}</span>
            <label class="input input-bordered input-sm w-full">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                class="grow"
                bind:value={scoreDraft}
                oninput={() => (metaEdited = true)}
                disabled={busy}
              />
              <span class="text-current/70">%</span>
            </label>
          </label>
        </div>
        {#if isKnownUgcReason(reasonDraft.trim())}
          <p class="text-warning mt-1 text-xs">
            {ugcReasonLabel(reasonDraft.trim())}
          </p>
        {/if}
        <div class="mt-2 flex items-center gap-2">
          <button
            class="btn btn-primary btn-soft btn-sm"
            disabled={busy || !metaDirty}
            onclick={saveMeta}
          >
            <i class="fa-solid fa-floppy-disk"></i>
            {m.admin_ugc_edit_meta()}
          </button>
          {#if metaDirty}
            <button
              class="btn btn-ghost btn-sm"
              disabled={busy}
              onclick={() => {
                metaEdited = false;
                reasonDraft = data.summary?.auditReason ?? '';
                scoreDraft = storedScorePercent;
              }}
            >
              {m.cancel()}
            </button>
          {/if}
        </div>
      </div>
    </AdminPanel>
  {/if}

  <!-- Occurrences -->
  <AdminPanel>
    <div
      class="border-base-200 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
    >
      <div class="flex items-center gap-2">
        <h2 class="text-base-content font-semibold">{m.admin_ugc_occurrence_heading()}</h2>
        {#if data.summary}
          <span class="text-base-content/60 text-sm">
            {data.summary.occurrences}
          </span>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <button
          class="btn btn-ghost btn-sm"
          onclick={toggleSelectPage}
          disabled={busy || currentPageIds.length === 0}
        >
          {currentPageIds.every((id) => selectedOccurrences.has(id))
            ? m.admin_ugc_deselect_page()
            : m.admin_ugc_select_page()}
        </button>
        {#if selectionCount > 0}
          <span class="text-base-content/70 text-sm">{selectionCount} {m.admin_ugc_selected()}</span
          >
        {/if}
        <button
          class="btn btn-error btn-soft btn-sm"
          disabled={busy || selectionCount === 0}
          onclick={() => runBatchRemove()}
        >
          <i class="fa-solid fa-trash"></i>
          {m.admin_ugc_remove()}
        </button>
        {#if selectedRemovedIds.length > 0}
          <button
            class="btn btn-warning btn-soft btn-sm"
            disabled={busy}
            title={m.admin_ugc_restore_hint()}
            onclick={() => runBatchRestore()}
          >
            <i class="fa-solid fa-rotate-left"></i>
            {m.admin_ugc_restore()} ({selectedRemovedIds.length})
          </button>
        {/if}
      </div>
    </div>

    {#if data.occurrences.length === 0}
      <AdminEmptyState icon="fa-inbox" title={m.admin_ugc_empty()} />
    {:else}
      <div class="divide-base-200 divide-y">
        {#each data.occurrences as item (item._id)}
          <div class="hover:bg-base-200/50 flex gap-3 p-4 transition-colors">
            <!-- Selection -->
            <div class="flex items-start pt-0.5">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                checked={selectedOccurrences.has(item._id)}
                disabled={busy}
                onchange={() => toggleSelect(item._id)}
              />
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="badge badge-soft badge-sm badge-{auditStatusColor(item.auditStatus)}">
                  {auditStatusLabel(item.auditStatus)}
                </span>
                <span class="badge badge-ghost badge-sm gap-1">
                  <i class="fa-solid {UGC_TYPE_ICONS[item.type]} text-[0.65rem]"></i>
                  {typeLabel(item.type)}
                </span>
                {#if item.auditSource}
                  <span class="badge badge-soft badge-sm">
                    {item.auditSource === 'llm'
                      ? m.ai()
                      : item.auditSource === 'prefilter'
                        ? m.admin_ugc_source_prefilter()
                        : m.admin_ugc_source_manual()}
                  </span>
                {/if}
                {#if item.auditModel}
                  <span
                    class="badge badge-soft badge-sm font-mono"
                    title="{m.admin_ugc_model()}: {item.auditModel}"
                  >
                    <i class="fa-solid fa-microchip"></i>
                    {shortUgcModelName(item.auditModel)}
                  </span>
                {/if}
                {#if item.href}
                  <a
                    class="btn btn-xs btn-ghost"
                    href={item.href}
                    target={adaptiveNewTab()}
                    aria-label={m.view()}
                  >
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                  </a>
                {/if}
              </div>

              {#if item.auditReason}
                <p class="text-base-content/80 mt-2 line-clamp-2 text-sm break-all">
                  {ugcReasonLabel(item.auditReason)}
                </p>
              {/if}
              {#if item.preview}
                <p
                  class="text-base-content/60 mt-1 line-clamp-3 text-sm break-all whitespace-pre-wrap"
                >
                  {item.preview}
                </p>
              {/if}

              <div
                class="text-base-content/50 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
              >
                {#if item.authorName}
                  <span><i class="fa-solid fa-user mr-1"></i>@{item.authorName}</span>
                {/if}
                {#if typeof item.auditScore === 'number' && item.auditScore > 0}
                  <span>
                    <i class="fa-solid fa-gauge-high mr-1"></i>{(item.auditScore * 100).toFixed(0)}%
                  </span>
                {/if}
                <span class="font-mono"
                  >{item.type}{item.key ? `:${item.key}` : ''}:{item.refId}</span
                >
                <span>{formatDate(new Date(item.updatedAt))}</span>
              </div>
            </div>

            <div class="flex shrink-0 items-start gap-1.5">
              {#if item.auditStatus !== 'removed'}
                <button
                  class="btn btn-error btn-soft btn-xs"
                  disabled={busy}
                  onclick={() => runOccurrenceAction(item)}
                >
                  <i class="fa-solid fa-trash"></i>
                  {m.admin_ugc_remove()}
                </button>
              {:else}
                <button
                  class="btn btn-warning btn-soft btn-xs"
                  disabled={busy}
                  title={m.admin_ugc_restore_hint()}
                  onclick={() => runOccurrenceRestore(item)}
                >
                  <i class="fa-solid fa-rotate-left"></i>
                  {m.admin_ugc_restore()}
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- Pagination (keeps the `back` list filter alive across pages) -->
      <AdminPagination currentPage={data.currentPage} hasMore={data.hasMore} />
    {/if}
  </AdminPanel>
</AdminPage>
