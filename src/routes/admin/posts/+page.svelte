<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { PostReadability } from '$lib/types';
  import type { PageData } from './$types';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import { page } from '$app/state';
  import { adaptiveNewTab, pageTitle } from '$lib/utils';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state(data.search || '');
  let searchTimeout: ReturnType<typeof setTimeout>;

  const getReadabilityLabel = (readability: PostReadability) => {
    switch (readability) {
      case PostReadability.PUBLIC:
        return m.public();
      case PostReadability.UNIV_MEMBERS:
        return m.university_members();
      case PostReadability.CLUB_MEMBERS:
        return m.club_members();
      default:
        return m.public();
    }
  };

  const getReadabilityIcon = (readability: PostReadability) => {
    switch (readability) {
      case PostReadability.PUBLIC:
        return 'fa-solid fa-globe';
      case PostReadability.UNIV_MEMBERS:
        return 'fa-solid fa-graduation-cap';
      case PostReadability.CLUB_MEMBERS:
        return 'fa-solid fa-users';
      default:
        return 'fa-solid fa-globe';
    }
  };

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
  <title>{pageTitle(m.admin_posts(), m.admin_panel())}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <!-- Page Header -->
  <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
    <div class="not-sm:text-center">
      <h1 class="text-base-content text-3xl font-bold">{m.admin_posts()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_posts_description()}</p>
    </div>

    <!-- Post Statistics -->
    <div class="stats shadow">
      <div class="stat">
        <div class="stat-title">{m.total_posts()}</div>
        <div class="stat-value text-primary">{data.totalCount || 0}</div>
      </div>
    </div>
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
        placeholder={m.admin_search_by_title_or_content()}
        bind:value={searchQuery}
        oninput={handleSearchInput}
      />
    </div>
  </div>

  <div class="bg-base-100 border-base-300 rounded-lg border shadow-sm">
    {#if data.posts.length === 0}
      <div class="py-12 text-center">
        <div class="text-base-content/20 mb-4 text-6xl">
          <i class="fa-solid fa-file-lines"></i>
        </div>
        <h3 class="mb-2 text-xl font-semibold">{m.no_posts_found()}</h3>
        <p class="text-base-content/60">{m.no_posts_found_description()}</p>
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="table w-full">
          <thead>
            <tr>
              <th>{m.post_title()}</th>
              <th class="not-xs:hidden">{m.posted_by()}</th>
              <th class="not-md:hidden">{m.organization()}</th>
              <th class="not-md:hidden">{m.post_visibility()}</th>
              <th>{m.statistics()}</th>
              <th class="not-lg:hidden">{m.created_at()}</th>
              <th class="text-right not-lg:hidden">{m.actions()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.posts as post (post.id)}
              <tr>
                <td>
                  <div class="inline-flex flex-wrap gap-1 overflow-hidden">
                    <a
                      class="hover:text-accent line-clamp-2 font-medium transition-colors"
                      href={post.universityId
                        ? resolve('/(main)/universities/[id]/posts/[postId]', {
                            id: post.universityId,
                            postId: post.id
                          })
                        : resolve('/(main)/clubs/[id]/posts/[postId]', {
                            id: post.clubId || '',
                            postId: post.id
                          })}
                    >
                      {post.title}
                    </a>
                    <div class="flex items-center gap-1">
                      {#if post.isPinned}
                        <span class="btn btn-circle btn-soft btn-info badge-sm pointer-events-none">
                          <i class="fa-solid fa-thumbtack"></i>
                        </span>
                      {/if}
                      {#if post.isLocked}
                        <span
                          class="btn btn-circle btn-soft btn-warning badge-sm pointer-events-none"
                        >
                          <i class="fa-solid fa-lock"></i>
                        </span>
                      {/if}
                    </div>
                  </div>
                </td>

                <td class="not-xs:hidden max-w-[25vw] sm:max-w-[15vw]">
                  <UserAvatar user={post.author} size="sm" showName target={adaptiveNewTab()} />
                </td>

                <td class="not-md:hidden">
                  <div class="flex items-center gap-2">
                    {#if post.university}
                      <span class="not-xl:hidden">
                        <i class="fa-solid fa-graduation-cap text-primary"></i>
                      </span>
                      <a
                        class="hover:text-accent line-clamp-3 font-medium transition-colors"
                        href={resolve('/(main)/universities/[id]', {
                          id: post.university.slug || post.university.id
                        })}
                      >
                        {post.university.name}
                      </a>
                    {:else if post.club}
                      <span class="not-xl:hidden">
                        <i class="fa-solid fa-users text-primary"></i>
                      </span>
                      <a
                        class="hover:text-accent line-clamp-3 font-medium transition-colors"
                        href={resolve('/(main)/clubs/[id]', { id: post.club.slug || post.club.id })}
                      >
                        {post.club.name}
                      </a>
                    {/if}
                  </div>
                </td>

                <td class="not-md:hidden">
                  <span class="badge badge-soft gap-1 text-nowrap">
                    <i class={getReadabilityIcon(post.readability)}></i>
                    {getReadabilityLabel(post.readability)}
                  </span>
                </td>

                <td>
                  <div class="flex flex-row text-sm sm:gap-2.5">
                    <span>
                      <i class="fa-solid fa-caret-up text-success mr-0.5"></i>
                      {post.upvotes}
                    </span>
                    <span>
                      <i class="fa-solid fa-caret-down text-error mr-0.5"></i>
                      {post.downvotes}
                    </span>
                    <span>
                      <i class="fa-solid fa-comment mr-0.5"></i>
                      {post.commentCount}
                    </span>
                  </div>
                </td>

                <td class="not-lg:hidden">
                  <div class="text-sm">
                    {new Date(post.createdAt).toLocaleDateString()}
                  </div>
                </td>

                <td class="not-lg:hidden">
                  <div class="flex justify-end gap-2">
                    <a
                      class="btn btn-ghost btn-sm"
                      href={post.universityId
                        ? resolve('/(main)/universities/[id]/posts/[postId]', {
                            id: post.universityId,
                            postId: post.id
                          })
                        : resolve('/(main)/clubs/[id]/posts/[postId]', {
                            id: post.clubId || '',
                            postId: post.id
                          })}
                      title={m.view()}
                      aria-label={m.view()}
                    >
                      <i class="fa-solid fa-eye"></i>
                    </a>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
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
          {#if data.hasMore}
            <a
              href="?page={(data.currentPage || 1) + 1}{data.search
                ? `&search=${encodeURIComponent(data.search)}`
                : ''}"
              class="btn btn-soft"
            >
              {m.next_page()}
            </a>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>
