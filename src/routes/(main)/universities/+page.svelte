<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import { resolve } from '$app/paths';
  import { formatRegionLabel, pageTitle } from '$lib/utils';
  import { PAGINATION } from '$lib/constants';
  import { SvelteURLSearchParams } from 'svelte/reactivity';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state(data.query);
  let isSearching = $state(false);

  const handleSearch = async (event: Event) => {
    event.preventDefault();
    isSearching = true;
    const params = new SvelteURLSearchParams();
    if (searchQuery.trim()) {
      params.set('q', searchQuery.trim());
    }
    await goto(resolve('/(main)/universities') + `?${params.toString()}`);
    isSearching = false;
  };

  const handlePageChange = (newPage: number) => {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    params.set('page', newPage.toString());
    goto(resolve('/(main)/universities') + `?${params.toString()}`);
  };
</script>

<svelte:head>
  <title>{pageTitle(m.browse_universities())}</title>
  <meta name="description" content={m.browse_search_universities()} />
  <meta property="og:title" content={pageTitle(m.browse_universities())} />
  <meta property="og:description" content={m.browse_search_universities()} />
  <meta name="twitter:title" content={pageTitle(m.browse_universities())} />
  <meta name="twitter:description" content={m.browse_search_universities()} />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-8 sm:px-6 lg:px-8">
  <!-- Header -->
  <h1 class="mb-4 text-3xl font-bold">{m.browse_universities()}</h1>

  <!-- Search Bar -->
  <div class="mb-8">
    <form onsubmit={handleSearch} class="flex gap-4">
      <div class="flex-1">
        <input
          type="text"
          bind:value={searchQuery}
          placeholder={m.search_university()}
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
    {#await data.universitiesData}
      <!-- Loading State with Skeleton -->
      <div class="flex items-center justify-between">
        <div class="skeleton h-4 w-48"></div>
        <div class="skeleton h-4 w-32"></div>
      </div>

      <!-- University Grid Skeleton -->
      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
        {#each Array(6) as _, idx (idx)}
          <div class="card bg-base-200 shadow-sm">
            <div class="card-body p-6">
              <div class="mb-4 flex items-center gap-3">
                <div class="skeleton h-12 w-12 shrink-0 rounded-full"></div>
                <div class="min-w-0 flex-1 space-y-2">
                  <div class="skeleton h-5 w-3/4"></div>
                  <div class="skeleton h-4 w-1/2"></div>
                </div>
              </div>
              <div class="space-y-2">
                <div class="skeleton h-4 w-full"></div>
                <div class="skeleton h-4 w-2/3"></div>
              </div>
              <div class="skeleton mt-3 h-16 w-full"></div>
            </div>
          </div>
        {/each}
      </div>
    {:then universitiesData}
      {#if universitiesData.universities.length > 0}
        <!-- Results Header -->
        <div class="flex items-center justify-between">
          <div class="text-base-content/60 text-sm">
            {#if data.query}
              {m.showing_results_for({ query: data.query })}
            {:else}
              {m.showing_all_universities()}
            {/if}
          </div>
          <div class="text-base-content/60 text-sm">
            {m.universities_and_colleges_available({ count: universitiesData.totalCount })}
          </div>
        </div>

        <!-- University List -->
        <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {#each universitiesData.universities as university (university.id)}
            <a
              href={resolve('/(main)/universities/[id]', { id: university.slug || university.id })}
              class="card bg-base-200 ring-primary/0 group hover:ring-primary shadow-sm ring-2 transition hover:shadow-md"
            >
              <div
                class="group-hover:from-primary from-warning/50 dark:from-warning/30 pointer-events-none absolute inset-0 rounded-2xl bg-linear-to-br to-transparent to-55% transition-colors"
                style:opacity="{(university._rankingScore || 0) * 20}%"
              ></div>
              <div class="card-body p-6">
                <!-- University Header -->
                <div class="mb-4 flex items-center gap-3">
                  {#if university.avatarUrl}
                    <div class="avatar shrink-0">
                      <div class="h-12 w-12 rounded-full bg-white">
                        <img src={university.avatarUrl} alt="{university.name} {m.logo()}" />
                      </div>
                    </div>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <h3
                      class="card-title gap-0 text-lg leading-tight font-semibold"
                      title={university.name}
                    >
                      {@html university.nameHl || university.name}
                    </h3>
                    <div class="mt-1 flex flex-wrap gap-1">
                      {#if university.is985}
                        <span class="badge badge-soft badge-primary badge-xs">{m.badge_985()}</span>
                      {/if}
                      {#if university.is211}
                        <span class="badge badge-soft badge-secondary badge-xs"
                          >{m.badge_211()}</span
                        >
                      {/if}
                      {#if university.isDoubleFirstClass}
                        <span class="badge badge-soft badge-accent badge-xs"
                          >{m.badge_double_first_class()}</span
                        >
                      {/if}
                    </div>
                  </div>
                </div>

                <!-- University Info -->
                <div class="space-y-2 text-sm">
                  <div>
                    <span class="text-base-content/60">{m.school_type()}:</span>
                    <span class="ml-1">{university.type}</span>
                  </div>

                  {#if university.majorCategory}
                    <div>
                      <span class="text-base-content/60">{m.discipline_category()}:</span>
                      <span class="ml-1">{university.majorCategory}</span>
                    </div>
                  {/if}

                  {#if university.campuses && university.campuses.length > 0}
                    {@const campusesHl = university.campusesHl || university.campuses}
                    <div>
                      <span class="text-base-content/60">{m.campus_location()}:</span>
                      <span class="ml-1">
                        {#if campusesHl.length === 1}
                          {@html formatRegionLabel({
                            province: campusesHl[0].province,
                            city: campusesHl[0].city,
                            district: campusesHl[0].district
                          })}
                        {:else if campusesHl.find((campus) => !campus.name)}
                          {@const mainCampus = campusesHl.find((campus) => !campus.name)!}
                          {@html formatRegionLabel({
                            province: mainCampus.province,
                            city: mainCampus.city,
                            district: mainCampus.district
                          })}
                        {:else}
                          {@const addressCounts = university.campuses.reduce(
                            (map, campus, i) =>
                              map.set(`${campus.province}-${campus.city}-${campus.district}`, {
                                campus: campusesHl[i],
                                count:
                                  (map.get(`${campus.province}-${campus.city}-${campus.district}`)
                                    ?.count || 0) + 1
                              }),
                            new Map<
                              string,
                              { campus: (typeof campusesHl)[number]; count: number }
                            >()
                          )}
                          {#if addressCounts.size > 0}
                            {@const mostCommonEntry = Array.from(addressCounts.values()).reduce(
                              (max, current) => (current.count > max.count ? current : max)
                            )}
                            {@const { province, city, district } = mostCommonEntry.campus}
                            {@html formatRegionLabel({ province, city, district })}
                            {#if addressCounts.size > 1}
                              <span class="text-base-content/60">(+{addressCounts.size - 1})</span>
                            {/if}
                          {/if}
                        {/if}
                      </span>
                    </div>
                  {/if}
                </div>

                <!-- Description -->
                {#if university.description}
                  <p
                    class="text-base-content/80 mt-3 line-clamp-2 text-sm"
                    title={university.description}
                  >
                    {@html university.descriptionHl || university.description}
                  </p>
                {/if}
              </div>
            </a>
          {/each}
        </div>

        <!-- Pagination -->
        {#if universitiesData.totalCount > PAGINATION.PAGE_SIZE}
          <div class="flex justify-center">
            <div class="join">
              {#if universitiesData.hasPrevPage}
                <button
                  class="join-item btn"
                  onclick={() => handlePageChange(universitiesData.currentPage - 1)}
                  aria-label={m.previous_page()}
                >
                  <i class="fa-solid fa-chevron-left"></i>
                </button>
              {/if}

              <button class="join-item btn btn-active">
                {universitiesData.currentPage} / {Math.ceil(
                  universitiesData.totalCount / PAGINATION.PAGE_SIZE
                )}
              </button>

              {#if universitiesData.hasNextPage}
                <button
                  class="join-item btn"
                  onclick={() => handlePageChange(universitiesData.currentPage + 1)}
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
          <i class="fa-solid fa-graduation-cap text-base-content/30 mb-4 text-5xl"></i>
          <h3 class="mb-2 text-xl font-medium">{m.no_universities_found()}</h3>
          <p class="text-base-content/60 mb-4">
            {#if data.query}
              {m.try_adjusting_search_criteria()}
            {:else}
              {m.no_universities_added_yet()}
            {/if}
          </p>
          {#if data.query}
            <button
              class="btn btn-primary"
              onclick={() => {
                searchQuery = '';
                handleSearch(new Event('submit'));
              }}
            >
              {m.browse_universities()}
            </button>
          {/if}
        </div>
      {/if}
    {:catch err}
      <!-- Error State -->
      <div class="py-12 text-center">
        <div class="text-error mb-4">
          <i class="fa-solid fa-exclamation-triangle text-4xl"></i>
        </div>
        <h3 class="mb-2 text-xl font-semibold">{m.failed_to_load_universities()}</h3>
        <p class="text-base-content/60 mb-4">
          {err?.message || m.error_occurred()}
        </p>
        <button class="btn btn-primary" onclick={() => window.location.reload()}>
          <i class="fa-solid fa-refresh"></i>
          {m.try_again()}
        </button>
      </div>
    {/await}
  </div>
</div>
