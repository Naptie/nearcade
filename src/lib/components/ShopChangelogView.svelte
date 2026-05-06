<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { onMount } from 'svelte';
  import { createTwoFilesPatch } from 'diff';
  import * as Diff2Html from 'diff2html';
  import 'diff2html/bundles/css/diff2html.min.css';
  import { m } from '$lib/paraglide/messages';
  import type { Shop, ShopChangelogEntryWithUser } from '$lib/types';
  import {
    formatShopChangelogDescription,
    getShopChangelogActionName,
    getShopChangelogActionBadgeClass,
    getShopChangelogActionIcon
  } from '$lib/utils/shopChangelog';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import { getLocale } from '$lib/paraglide/runtime';
  import { formatDistanceToNow } from 'date-fns';
  import { getDisplayName, getFnsLocale } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import { resolve } from '$app/paths';

  interface Props {
    shopId: number;
    isSiteAdmin?: boolean;
    onRollbackApplied?: () => void | Promise<void>;
  }

  let { shopId, isSiteAdmin = false, onRollbackApplied }: Props = $props();

  let entries = $state<ShopChangelogEntryWithUser[]>([]);
  let isLoading = $state(true);
  let isLoadingMore = $state(false);
  let hasMore = $state(true);
  let currentPage = $state(1);
  let error = $state<string | null>(null);
  let rollbackPreview = $state<{
    targetEntryId: string | null;
    currentShop: Shop;
    rolledBackShop: Shop;
    appliedEntryIds: string[];
    rollbackEntryCount: number;
  } | null>(null);
  let rollbackError = $state<string | null>(null);
  let isPreviewingRollback = $state(false);
  let isApplyingRollback = $state(false);
  let rollbackDiffHtml = $state('');

  const ITEMS_PER_PAGE = 10;

  const stringifyJson = (value: unknown) => JSON.stringify(value, null, 2);

  const renderJsonDiff = (currentShop: Shop, rolledBackShop: Shop) => {
    const patch = createTwoFilesPatch(
      m.shop_changelog_rollback_current_state(),
      m.shop_changelog_rollback_target_state(),
      stringifyJson(currentShop),
      stringifyJson(rolledBackShop),
      '',
      '',
      { context: Number.MAX_SAFE_INTEGER }
    );

    return Diff2Html.html(patch, {
      drawFileList: false,
      matching: 'lines',
      outputFormat: 'side-by-side',
      renderNothingWhenEmpty: false
    })
      .replace(/\s*<tr>\s*<td[^>]*d2h-info[\s\S]*?<\/tr>\s*/g, '')
      .replace(/\s*<span class="d2h-code-line-prefix">[\s\S]*?<\/span>\s*/g, '');
  };

  const loadEntries = async (page = 1, append = false) => {
    if (page === 1) {
      isLoading = true;
      error = null;
    } else {
      isLoadingMore = true;
    }

    try {
      const response = await fetch(
        fromPath(`/api/shops/${shopId}/changelog?page=${page}&limit=${ITEMS_PER_PAGE}`)
      );
      if (!response.ok) throw new Error('Failed to load changelog');

      const data = (await response.json()) as {
        entries: ShopChangelogEntryWithUser[];
        hasMore: boolean;
        total: number;
        page: number;
        limit: number;
      };

      entries = append ? [...entries, ...data.entries] : data.entries;
      hasMore = data.hasMore;
      currentPage = page;
    } catch (err) {
      console.error('Error loading shop changelog:', err);
      error = err instanceof Error ? err.message : 'Failed to load changelog';
    } finally {
      isLoading = false;
      isLoadingMore = false;
    }
  };

  const loadMore = async () => {
    if (!hasMore || isLoadingMore) return;
    await loadEntries(currentPage + 1, true);
  };

  const deleteEntry = async (entry: ShopChangelogEntryWithUser) => {
    if (!confirm(m.shop_changelog_rollback_delete_confirm())) return;

    const response = await fetch(fromPath(`/api/shops/${shopId}/changelog/${entry.id}`), {
      method: 'DELETE'
    });

    if (!response.ok) {
      error = m.failed_to_fetch_changelog_entries();
      return;
    }

    entries = entries.filter((item) => item.id !== entry.id);
  };

  const previewRollback = async (entry: ShopChangelogEntryWithUser) => {
    rollbackError = null;
    isPreviewingRollback = true;

    try {
      const response = await fetch(fromPath(`/api/shops/${shopId}/changelog/rollback`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEntryId: entry.id })
      });

      if (!response.ok) throw new Error(await response.text());
      rollbackPreview = (await response.json()) as typeof rollbackPreview;
      if (rollbackPreview) {
        rollbackDiffHtml = renderJsonDiff(
          rollbackPreview.currentShop,
          rollbackPreview.rolledBackShop
        );
      }
    } catch (err) {
      console.error('Failed to preview rollback:', err);
      rollbackError = m.shop_changelog_rollback_preview_failed();
    } finally {
      isPreviewingRollback = false;
    }
  };

  const applyRollback = async () => {
    if (!rollbackPreview || isApplyingRollback) return;
    isApplyingRollback = true;
    rollbackError = null;

    try {
      const response = await fetch(fromPath(`/api/shops/${shopId}/changelog/rollback`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEntryId: rollbackPreview.targetEntryId })
      });

      if (!response.ok) throw new Error(await response.text());
      rollbackPreview = null;
      rollbackDiffHtml = '';
      await loadEntries();
      await onRollbackApplied?.();
    } catch (err) {
      console.error('Failed to apply rollback:', err);
      rollbackError = m.failed_to_update();
    } finally {
      isApplyingRollback = false;
    }
  };

  onMount(() => {
    loadEntries();
  });
