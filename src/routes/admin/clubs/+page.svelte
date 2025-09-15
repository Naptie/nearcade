<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { PageData } from './$types';
  import { adaptiveNewTab, formatDate, pageTitle } from '$lib/utils';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state(data.search || '');
  let searchTimeout: ReturnType<typeof setTimeout>;
  let selectedUniversity = $state('');
  let showCreateModal = $state(false);

  const handleSearchInput = () => {
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
    url.searchParams.delete('page'); // Reset to first page
    goto(url.toString());
  };
</script>

<svelte:head>
  <title>{pageTitle(m.admin_clubs(), m.admin_panel())}</title>
</svelte:head>

<div class="space-y-6">
  <!-- Page Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-base-content text-3xl font-bold">{m.admin_clubs()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_clubs_description()}</p>
    </div>
    <button onclick={() => (showCreateModal = true)} class="btn btn-primary not-sm:btn-circle">
      <i class="fa-solid fa-plus"></i>
      <span class="not-sm:hidden">{m.add_club()}</span>
    </button>
  </div>

  <!-- Search -->
  <div class="bg-base-100 border-base-300 rounded-lg border p-4 shadow-sm">
    <div class="form-control">
      <label class="label" for="search">
        <span class="label-text font-medium">{m.search()}</span>
      </label>
      <input
        id="search"
        type="text"
        class="input input-bordered w-full"
        placeholder={m.search_clubs()}
        bind:value={searchQuery}
        oninput={handleSearchInput}
      />
    </div>
  </div>

  <!-- Clubs List -->
  <div class="bg-base-100 border-base-300 rounded-lg border shadow-sm">
    {#if data.clubs && data.clubs.length > 0}
      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>{m.club()}</th>
              <th>{m.admin_university_header()}</th>
              <th class="not-sm:hidden">{m.admin_members_header()}</th>
              <th class="not-md:hidden">{m.admin_status_header()}</th>
              <th class="not-lg:hidden">{m.admin_created_header()}</th>
              <th class="text-right">{m.admin_actions_header()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.clubs as club (club.id)}
              <tr class="hover">
                <td class="max-w-[20vw]">
                  <a
                    href={resolve('/(main)/clubs/[id]', { id: club.id })}
                    target={adaptiveNewTab()}
                    class="group flex items-center gap-3"
                  >
                    {#if club.avatarUrl}
                      <img
                        src={club.avatarUrl}
                        alt={club.name}
                        class="bg-base-200 h-10 w-10 rounded-full"
                      />
                    {:else}
                      <div
                        class="bg-primary/20 flex h-10 w-10 items-center justify-center rounded-full"
                      >
                        <i class="fa-solid fa-users text-primary"></i>
                      </div>
                    {/if}
                    <div class="group-hover:text-accent w-[calc(100%-2.5rem)] transition-colors">
                      <div class="line-clamp-2 font-medium">
                        {club.name}
                      </div>
                      {#if club.description}
                        <div class="max-w-xs truncate text-sm opacity-60">
                          {club.description}
                        </div>
                      {/if}
                    </div>
                  </a>
                </td>
                <td>
                  {#if club.university}
                    <a
                      href={resolve('/(main)/universities/[id]', { id: club.university.id })}
                      class="hover:text-accent line-clamp-2 transition-colors"
                    >
                      {club.university.name}
                    </a>
                  {:else}
                    <span class="text-base-content/60">{m.admin_unknown()}</span>
                  {/if}
                </td>
                <td class="not-sm:hidden">
                  <div class="text-sm">
                    {m.member_count_people({ count: club.membersCount || 0 })}
                  </div>
                </td>
                <td class="not-md:hidden">
                  <div
                    class="badge badge-soft text-nowrap {club.acceptJoinRequests
                      ? 'badge-success'
                      : 'badge-neutral'}"
                  >
                    {club.acceptJoinRequests ? m.is_open() : m.invite_only()}
                  </div>
                </td>
                <td class="not-lg:hidden">
                  <div class="text-sm">
                    {formatDate(club.createdAt)}
                  </div>
                </td>
                <td>
                  <div class="flex justify-end gap-2">
                    <a
                      href={resolve('/(main)/clubs/[id]/edit', { id: club.id })}
                      target={adaptiveNewTab()}
                      class="btn btn-primary btn-soft btn-sm text-nowrap"
                    >
                      <i class="fa-solid fa-edit"></i>
                      <span class="not-lg:hidden">{m.edit()}</span>
                    </a>
                    <form method="POST" action="?/delete" use:enhance class="inline">
                      <input type="hidden" name="clubId" value={club.id} />
                      <button
                        type="submit"
                        class="btn btn-error btn-sm btn-soft text-nowrap"
                        onclick={() => confirm(m.admin_club_delete_confirm())}
                      >
                        <i class="fa-solid fa-trash"></i>
                        <span class="not-lg:hidden">{m.delete()}</span>
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      {#if data.hasMore}
        <div class="border-base-300 border-t p-4">
          <div class="flex justify-center gap-2">
            {#if (data.currentPage || 1) > 1}
              <a
                href="?page={(data.currentPage || 1) - 1}{data.search
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
            <a
              href="?page={(data.currentPage || 1) + 1}{data.search
                ? `&search=${encodeURIComponent(data.search)}`
                : ''}"
              class="btn btn-soft"
            >
              {m.next_page()}
            </a>
          </div>
        </div>
      {/if}
    {:else}
      <div class="py-12 text-center">
        <i class="fa-solid fa-users text-base-content/40 mb-4 text-4xl"></i>
        <h3 class="text-base-content mb-2 text-lg font-semibold">{m.admin_no_clubs_found()}</h3>
        <p class="text-base-content/60">
          {data.search
            ? 'No clubs found matching your search criteria.'
            : 'No clubs found that you can manage.'}
        </p>
        {#if !data.search}
          <button onclick={() => (showCreateModal = true)} class="btn btn-primary mt-4">
            <i class="fa-solid fa-plus"></i>
            {m.add_club()}
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- Create Club Modal -->
<div class="modal" class:modal-open={showCreateModal}>
  <div class="modal-box">
    <h3 class="mb-4 text-lg font-bold">{m.add_club()}</h3>
    <p class="text-base-content/60 mb-4 text-sm">
      {m.admin_club_creation_info()}
    </p>

    <div class="form-control w-full">
      <label class="label" for="university-select">
        <span class="label-text font-medium">{m.select_university()}</span>
      </label>
      <select
        id="university-select"
        class="select select-bordered w-full"
        bind:value={selectedUniversity}
      >
        <option value="">{m.choose_university()}</option>
        {#each data.universities || [] as university (university.id)}
          <option value={university.id}>{university.name}</option>
        {/each}
      </select>
    </div>

    <div class="modal-action">
      <button class="btn btn-ghost" onclick={() => (showCreateModal = false)}>
        {m.cancel()}
      </button>
      <a
        href={selectedUniversity
          ? resolve('/(main)/clubs/new') + `?university=${selectedUniversity}`
          : '#'}
        class="btn btn-primary"
        class:btn-disabled={!selectedUniversity}
        onclick={() => {
          if (selectedUniversity) {
            showCreateModal = false;
          }
        }}
      >
        {m.continue()}
      </a>
    </div>
  </div>
  <div
    class="modal-backdrop"
    onclick={() => (showCreateModal = false)}
    onkeydown={(e) => e.key === 'Escape' && (showCreateModal = false)}
    role="button"
    tabindex="0"
    aria-label={m.close_modal()}
  ></div>
</div>
