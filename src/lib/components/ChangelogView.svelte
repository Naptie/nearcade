<script lang="ts">
  import { onMount } from 'svelte';
  import { m } from '$lib/paraglide/messages';
  import type { ChangelogEntry, ChangelogEntryWithUser } from '$lib/types';
  import { formatChangelogDescription, getChangelogActionName } from '$lib/utils/changelog';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import { getLocale } from '$lib/paraglide/runtime';
  import { formatDistanceToNow } from 'date-fns';
  import { enUS, zhCN } from 'date-fns/locale';
  import { getDisplayName } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import { page } from '$app/state';
  import { base } from '$app/paths';

  interface Props {
    universityId: string;
  }

  let { universityId }: Props = $props();

  let entries = $state<ChangelogEntryWithUser[]>([]);
  let isLoading = $state(true);
  let isLoadingMore = $state(false);
  let hasMore = $state(true);
  let currentPage = $state(1);
  let error = $state<string | null>(null);
  let entryElements: Record<string, HTMLElement> = {};
  let showHighlight = $state(false);

  const ITEMS_PER_PAGE = 10;

  // Get the highlighted entry ID from URL params
  const highlightedEntryId = $derived(page.url.searchParams.get('entry'));

  const loadChangelogEntries = async (page = 1, append = false) => {
    const isInitialLoad = page === 1;

    if (isInitialLoad) {
      isLoading = true;
      error = null;
    } else {
      isLoadingMore = true;
    }

    try {
      const response = await fetch(
        fromPath(`/api/universities/${universityId}/changelog?page=${page}&limit=${ITEMS_PER_PAGE}`)
      );

      if (!response.ok) {
        throw new Error('Failed to load changelog');
      }

      const data = (await response.json()) as {
        entries: ChangelogEntryWithUser[];
        hasMore: boolean;
        total: number;
        page: number;
        limit: number;
      };

      if (append) {
        entries = [...entries, ...data.entries];
      } else {
        entries = data.entries;
      }

      hasMore = data.hasMore;
      currentPage = page;
    } catch (err) {
      console.error('Error loading changelog:', err);
      error = err instanceof Error ? err.message : 'Failed to load changelog';
    } finally {
      isLoading = false;
      isLoadingMore = false;
    }
  };

  const loadMore = async () => {
    if (!hasMore || isLoadingMore) return;
    await loadChangelogEntries(currentPage + 1, true);
  };

  const getActionIcon = (action: ChangelogEntry['action']): string => {
    switch (action) {
      case 'created':
        return 'fa-plus text-success';
      case 'modified':
        return 'fa-edit text-info';
      case 'campus_updated':
        return 'fa-pen text-warning';
      case 'deleted':
      case 'campus_deleted':
        return 'fa-trash text-error';
      case 'campus_added':
        return 'fa-map-marker-alt text-success';
      default:
        return 'fa-edit text-base-content';
    }
  };

  const getActionBadgeClass = (action: ChangelogEntry['action']): string => {
    switch (action) {
      case 'created':
      case 'campus_added':
        return 'badge-success';
      case 'modified':
        return 'badge-info';
      case 'campus_updated':
        return 'badge-warning';
      case 'deleted':
      case 'campus_deleted':
        return 'badge-error';
      default:
        return 'badge-ghost';
    }
  };

  onMount(() => {
    loadChangelogEntries().then(() => {
      // Handle highlighting of specific entry
      if (highlightedEntryId && entryElements[highlightedEntryId]) {
        setTimeout(() => {
          const element = entryElements[highlightedEntryId];
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          showHighlight = true;
          setTimeout(() => {
            showHighlight = false;
          }, 2000);
        }, 100);
      }
    });
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
        <button class="btn btn-sm btn-outline" onclick={() => loadChangelogEntries()}>
          {m.retry()}
        </button>
      </div>
    </div>
  {:else if entries.length === 0}
    <div class="p-8 text-center">
      <i class="fa-solid fa-clock-rotate-left text-base-content/30 mb-4 text-5xl"></i>
      <h4 class="mb-2 text-lg font-medium">{m.changelog_no_entries()}</h4>
      <p class="text-base-content/60">{m.change_history_description()}</p>
    </div>
  {:else}
    <div class="divide-base-200 divide-y">
      {#each entries as entry (entry.id)}
        <div
          bind:this={entryElements[entry.id]}
          class="hover:bg-base-50 p-4 transition-colors {highlightedEntryId === entry.id &&
          showHighlight
            ? 'bg-primary/15'
            : ''}"
          id="entry-{entry.id}"
        >
          <div class="flex gap-3">
            <!-- Action icon -->
            <div class="flex-shrink-0">
              <div class="bg-base-200 flex h-8 w-8 items-center justify-center rounded-full">
                <i class="fa-solid {getActionIcon(entry.action)} text-xs"></i>
              </div>
            </div>

            <!-- Content -->
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1">
                  <!-- User info -->
                  <div class="mb-1 flex items-center gap-2">
                    <UserAvatar
                      user={entry.user || {
                        image: entry.userImage,
                        name: entry.userName,
                        displayName: entry.userName
                      }}
                      size="sm"
                    />
                    <a
                      href="{base}/users/{entry.user.name ? `@${entry.user.name}` : entry.userId}"
                      class="hover:text-accent text-sm font-medium transition-colors"
                    >
                      {getDisplayName(entry.user) || entry.userName || m.unknown_user()}
                    </a>
                    <span
                      class="badge badge-soft badge-sm not-sm:hidden {getActionBadgeClass(
                        entry.action
                      )}"
                    >
                      {getChangelogActionName(entry.action, m)}
                    </span>
                  </div>

                  <!-- Change description -->
                  <div class="text-base-content/80 text-sm">
                    {formatChangelogDescription(entry, m)}
                  </div>

                  <!-- Campus context for campus changes -->
                  {#if entry.fieldInfo.campusName}
                    <div class="text-base-content/60 mt-1 flex items-center gap-1 text-xs">
                      <i class="fa-solid fa-map-marker-alt"></i>
                      <span>{entry.fieldInfo.campusName}</span>
                    </div>
                  {/if}
                </div>

                <!-- Timestamp -->
                <div class="text-base-content/60 flex-shrink-0 text-xs">
                  {formatDistanceToNow(new Date(entry.createdAt), {
                    addSuffix: true,
                    locale: getLocale() === 'en' ? enUS : zhCN
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