</script>

<div class="bg-base-100 rounded-lg">
  {#if isLoading}
    <div class="flex items-center justify-center p-8">
      <span class="loading loading-spinner loading-lg"></span>
      <span class="ml-2">{m.changelog_loading()}</span>
    </div>
  {:else if error}
    <div class="alert alert-error m-4">
      <i class="fa-solid fa-exclamation-triangle"></i>
      <span>{error}</span>
      <div>
        <button class="btn btn-sm btn-outline" onclick={() => loadEntries()}>
          {m.retry()}
        </button>
      </div>
    </div>
  {:else if entries.length === 0}
    <div class="p-8 text-center">
      <i class="fa-solid fa-clock-rotate-left text-base-content/30 mb-4 text-5xl"></i>
      <h4 class="mb-2 text-lg font-medium">{m.changelog_no_entries()}</h4>
      <p class="text-base-content/60">{m.shop_changelog_description()}</p>
    </div>
  {:else}
    <div class="divide-base-200 divide-y">
      {#each entries as entry (entry.id)}
        <div class="hover:bg-base-50 p-4 transition-colors" id="shop-entry-{entry.id}">
          <div class="flex gap-3">
            <!-- Action icon -->
            <div class="shrink-0">
              <div class="bg-base-200 flex h-8 w-8 items-center justify-center rounded-full">
                <i class="fa-solid {getShopChangelogActionIcon(entry.action)} text-xs"></i>
              </div>
            </div>

            <!-- Content -->
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1">
                  <!-- User info -->
                  <div class="mb-1 flex items-center gap-2">
                    {#if entry.user}
                      <UserAvatar user={entry.user} size="sm" />
                      <a
                        href={resolve('/(main)/users/[id]', {
                          id: entry.user.name ? '@' + entry.user.name : (entry.userId ?? '')
                        })}
                        class="hover:text-accent text-sm font-medium transition-colors"
                      >
                        {getDisplayName(entry.user) || m.unknown_user()}
                      </a>
                    {:else}
                      <span class="text-base-content/60 text-sm">{m.anonymous_user()}</span>
                    {/if}
                    <span
                      class="badge badge-soft badge-sm not-sm:hidden {getShopChangelogActionBadgeClass(
                        entry.action
                      )}"
                    >
                      {getShopChangelogActionName(entry.action, m)}
                    </span>
                  </div>

                  <!-- Change description -->
                  <div class="text-base-content/80 text-sm">
                    {formatShopChangelogDescription(entry, m)}
                  </div>

                  {#if isSiteAdmin}
                    <div class="mt-2 flex flex-wrap gap-2">
                      <button
                        class="btn btn-primary btn-xs btn-soft"
                        onclick={() => previewRollback(entry)}
                        disabled={isPreviewingRollback}
                      >
                        <i class="fa-solid fa-rotate-left"></i>
                        {m.shop_changelog_rollback_action()}
                      </button>
                      <button
                        class="btn btn-error btn-xs btn-soft"
                        onclick={() => deleteEntry(entry)}
                      >
                        <i class="fa-solid fa-trash"></i>
                        {m.shop_changelog_rollback_delete_action()}
                      </button>
                    </div>
                  {/if}

                  <!-- Photo thumbnail for photo events -->
                  {#if (entry.action === 'photo_uploaded' || entry.action === 'photo_deleted' || entry.action === 'photo_delete_request_submitted' || entry.action === 'photo_delete_request_approved' || entry.action === 'photo_delete_request_rejected') && entry.fieldInfo.photoUrl}
                    <div class="mt-2">
                      <img
                        src={entry.fieldInfo.photoUrl}
                        alt=""
                        class="h-16 w-16 rounded-lg object-cover"
                        loading="lazy"
                      />
                    </div>
                  {/if}
                </div>

                <!-- Timestamp -->
                <div class="text-base-content/60 shrink-0 text-xs">
                  {formatDistanceToNow(entry.createdAt, {
                    addSuffix: true,
                    locale: getFnsLocale(getLocale())
                  })}
                </div>
              </div>

              <!-- Value details for field changes -->
              {#if entry.oldValue || entry.newValue}
                <div class="mt-2 text-xs">
                  {#if entry.oldValue && entry.newValue}
                    <div class="flex flex-col gap-1">
                      <div class="flex items-center gap-2">
                        <span class="text-base-content/60">{m.from()}:</span>
                        <code class="bg-error/10 text-error rounded px-1 text-xs break-all">
                          {entry.oldValue}
                        </code>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-base-content/60">{m.to()}:</span>
                        <code class="bg-success/10 text-success rounded px-1 text-xs break-all">
                          {entry.newValue}
                        </code>
                      </div>
                    </div>
                  {:else if entry.newValue}
                    <div class="flex items-center gap-2">
                      <span class="text-base-content/60">{m.set_to()}:</span>
                      <code class="bg-success/10 text-success rounded px-1 text-xs break-all">
                        {entry.newValue}
                      </code>
                    </div>
                  {:else if entry.oldValue}
                    <div class="flex items-center gap-2">
                      <span class="text-base-content/60">{m.cleared_value()}:</span>
                      <code class="bg-error/10 text-error rounded px-1 text-xs break-all">
                        {entry.oldValue}
                      </code>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>

    <!-- Load more button -->
    {#if hasMore}
      <div class="border-base-200 border-t p-4">
        <button class="btn btn-soft btn-sm w-full" onclick={loadMore} disabled={isLoadingMore}>
          {#if isLoadingMore}
            <span class="loading loading-spinner loading-sm"></span>
            {m.loading()}
          {:else}
            {m.changelog_load_more()}
          {/if}
        </button>
      </div>
    {/if}
  {/if}
</div>

{#if rollbackPreview}
  <div class="modal modal-open">
    <div class="modal-box max-w-5xl overflow-hidden">
      <h3 class="text-lg font-bold">{m.shop_changelog_rollback_preview()}</h3>
      <p class="text-base-content/70 mt-1 text-sm">
        {m.shop_changelog_rollback_preview_description()}
      </p>

      {#if rollbackError}
        <div class="alert alert-error mt-4">
          <i class="fa-solid fa-exclamation-triangle"></i>
          <span>{rollbackError}</span>
        </div>
      {/if}

      <div class="rollback-diff-pane border-base-300 mt-4 overflow-auto rounded-xl border text-xs">
        {@html rollbackDiffHtml}
      </div>

      <div class="modal-action">
        <button
          class="btn btn-ghost"
          onclick={() => {
            rollbackPreview = null;
            rollbackDiffHtml = '';
          }}
          disabled={isApplyingRollback}
        >
          {m.cancel()}
        </button>
        <button class="btn btn-primary" onclick={applyRollback} disabled={isApplyingRollback}>
          {#if isApplyingRollback}<span class="loading loading-spinner loading-sm"></span>{/if}
          {m.shop_changelog_rollback_confirm()}
        </button>
      </div>
    </div>
    <button
      class="modal-backdrop"
      onclick={() => {
        rollbackPreview = null;
        rollbackDiffHtml = '';
      }}>{m.close()}</button
    >
  </div>
{/if}

<style>
  :global(.rollback-diff-pane) {
    max-height: 28rem;
    overflow: auto;
    background: var(--color-base-100);
    color: var(--color-base-content);
  }

  :global(.rollback-diff-pane .d2h-file-wrapper) {
    margin: 0;
    border: 0;
    border-radius: 0;
    background: var(--color-base-100);
  }

  :global(.rollback-diff-pane .d2h-file-header) {
    display: none;
  }

  :global(.rollback-diff-pane .d2h-file-side-diff) {
    display: block;
    flex: 1 1 0;
    width: 50%;
    min-width: 0;
    margin: 0;
    overflow-x: hidden;
  }

  :global(.rollback-diff-pane .d2h-diff-table) {
    width: 100%;
    table-layout: fixed;
    font-family: var(--font-mono, 'JetBrains Mono Variable', monospace);
    font-size: 0.6875rem;
    border-collapse: collapse;
  }

  :global(.rollback-diff-pane .d2h-code-side-linenumber),
  :global(.rollback-diff-pane .d2h-code-linenumber) {
    display: none;
  }

  :global(.rollback-diff-pane .d2h-code-line-prefix) {
    display: none;
  }

  :global(.rollback-diff-pane .d2h-code-side-line),
  :global(.rollback-diff-pane .d2h-code-line) {
    display: block;
    width: 100%;
    height: auto;
    min-height: 0;
    padding: 0;
    border: 0;
    background: var(--color-base-100);
    color: var(--color-base-content);
  }

  :global(.rollback-diff-pane .d2h-info) {
    display: none;
    width: 0;
    height: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
  }

  :global(.rollback-diff-pane .d2h-code-line-ctn) {
    display: block;
    width: 100%;
    padding: 0 0.25rem;
    color: inherit;
    font-size: 0.6875rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  :global(.rollback-diff-pane .d2h-code-side-line:hover),
  :global(.rollback-diff-pane .d2h-code-line:hover) {
    background: color-mix(in oklab, var(--color-base-content) 7%, var(--color-base-100));
  }

  :global(.d2h-code-line ins, .d2h-code-side-line ins) {
    background: color-mix(in oklab, var(--color-success) 10%, transparent);
    color: var(--color-success);
  }

  :global(.d2h-code-line del, .d2h-code-side-line del) {
    background: color-mix(in oklab, var(--color-error) 10%, transparent);
    color: var(--color-error);
  }
</style>
