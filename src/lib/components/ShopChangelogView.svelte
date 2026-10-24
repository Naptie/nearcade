<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { m } from '$lib/paraglide/messages';
  import type { ShopChangelogEntryWithUser } from '$lib/types';
  import {
    formatShopChangelogDescription,
    getShopChangelogActionName,
    getShopChangelogActionBadgeClass,
    getShopChangelogActionIcon
  } from '$lib/utils/shops/changelog';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import ChangelogValueDiff from '$lib/components/ChangelogValueDiff.svelte';
  import { getLocale } from '$lib/paraglide/runtime';
  import { formatDistanceToNow } from 'date-fns';
  import { getDisplayName, getFnsLocale } from '$lib/utils';
  import { orpc } from '$lib/api/client';
  import { apiErrorMessage } from '$lib/utils/api-error';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';

  interface Props {
    shopId: number;
    isSiteAdmin?: boolean;
  }

  let { shopId, isSiteAdmin = false }: Props = $props();

  let entries = $state<ShopChangelogEntryWithUser[]>([]);
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

  /** Time-point preview page for an entry (`?at=` renders the shop as it stood there). */
  const previewHref = (entryId: string) =>
    `${resolve('/(main)/shops/[id]', { id: String(shopId) })}?at=${entryId}`;

  /** The newest entry's time point is exactly the live shop (its own change
   * included), so a preview link there would be a no-op — it is omitted.
   * `entries[0]` stays the globally newest entry across pagination (older
   * pages only ever get appended). */
  const isGloballyLatest = (entry: ShopChangelogEntryWithUser) => entries[0]?.id === entry.id;

  // --- Rollback highlight overlay -------------------------------------------
  // A rollback entry's metadata.appliedEntryIds names exactly the entries it
  // reverted, wherever they sit in the (linear) ledger — the affected set is
  // an overlay on the list, not a subtree, so it is highlighted rather than
  // nested. Hovering a rollback card tentatively highlights its set in the
  // info color; clicking pins it in the primary color, and the pin persists
  // while hovering other cards (the two colors keep the overlap unambiguous).
  // Esc or clicking elsewhere unpins.
  let pinnedRollbackId = $state<string | null>(null);
  let hoveredRollbackId = $state<string | null>(null);

  const rollbackAppliedIds = (entry: ShopChangelogEntryWithUser): string[] => {
    const ids = (entry.metadata as Record<string, unknown> | undefined)?.appliedEntryIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  };

  const rollbackRetention = (entry: ShopChangelogEntryWithUser): string | null => {
    const retention = (entry.metadata as Record<string, unknown> | undefined)?.retention;
    return typeof retention === 'string' ? retention : null;
  };

  const rollbackRemovedPhotoCount = (entry: ShopChangelogEntryWithUser): number => {
    const count = (entry.metadata as Record<string, unknown> | undefined)?.removedPhotoCount;
    return typeof count === 'number' && Number.isFinite(count) && count > 0 ? count : 0;
  };

  /** Ids of the `photo_uploaded` entries this rollback erased. Separate from
   * `appliedEntryIds` because photos are not part of the shop document, so the
   * inverse replay never applies them. */
  const rollbackRemovedPhotoEntryIds = (entry: ShopChangelogEntryWithUser): string[] => {
    const ids = (entry.metadata as Record<string, unknown> | undefined)?.removedPhotoEntryIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  };

  /** Everything the rollback touched: the field changes it reverted plus the
   * photo uploads it erased. */
  const rollbackAffectedIds = (entry: ShopChangelogEntryWithUser): SvelteSet<string> => {
    const ids = new SvelteSet<string>(rollbackAppliedIds(entry));
    for (const id of rollbackRemovedPhotoEntryIds(entry)) ids.add(id);
    return ids;
  };

  let pinnedAppliedIds = $derived.by(() => {
    const pinned = pinnedRollbackId ? entries.find((entry) => entry.id === pinnedRollbackId) : null;
    return pinned ? rollbackAffectedIds(pinned) : new Set<string>();
  });

  let hoveredAppliedIds = $derived.by(() => {
    if (!hoveredRollbackId || hoveredRollbackId === pinnedRollbackId) return new Set<string>();
    const hovered = entries.find((entry) => entry.id === hoveredRollbackId);
    return hovered ? rollbackAffectedIds(hovered) : new Set<string>();
  });

  /** Row background + left rail. Pinned rollbacks and their sets use the
   * primary color; hovered (tentative) ones use info — the colors are
   * distinct so a pin stays legible while hovering elsewhere. The rollback
   * card itself gets the stronger tint; the entries it reverted a lighter
   * one, both with an inset rail so the grouping survives scrolling. */
  const rowClass = (entry: ShopChangelogEntryWithUser): string => {
    const classes = ['p-4', 'transition-colors', 'hover:bg-base-50'];
    if (highlightedEntryId === entry.id && showHighlight) classes.push('bg-primary/15');
    if (entry.action === 'rollback') classes.push('cursor-pointer');

    const pinnedHere =
      !!pinnedRollbackId && (entry.id === pinnedRollbackId || pinnedAppliedIds.has(entry.id));
    const hoveredHere =
      !!hoveredRollbackId &&
      hoveredRollbackId !== pinnedRollbackId &&
      (entry.id === hoveredRollbackId || hoveredAppliedIds.has(entry.id));

    if (pinnedHere) {
      classes.push(
        entry.id === pinnedRollbackId ? 'bg-primary/15' : 'bg-primary/10',
        'shadow-[inset_3px_0_0_0_var(--color-primary)]'
      );
    } else if (hoveredHere) {
      classes.push(
        entry.id === hoveredRollbackId ? 'bg-info/10' : 'bg-info/5',
        'shadow-[inset_3px_0_0_0_var(--color-info)]'
      );
    }
    return classes.join(' ');
  };

  /** Human summary of what a rollback did, from its own metadata; null falls
   * back to the static description.
   *
   * The two halves are reported independently. A rollback that only removed
   * photos has no applied entries at all — photos cannot be inverse-replayed —
   * so gating the whole summary on that count erased the photo result from
   * view exactly when it was the only thing that happened. */
  const rollbackSummary = (entry: ShopChangelogEntryWithUser): string | null => {
    const parts: string[] = [];
    const count = rollbackAppliedIds(entry).length;
    if (count > 0) {
      parts.push(
        rollbackRetention(entry) === 'purge'
          ? m.shop_changelog_rollback_purged_count({ count })
          : m.shop_changelog_rollback_reverted_count({ count })
      );
    }
    const photos = rollbackRemovedPhotoCount(entry);
    if (photos > 0) parts.push(m.shop_changelog_rollback_photos_removed({ count: photos }));
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  // Window-level delegation keeps the cards free of interaction handlers (and
  // the a11y warnings they trigger). A click toggles the pin on a rollback
  // card — unless it landed on one of the card's own interactive elements —
  // and clicking anywhere else, or pressing Escape, unpins. Pointerover
  // drives the tentative hover highlight.
  const rollbackIdFromEvent = (event: Event): string | null => {
    if (!(event.target instanceof Element)) return null;
    return event.target.closest('[data-rollback-id]')?.getAttribute('data-rollback-id') ?? null;
  };

  const handleWindowClick = (event: MouseEvent) => {
    const id = rollbackIdFromEvent(event);
    if (!id) {
      pinnedRollbackId = null;
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest('a, button, input, select, textarea, label')
    ) {
      return;
    }
    pinnedRollbackId = pinnedRollbackId === id ? null : id;
  };

  const handleWindowPointerOver = (event: PointerEvent) => {
    hoveredRollbackId = rollbackIdFromEvent(event);
  };

  const loadEntries = async (page = 1, append = false) => {
    if (page === 1) {
      isLoading = true;
      error = null;
    } else {
      isLoadingMore = true;
    }

    try {
      const data = await orpc.shops.changelog({ id: shopId, page, limit: ITEMS_PER_PAGE });

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

    try {
      await orpc.shops.deleteChangelogEntry({ id: shopId, entryId: entry.id });
    } catch (err) {
      // The failure is a delete, not a fetch — reporting
      // `failed_to_fetch_changelog_entries` sent the reader looking for a
      // loading problem that did not happen.
      error = apiErrorMessage(err, m.failed_to_delete_changelog_entry());
      return;
    }

    entries = entries.filter((item) => item.id !== entry.id);
  };

  onMount(() => {
    loadEntries().then(() => {
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

<svelte:window
  onclick={handleWindowClick}
  onpointerover={handleWindowPointerOver}
  onkeydown={(event) => {
    if (event.key === 'Escape') pinnedRollbackId = null;
  }}
/>

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
        <button class="btn btn-sm btn-soft" onclick={() => loadEntries()}>
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
        <div
          bind:this={entryElements[entry.id]}
          class={rowClass(entry)}
          id="shop-entry-{entry.id}"
          data-rollback-id={entry.action === 'rollback' ? entry.id : undefined}
        >
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

                  <!-- Change description; rollbacks summarize what they reverted -->
                  <div class="text-base-content/80 text-sm">
                    {#if entry.action === 'rollback'}
                      {rollbackSummary(entry) ?? formatShopChangelogDescription(entry, m)}
                    {:else}
                      {formatShopChangelogDescription(entry, m)}
                    {/if}
                  </div>

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

              {#if !isGloballyLatest(entry) || isSiteAdmin}
                <!-- Time-point preview (left) + admin actions (right); a direct
                child of the content column so justify-between reaches the
                entry's right edge (the header's text column stops short of the
                timestamp). -->
                <div
                  class="mt-2 flex items-center justify-between gap-2"
                  class:flex-row-reverse={isSiteAdmin}
                >
                  {#if isSiteAdmin}
                    <button
                      class="btn btn-error btn-soft btn-xs"
                      onclick={() => deleteEntry(entry)}
                    >
                      <i class="fa-solid fa-trash"></i>
                      {m.shop_changelog_rollback_delete_action()}
                    </button>
                  {/if}
                  {#if !isGloballyLatest(entry)}
                    <a class="btn btn-soft btn-xs" href={previewHref(entry.id)}>
                      <i class="fa-solid fa-eye"></i>
                      {m.shop_changelog_view_at_point()}
                    </a>
                  {/if}
                </div>
              {/if}

              <!-- Value details for field changes -->
              {#if entry.oldValue || entry.newValue}
                <ChangelogValueDiff
                  class="mt-2"
                  oldValue={entry.oldValue}
                  newValue={entry.newValue}
                />
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
