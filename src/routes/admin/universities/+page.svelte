<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state(data.search || '');
  let searchTimeout: ReturnType<typeof setTimeout>;

  function handleSearchInput() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      updateSearch();
    }, 300);
  }

  function updateSearch() {
    const url = new URL(page.url);
    if (searchQuery.trim()) {
      url.searchParams.set('search', searchQuery.trim());
    } else {
      url.searchParams.delete('search');
    }
    url.searchParams.delete('page'); // Reset to first page
    goto(url.toString());
  }
</script>

<svelte:head>
  <title>{m.admin_universities()} - {m.admin_panel()} - {m.app_name()}</title>
</svelte:head>

<div class="space-y-6">
  <!-- Page Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-base-content text-3xl font-bold">{m.admin_universities()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_manage_universities()}</p>
    </div>
    <!-- <a href="{base}/universities/new" class="btn btn-primary">
      <i class="fa-solid fa-plus"></i>
      Add University
    </a> -->
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
        placeholder={m.search_universities_placeholder()}
        bind:value={searchQuery}
        oninput={handleSearchInput}
      />
    </div>
  </div>

  <!-- Universities List -->
  <div class="bg-base-100 border-base-300 rounded-lg border shadow-sm">
    {#if data.universities && data.universities.length > 0}
      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>{m.admin_university_header()}</th>
              <th>{m.admin_campuses_header()}</th>
              <th>{m.admin_clubs_header()}</th>
              <th>{m.admin_members_header()}</th>
              <th class="text-right">{m.admin_actions_header()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.universities as university (university.id)}
              <tr class="hover">
                <td class="max-w-[20vw]">
                  <a
                    href="{base}/universities/{university.slug || university.id}"
                    target="_blank"
                    class="group flex items-center gap-3"
                  >
                    {#if university.avatarUrl}
                      <img
                        src={university.avatarUrl}
                        alt="{university.name} {m.logo()}"
                        class="h-10 w-10 rounded-full bg-white"
                      />
                    {:else}
                      <div
                        class="bg-primary/20 flex h-10 w-10 items-center justify-center rounded-full"
                      >
                        <i class="fa-solid fa-graduation-cap text-primary"></i>
                      </div>
                    {/if}
                    <div class="group-hover:text-accent w-[calc(100%-2.5rem)] transition-colors">
                      <div class="line-clamp-2 font-medium">
                        {university.name}
                      </div>
                      {#if university.description}
                        <div class="max-w-xs truncate text-sm opacity-60">
                          {university.description}
                        </div>
                      {/if}
                    </div>
                  </a>
                </td>
                <td>
                  <div class="text-sm">
                    {m.campus_count({ count: university.campuses.length || 0 })}
                  </div>
                </td>
                <td>
                  <div class="text-sm">
                    {m.club_count({ count: university.clubsCount || 0 })}
                  </div>
                </td>
                <td>
                  <div class="text-sm">
                    {m.member_count_people({ count: university.membersCount || 0 })}
                  </div>
                </td>
                <td>
                  <div class="flex justify-end gap-2">
                    <a
                      href="{base}/universities/{university.slug || university.id}/edit"
                      target="_blank"
                      class="btn btn-primary btn-soft btn-sm text-nowrap"
                    >
                      <i class="fa-solid fa-edit"></i>
                      <span class="not-md:hidden">{m.edit()}</span>
                    </a>
                    {#if data.session?.user?.userType === 'site_admin'}
                      <form method="POST" action="?/delete" use:enhance class="inline">
                        <input type="hidden" name="universityId" value={university.id} />
                        <button
                          type="submit"
                          class="btn btn-error btn-sm btn-soft text-nowrap"
                          onclick={() => confirm(m.admin_university_delete_confirm())}
                        >
                          <i class="fa-solid fa-trash"></i>
                          <span class="not-md:hidden">{m.delete()}</span>
                        </button>
                      </form>
                    {/if}
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
        <i class="fa-solid fa-graduation-cap text-base-content/40 mb-4 text-4xl"></i>
        <h3 class="text-base-content mb-2 text-lg font-semibold">
          {m.admin_no_universities_found()}
        </h3>
        <p class="text-base-content/60">
          {data.search
            ? 'No universities found matching your search criteria.'
            : 'No universities found that you can manage.'}
        </p>
        {#if !data.search}
          <a href="{base}/universities/new" class="btn btn-primary mt-4">
            <i class="fa-solid fa-plus"></i>
            Add University
          </a>
        {/if}
      </div>
    {/if}
  </div>
</div>
