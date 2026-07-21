<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import type { ShopChangelogEntryWithUser } from '$lib/types';
  import {
    formatShopChangelogDescription,
    getShopChangelogActionName,
    getShopChangelogActionBadgeClass,
    getShopChangelogActionIcon
  } from '$lib/utils/shops/changelog';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import { getLocale } from '$lib/paraglide/runtime';
  import { formatDistanceToNow } from 'date-fns';
  import { getDisplayName, getFnsLocale } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import { slide } from 'svelte/transition';

  let entries = $state<ShopChangelogEntryWithUser[]>([]);
  let isLoading = $state(true);
  let error = $state<string | null>(null);

  const LIMIT = 10;

  const loadEntries = async () => {
    isLoading = true;
    error = null;
    try {
      const response = await fetch(fromPath(`/api/home/changelog?page=1&limit=${LIMIT}`));
      if (!response.ok) throw new Error('Failed to load changelog');
      const data = (await response.json()) as {
        entries: ShopChangelogEntryWithUser[];
      };
      entries = data.entries;
    } catch (err) {
      console.error('Error loading recent shop changelog:', err);
      error = err instanceof Error ? err.message : 'Failed to load changelog';
    } finally {
      isLoading = false;
    }
  };

  onMount(() => {
    loadEntries();
  });
</script>

{#if !isLoading}
  <div
    class="bg-base-200/60 dark:bg-base-200/90 border-base-300 rounded-xl border shadow-none backdrop-blur-2xl transition hover:shadow-lg dark:border-neutral-700 dark:shadow-neutral-700/70"
  >
    <div class="p-4 pb-2 sm:p-5 sm:pb-2">
      <h3 class="text-lg font-bold">{m.home_recent_shop_changelog()}</h3>
      <p class="text-base-content/60 text-xs">{m.home_recent_shop_changelog_description()}</p>
    </div>

    {#if error}
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
      </div>
    {:else}
      <div class="divide-base-200 divide-y" transition:slide>
        {#each entries as entry (entry.id)}
          <div class="hover:bg-base-50 p-4 transition-colors">
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
                  <div class="min-w-0 flex-1">
                    <!-- User info + action badge -->
                    <div class="mb-1 flex flex-wrap items-center gap-2">
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

                    <!-- Shop link + change description -->
                    <div class="text-base-content/80 text-sm">
                      <a
                        href={resolve('/(main)/shops/[id]', { id: entry.shopId.toString() })}
                        class="hover:text-accent font-semibold transition-colors"
                      >
                        {entry.shopName}
                      </a>
                      <span class="text-base-content/50"> · </span>
                      {formatShopChangelogDescription(entry, m)}
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
    {/if}
  </div>
{/if}
