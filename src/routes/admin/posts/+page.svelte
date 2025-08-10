<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { PostReadability } from '$lib/types';
  import type { PageData } from './$types';
  import UserAvatar from '$lib/components/UserAvatar.svelte';

  let { data }: { data: PageData } = $props();

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
        return 'fa-solid fa-university';
      case PostReadability.CLUB_MEMBERS:
        return 'fa-solid fa-users';
      default:
        return 'fa-solid fa-globe';
    }
  };

  const loadMore = () => {
    if (data.hasMore) {
      const nextPage = (data.page || 1) + 1;
      goto(`${base}/admin/posts?page=${nextPage}`);
    }
  };
</script>

<div class="min-w-3xs space-y-6">
  <div class="not-sm:text-center">
    <h1 class="text-base-content text-3xl font-bold">{m.admin_posts()}</h1>
    <p class="text-base-content/60 mt-1">{m.admin_posts_description()}</p>
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
              <th>{m.posted_by()}</th>
              <th class="not-md:hidden">{m.organization()}</th>
              <th class="not-md:hidden">{m.post_visibility()}</th>
              <th class="not-xs:hidden">{m.statistics()}</th>
              <th class="not-lg:hidden">{m.created_at()}</th>
              <th class="text-right">{m.actions()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.posts as post (post.id)}
              <tr>
                <td>
                  <div class="flex items-start gap-3">
                    <div class="flex flex-col gap-1">
                      <a
                        class="hover:text-accent line-clamp-3 font-medium transition-colors"
                        href="{base}{post.universityId
                          ? `/universities/${post.universityId}`
                          : `/clubs/${post.clubId}`}/posts/{post.id}"
                      >
                        {post.title}
                      </a>
                      {#if post.isPinned}
                        <span class="badge badge-warning badge-sm">
                          <i class="fa-solid fa-thumbtack mr-1"></i>
                          {m.pinned()}
                        </span>
                      {/if}
                      {#if post.isLocked}
                        <span class="badge badge-error badge-sm">
                          <i class="fa-solid fa-lock mr-1"></i>
                          {m.locked()}
                        </span>
                      {/if}
                    </div>
                  </div>
                </td>

                <td class="max-w-[28vw] sm:max-w-[15vw]">
                  <UserAvatar user={post.author} size="sm" showName target="_blank" />
                </td>

                <td class="not-md:hidden">
                  <div class="flex items-center gap-2">
                    {#if post.university}
                      <span class="not-xl:hidden">
                        <i class="fa-solid fa-graduation-cap text-primary"></i>
                      </span>
                      <a
                        class="hover:text-accent line-clamp-3 font-medium transition-colors"
                        href="{base}/universities/{post.university.slug || post.university.id}"
                      >
                        {post.university.name}
                      </a>
                    {:else if post.club}
                      <span class="not-xl:hidden">
                        <i class="fa-solid fa-users text-primary"></i>
                      </span>
                      <a
                        class="hover:text-accent line-clamp-3 font-medium transition-colors"
                        href="{base}/clubs/{post.club.slug || post.club.id}"
                      >
                        {post.club.name}
                      </a>
                    {/if}
                  </div>
                </td>

                <td class="not-md:hidden">
                  <span class="badge badge-soft gap-1">
                    <i class={getReadabilityIcon(post.readability)}></i>
                    {getReadabilityLabel(post.readability)}
                  </span>
                </td>

                <td class="not-xs:hidden">
                  <div class="flex flex-row gap-2.5 text-sm">
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

                <td>
                  <div class="flex justify-end gap-2">
                    <a
                      class="btn btn-ghost btn-sm"
                      href="{base}{post.universityId
                        ? `/universities/${post.universityId}`
                        : `/clubs/${post.clubId}`}/posts/{post.id}"
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

      {#if data.hasMore}
        <div class="mt-6 text-center">
          <button class="btn btn-soft" onclick={loadMore}>
            <i class="fa-solid fa-chevron-down mr-2"></i>
            {m.load_more()}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>
