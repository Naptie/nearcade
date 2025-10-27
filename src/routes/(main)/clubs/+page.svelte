<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import { resolve } from '$app/paths';
  import { PAGINATION } from '$lib/constants';
  import { pageTitle } from '$lib/utils';
  import { SvelteURLSearchParams } from 'svelte/reactivity';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state(data.query);
  let isSearching = $state(false);
  let selectedUniversityId = $state(data.selectedUniversityId);

  const handleSearch = async (event: Event) => {
    event.preventDefault();
    isSearching = true;
    const params = new SvelteURLSearchParams();
    if (searchQuery.trim()) {
      params.set('q', searchQuery.trim());
    }
    if (selectedUniversityId) {
      params.set('university', selectedUniversityId);
    }
    await goto(resolve('/(main)/clubs') + `?${params.toString()}`);
    isSearching = false;
  };

  const handlePageChange = (newPage: number) => {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    params.set('page', newPage.toString());
    goto(resolve('/(main)/clubs') + `?${params.toString()}`);
  };

  const handleUniversityFilter = () => {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    if (selectedUniversityId) {
      params.set('university', selectedUniversityId);
    } else {
      params.delete('university');
    }
    params.delete('page'); // Reset to first page
    goto(resolve('/(main)/clubs') + `?${params.toString()}`);
  };
</script>

<svelte:head>
  <title>{pageTitle(m.browse_clubs())}</title>
  <meta name="description" content={m.browse_search_clubs()} />
  <meta property="og:title" content={pageTitle(m.browse_clubs())} />
  <meta property="og:description" content={m.browse_search_clubs()} />
  <meta name="twitter:title" content={pageTitle(m.browse_clubs())} />
  <meta name="twitter:description" content={m.browse_search_clubs()} />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-8 sm:px-6 lg:px-8">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="text-3xl font-bold">{m.browse_clubs()}</h1>
  </div>

  <!-- Search and Filters -->
  <div class="mb-8 space-y-4">
    <form onsubmit={handleSearch} class="flex gap-4">
      <select
        bind:value={selectedUniversityId}
        onchange={handleUniversityFilter}
        class="select select-bordered max-w-[30vw] not-sm:max-w-[20vw]"
      >
        <option value="">{m.all_universities()}</option>
        {#each data.universities as university (university.id)}
          <option value={university.id}>{university.name}</option>
        {/each}
      </select>
      <div class="flex-1">
        <input
          type="text"
          bind:value={searchQuery}
          placeholder={m.search_clubs()}
          class="input input-bordered w-full"
        />
      </div>
      <button
        type="submit"
        class="btn btn-primary"
        class:btn-soft={!searchQuery}
        class:btn-disabled={isSearching}
      >
        {#if isSearching}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          <i class="fa-solid fa-search"></i>
        {/if}
        <span class="not-sm:hidden">{m.search()}</span>
      </button>
    </form>
  </div>

  <!-- Results -->
  <div class="space-y-6">
    {#if data.clubs.length > 0}
      <!-- Results Header -->
      <div class="flex items-center justify-between">
        <div class="text-base-content/60 text-sm">
          {#if data.query || data.selectedUniversityId}
            {m.showing_filtered_results()}
          {:else}
            {m.showing_all_clubs()}
          {/if}
        </div>
        <div class="text-base-content/60 text-sm">
          {m.clubs_available({ count: data.totalCount })}
        </div>
      </div>

      <!-- Club List -->
      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {#each data.clubs as club (club.id)}
          <a
            href={resolve('/(main)/clubs/[id]', { id: club.slug || club.id })}
            class="card bg-base-200 ring-primary/0 group hover:ring-primary shadow-sm ring-2 transition hover:shadow-md"
          >
            <div
              class="group-hover:from-primary from-warning/50 dark:from-warning/30 pointer-events-none absolute inset-0 rounded-2xl bg-linear-to-br to-transparent to-55% transition-colors"
              style:opacity="{(club._rankingScore || 0) * 20}%"
            ></div>
            <div class="card-body p-6">
              <!-- Club Header -->
              <div class="flex items-center justify-between">
                <div class="flex min-w-0 flex-1 items-center gap-3">
                  {#if club.avatarUrl || club.universityAvatarUrl}
                    <div class="avatar shrink-0">
                      <div class="h-12 w-12 rounded-full" class:bg-white={!club.avatarUrl}>
                        <img
                          src={club.avatarUrl || club.universityAvatarUrl}
                          alt="{club.avatarUrl ? club.name : club.universityName} {m.logo()}"
                        />
                      </div>
                    </div>
                  {/if}
                  <div>
                    <h3
                      class="card-title gap-0 text-lg leading-tight font-semibold"
                      title={club.name}
                    >
                      {@html club.nameHl || club.name}
                    </h3>
                    <div class="text-base-content/60 text-sm">
                      {club.universityName || m.unknown_university()}
                    </div>
                  </div>
                </div>
              </div>

              <!-- Description -->
              {#if club.description}
                <p class="text-base-content/80 line-clamp-3 text-sm" title={club.description}>
                  {@html club.descriptionHl || club.description}
                </p>
              {/if}
            </div>
          </a>
        {/each}
      </div>

      <!-- Pagination -->
      {#if data.totalCount > PAGINATION.PAGE_SIZE}
        <div class="flex justify-center">
          <div class="join">
            {#if data.hasPrevPage}
              <button
                class="join-item btn"
                onclick={() => handlePageChange(data.currentPage - 1)}
                aria-label={m.previous_page()}
              >
                <i class="fa-solid fa-chevron-left"></i>
              </button>
            {/if}

            <button class="join-item btn btn-active">
              {data.currentPage} / {Math.ceil(data.totalCount / PAGINATION.PAGE_SIZE)}
            </button>

            {#if data.hasNextPage}
              <button
                class="join-item btn"
                onclick={() => handlePageChange(data.currentPage + 1)}
                aria-label={m.next_page()}
              >
                <i class="fa-solid fa-chevron-right"></i>
              </button>
            {/if}
          </div>
        </div>
      {/if}
    {:else}
      <!-- No Results -->
      <div class="py-12 text-center">
        <i class="fa-solid fa-users text-base-content/30 mb-4 text-5xl"></i>
        <h3 class="mb-2 text-xl font-medium">{m.no_clubs_found()}</h3>
        <p class="text-base-content/60 mb-4">
          {#if data.query || data.selectedUniversityId}
            {m.try_adjusting_search_criteria()}
          {:else}
            {m.no_clubs_created_yet()}
          {/if}
        </p>
        {#if data.query || data.selectedUniversityId}
          <button
            class="btn btn-primary"
            onclick={() => {
              searchQuery = '';
              selectedUniversityId = '';
              handleSearch(new Event('submit'));
            }}
          >
            {m.browse_clubs()}
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
