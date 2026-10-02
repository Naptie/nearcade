<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { m } from '$lib/paraglide/messages';
  import { formatDate, pageTitle } from '$lib/utils';
  import { isAnnouncementExpired } from '$lib/announcements/read';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  // eslint-disable-next-line svelte/prefer-writable-derived
  let searchQuery = $state('');
  let searchTimeout: ReturnType<typeof setTimeout>;

  $effect(() => {
    searchQuery = data.search || '';
  });

  const updateSearch = () => {
    const url = new URL(page.url);
    if (searchQuery.trim()) url.searchParams.set('search', searchQuery.trim());
    else url.searchParams.delete('search');
    url.searchParams.delete('page');
    goto(url.toString(), { replaceState: true, keepFocus: true, noScroll: true });
  };
</script>

<svelte:head>
  <title>{pageTitle(m.admin_announcements(), m.admin_panel())}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
    <div class="not-sm:text-center">
      <h1 class="text-base-content text-3xl font-bold">{m.admin_announcements()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_announcements_description()}</p>
    </div>
    <a href={resolve('/(main)/announcements/new')} class="btn btn-primary">
      <i class="fa-solid fa-plus"></i>
      {m.new_announcement()}
    </a>
  </div>

  <div class="bg-base-100 border-base-300 rounded-lg border p-4 shadow-sm">
    <label class="label" for="announcement-search">
      <span class="label-text font-medium">{m.search()}</span>
    </label>
    <input
      id="announcement-search"
      type="text"
      class="input input-bordered w-full"
      placeholder={m.admin_search_by_title_or_content()}
      bind:value={searchQuery}
      oninput={() => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(updateSearch, 300);
      }}
    />
  </div>

  <div class="bg-base-100 border-base-300 rounded-lg border shadow-sm">
    {#if data.announcements.length === 0}
      <div class="py-12 text-center">
        <i class="fa-solid fa-bullhorn text-base-content/20 mb-4 text-6xl"></i>
        <h2 class="mb-2 text-xl font-semibold">{m.no_announcements_yet()}</h2>
        <p class="text-base-content/60">{m.no_announcements_description()}</p>
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="table w-full">
          <thead>
            <tr>
              <th>{m.post_title()}</th>
              <th>{m.status()}</th>
              <th class="not-md:hidden">{m.created_at()}</th>
              <th class="text-right">{m.actions()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.announcements as announcement (announcement.id)}
              <tr>
                <td>
                  <a
                    class="hover:text-accent font-medium"
                    href={resolve('/(main)/announcements/[id]', { id: announcement.id })}
                  >
                    {announcement.title}
                  </a>
                </td>
                <td>
                  {#if announcement.status !== 'published'}
                    <span class="badge badge-soft">{m.announcement_draft()}</span>
                  {:else if announcement.publishedAt && new Date(announcement.publishedAt) > new Date()}
                    <span class="badge badge-soft badge-info">{m.announcement_scheduled()}</span>
                  {:else if isAnnouncementExpired(announcement)}
                    <span class="badge badge-soft badge-warning">{m.expired()}</span>
                  {:else}
                    <span class="badge badge-soft badge-success">{m.announcement_published()}</span>
                  {/if}
                </td>
                <td class="not-md:hidden">{formatDate(announcement.createdAt)}</td>
                <td class="text-right">
                  <a
                    class="btn btn-ghost btn-sm"
                    href={resolve('/(main)/announcements/[id]', { id: announcement.id })}
                    aria-label={m.view()}
                  >
                    <i class="fa-solid fa-eye"></i>
                  </a>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="border-base-300 flex justify-center gap-2 border-t p-4">
        {#if data.page > 1}
          <a
            class="btn btn-sm"
            href="?page={data.page - 1}{data.search ? `&search=${data.search}` : ''}"
          >
            {m.previous_page()}
          </a>
        {/if}
        {#if data.hasMore}
          <a
            class="btn btn-sm"
            href="?page={data.page + 1}{data.search ? `&search=${data.search}` : ''}"
          >
            {m.next_page()}
          </a>
        {/if}
      </div>
    {/if}
  </div>
</div>
