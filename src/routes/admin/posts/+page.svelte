<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { PostReadability } from '$lib/types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const getReadabilityLabel = (readability: PostReadability) => {
    switch (readability) {
      case PostReadability.PUBLIC:
        return m.post_readability_public();
      case PostReadability.UNIV_MEMBERS:
        return m.post_readability_university_members();
      case PostReadability.CLUB_MEMBERS:
        return m.post_readability_club_members();
      default:
        return m.post_readability_public();
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

  const navigateToPost = (post: any) => {
    const orgPath = post.universityId 
      ? `/universities/${post.universityId}`
      : `/clubs/${post.clubId}`;
    goto(`${base}${orgPath}/posts/${post.id}`);
  };

  const loadMore = () => {
    if (data.hasMore) {
      const nextPage = (data.page || 1) + 1;
      goto(`${base}/admin/posts?page=${nextPage}`);
    }
  };
</script>

<div class="container mx-auto px-4">
  <div class="mb-6">
    <h1 class="mb-2 text-3xl font-bold">{m.admin_posts_management()}</h1>
    <p class="text-base-content/60">{m.admin_posts_description()}</p>
    
    {#if data.totalCount > 0}
      <div class="mt-2 text-sm text-base-content/80">
        {m.total_count()}: {data.totalCount}
      </div>
    {/if}
  </div>

  {#if data.posts.length === 0}
    <div class="text-center py-12">
      <div class="text-6xl text-base-content/20 mb-4">
        <i class="fa-solid fa-file-lines"></i>
      </div>
      <h3 class="text-xl font-semibold mb-2">{m.no_posts_found()}</h3>
      <p class="text-base-content/60">{m.no_posts_found_description()}</p>
    </div>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th>{m.post_title()}</th>
            <th>{m.author()}</th>
            <th>{m.organization()}</th>
            <th>{m.post_visibility()}</th>
            <th>{m.stats()}</th>
            <th>{m.created_at()}</th>
            <th>{m.actions()}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.posts as post}
            <tr>
              <td>
                <div class="flex items-start gap-3">
                  <div class="flex flex-col gap-1">
                    <button
                      class="btn btn-link btn-sm h-auto min-h-0 p-0 text-left font-medium normal-case"
                      onclick={() => navigateToPost(post)}
                    >
                      {post.title}
                    </button>
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
              
              <td>
                <div class="flex items-center gap-3">
                  <div class="avatar">
                    <div class="mask mask-circle h-8 w-8">
                      <img
                        src={post.author?.image || '/default-avatar.png'}
                        alt={post.author?.name || 'User'}
                        class="h-full w-full object-cover"
                      />
                    </div>
                  </div>
                  <div>
                    <div class="font-medium">
                      {post.author?.displayName || post.author?.name || 'Unknown'}
                    </div>
                    <div class="text-sm text-base-content/60">
                      @{post.author?.id || 'unknown'}
                    </div>
                  </div>
                </div>
              </td>
              
              <td>
                <div class="flex flex-col">
                  {#if post.university}
                    <span class="font-medium">{post.university.name}</span>
                    <span class="text-sm text-base-content/60">
                      <i class="fa-solid fa-university mr-1"></i>
                      {m.university()}
                    </span>
                  {:else if post.club}
                    <span class="font-medium">{post.club.name}</span>
                    <span class="text-sm text-base-content/60">
                      <i class="fa-solid fa-users mr-1"></i>
                      {m.club()}
                    </span>
                  {/if}
                </div>
              </td>
              
              <td>
                <span class="badge badge-outline gap-1">
                  <i class="{getReadabilityIcon(post.readability)}"></i>
                  {getReadabilityLabel(post.readability)}
                </span>
              </td>
              
              <td>
                <div class="flex flex-col text-sm">
                  <span>
                    <i class="fa-solid fa-arrow-up text-success mr-1"></i>
                    {post.upvotes}
                    <i class="fa-solid fa-arrow-down text-error ml-2 mr-1"></i>
                    {post.downvotes}
                  </span>
                  <span>
                    <i class="fa-solid fa-comment mr-1"></i>
                    {post.commentCount}
                  </span>
                </div>
              </td>
              
              <td>
                <div class="text-sm">
                  {new Date(post.createdAt).toLocaleDateString()}
                </div>
              </td>
              
              <td>
                <div class="flex gap-1">
                  <button
                    class="btn btn-ghost btn-sm"
                    onclick={() => navigateToPost(post)}
                    title={m.view_post()}
                  >
                    <i class="fa-solid fa-eye"></i>
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if data.hasMore}
      <div class="mt-6 text-center">
        <button class="btn btn-outline" onclick={loadMore}>
          <i class="fa-solid fa-chevron-down mr-2"></i>
          {m.load_more()}
        </button>
      </div>
    {/if}
  {/if}
</div>