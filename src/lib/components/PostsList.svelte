<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { PostReadability, type PostWithAuthor } from '$lib/types';
  import PostCard from './PostCard.svelte';
  import PostCreateModal from './PostCreateModal.svelte';
  import { PAGINATION } from '$lib/constants';
  import { onMount } from 'svelte';
  import { fromPath } from '$lib/utils';

  interface Props {
    organizationType: 'university' | 'club';
    organizationId: string;
    organizationName: string;
    organizationSlug?: string;
    organizationReadability?: PostReadability;
    currentUserId?: string;
    canManage: boolean;
    canCreatePost: boolean;
    initialPosts?: PostWithAuthor[];
  }

  let {
    organizationType,
    organizationId,
    organizationName,
    organizationSlug,
    organizationReadability,
    currentUserId,
    canManage,
    canCreatePost,
    initialPosts = []
  }: Props = $props();

  let posts = $state<PostWithAuthor[]>(initialPosts);
  let isLoading = $state(true);
  let hasMore = $state(initialPosts.length >= PAGINATION.PAGE_SIZE);
  let currentPage = $state(1);
  let showCreateModal = $state(false);
  let error = $state('');

  const loadMorePosts = async () => {
    if (isLoading || !hasMore) return;

    isLoading = true;
    try {
      const nextPage = currentPage + 1;
      const endpoint = fromPath(
        `/api/${organizationType === 'university' ? 'universities' : 'clubs'}/${organizationId}/posts?page=${nextPage}`
      );
      const response = await fetch(endpoint);

      if (response.ok) {
        const result = (await response.json()) as { posts: PostWithAuthor[]; hasMore: boolean };
        const newPosts = result.posts || [];
        posts = [...posts, ...newPosts];
        hasMore = result.hasMore;
        currentPage = nextPage;
      } else {
        error = m.failed_to_load_more_posts();
      }
    } catch {
      error = m.network_error_loading_posts();
    } finally {
      isLoading = false;
    }
  };

  const handlePostCreated = () => {
    refreshPosts();
  };

  const refreshPosts = async () => {
    try {
      isLoading = true;
      const endpoint = fromPath(
        `/api/${organizationType === 'university' ? 'universities' : 'clubs'}/${organizationId}/posts?page=1`
      );
      const response = await fetch(endpoint);

      if (response.ok) {
        const result = (await response.json()) as { posts: PostWithAuthor[]; hasMore: boolean };
        posts = result.posts || [];
        hasMore = result.hasMore;
        currentPage = 1;
        error = '';
      }
    } catch (err) {
      console.error('Error refreshing posts:', err);
    } finally {
      isLoading = false;
    }
  };

  onMount(() => {
    refreshPosts();
  });
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <h3 class="flex items-center gap-2 text-lg font-semibold">
      <i class="fa-solid fa-comments"></i>
      {m.posts()}
    </h3>
    {#if currentUserId && canCreatePost}
      <button
        class="btn btn-primary not-xs:btn-circle btn-sm btn-soft"
        onclick={() => (showCreateModal = true)}
      >
        <i class="fa-solid fa-plus"></i>
        <span class="not-xs:hidden">{m.new_post()}</span>
      </button>
    {/if}
  </div>

  <!-- Error message -->
  {#if error}
    <div class="alert alert-error">
      <i class="fa-solid fa-exclamation-triangle"></i>
      <span>{error}</span>
    </div>
  {/if}

  <!-- Posts container -->
  <div class="flex flex-col gap-4">
    {#if posts.length > 0}
      <!-- Posts list -->
      {#each posts as post (post.id)}
        <PostCard
          {post}
          showOrganization={false}
          {organizationType}
          {organizationName}
          {organizationSlug}
        />
      {/each}

      <!-- Load more button -->
      {#if hasMore}
        <div class="py-4 text-center">
          <button class="btn btn-ghost btn-sm" onclick={loadMorePosts} disabled={isLoading}>
            {#if isLoading}
              <span class="loading loading-spinner loading-sm"></span>
              {m.loading()}
            {:else}
              {m.load_more()}
            {/if}
          </button>
        </div>
      {:else if posts.length >= PAGINATION.PAGE_SIZE}
        <div class="text-base-content/60 py-4 text-center text-sm">
          {m.all_results_loaded()}
        </div>
      {/if}
    {:else if isLoading}
      <div class="flex flex-col items-center gap-2 py-4">
        <span class="loading loading-spinner loading-xl"></span>
      </div>
    {:else}
      <!-- Empty state -->
      <div class="bg-base-100 rounded-lg p-8 text-center">
        <i class="fa-solid fa-comments text-base-content/30 mb-4 text-5xl"></i>
        <h4 class="mb-2 text-lg font-medium">{m.no_posts_yet()}</h4>
        {#if currentUserId && canCreatePost}
          <p class="text-base-content/60 mb-4">
            {m.create_first_post()}
          </p>
          <button class="btn btn-primary btn-sm btn-soft" onclick={() => (showCreateModal = true)}>
            <i class="fa-solid fa-plus"></i>
            {m.create_post()}
          </button>
        {:else}
          <p class="text-base-content/60">
            {m.no_posts_created_yet()}
          </p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- Create Post Modal -->
<PostCreateModal
  isOpen={showCreateModal}
  {organizationType}
  {organizationId}
  {organizationName}
  organizationReadability={organizationReadability || PostReadability.PUBLIC}
  {canManage}
  onClose={() => (showCreateModal = false)}
  onSuccess={handlePostCreated}
/>
