<script lang="ts">
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { pageTitle } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import PostCard from '$lib/components/PostCard.svelte';
  import { markAnnouncementsRead } from '$lib/announcements/client';
  import type { AnnouncementWithAuthor } from '$lib/types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let announcements = $state<(AnnouncementWithAuthor & { unread?: boolean })[]>([]);
  let pageNumber = $state(1);
  let hasMore = $state(false);
  let isLoading = $state(false);
  let errorMessage = $state('');
  let markingAll = $state(false);

  $effect(() => {
    announcements = data.announcements;
    pageNumber = data.page;
    hasMore = data.hasMore;
  });

  const loadMore = async () => {
    if (isLoading || !hasMore) return;
    isLoading = true;
    errorMessage = '';
    try {
      const response = await fetch(fromPath(`/api/announcements?page=${pageNumber + 1}`));
      if (!response.ok) {
        errorMessage = m.failed_to_load_announcements();
        return;
      }
      const result = (await response.json()) as {
        announcements: Array<AnnouncementWithAuthor & { unread?: boolean }>;
        hasMore: boolean;
        page: number;
      };
      announcements = [...announcements, ...result.announcements];
      hasMore = result.hasMore;
      pageNumber = result.page;
    } catch {
      errorMessage = m.failed_to_load_announcements();
    } finally {
      isLoading = false;
    }
  };

  const markAllRead = async () => {
    if (markingAll || data.unreadCount < 1) return;
    markingAll = true;
    try {
      await markAnnouncementsRead({ all: true });
    } catch {
      errorMessage = m.network_error_try_again();
    } finally {
      markingAll = false;
    }
  };
</script>

<svelte:head>
  <title>{pageTitle(m.announcements())}</title>
  <meta name="description" content={m.announcements_description()} />
</svelte:head>

<div class="mx-auto max-w-3xl px-4 pt-24 pb-10">
  <div class="mb-6 flex items-start justify-between gap-3">
    <div>
      <h1 class="flex items-center gap-2 text-3xl font-bold">
        <i class="fa-solid fa-bullhorn text-primary"></i>
        {m.announcements()}
      </h1>
      <p class="text-base-content/60 mt-1">{m.announcements_description()}</p>
    </div>
    <div class="flex items-center gap-2">
      {#if data.unreadCount > 0}
        <button class="btn btn-soft btn-sm" onclick={markAllRead} disabled={markingAll}>
          {#if markingAll}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          {m.mark_all_as_read()}
        </button>
      {/if}
      {#if data.canManage}
        <a href={resolve('/(main)/announcements/new')} class="btn btn-primary btn-soft">
          <i class="fa-solid fa-plus"></i>
          <span class="not-xs:hidden">{m.new_announcement()}</span>
        </a>
      {/if}
    </div>
  </div>

  {#if errorMessage}
    <div class="alert alert-error mb-4">
      <i class="fa-solid fa-exclamation-triangle"></i>
      <span>{errorMessage}</span>
    </div>
  {/if}

  {#if announcements.length > 0}
    <div class="flex flex-col gap-4">
      {#each announcements as announcement (announcement.id)}
        <PostCard
          post={announcement}
          href={resolve('/(main)/announcements/[id]', { id: announcement.id })}
          announcement
          unread={announcement.unread}
        />
      {/each}
    </div>
    {#if hasMore}
      <div class="py-4 text-center">
        <button class="btn btn-ghost btn-sm" onclick={loadMore} disabled={isLoading}>
          {#if isLoading}
            <span class="loading loading-spinner loading-sm"></span>
            {m.loading()}
          {:else}
            {m.load_more()}
          {/if}
        </button>
      </div>
    {:else if announcements.length >= data.pageSize}
      <div class="text-base-content/60 py-4 text-center text-sm">{m.all_results_loaded()}</div>
    {/if}
  {:else}
    <div class="bg-base-100 rounded-lg p-8 text-center">
      <i class="fa-solid fa-bullhorn text-base-content/30 mb-4 text-5xl"></i>
      <h2 class="mb-2 text-lg font-medium">{m.no_announcements_yet()}</h2>
      <p class="text-base-content/60">{m.no_announcements_description()}</p>
    </div>
  {/if}
</div>
