<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import type { PostWithAuthor } from '$lib/types';
  import UserAvatar from './UserAvatar.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { base } from '$app/paths';
  
  interface Props {
    post: PostWithAuthor;
    showOrganization?: boolean;
    organizationType?: 'university' | 'club';
    organizationName?: string;
    organizationSlug?: string;
  }

  let { 
    post, 
    showOrganization = false,
    organizationType = 'university',
    organizationName = '',
    organizationSlug = ''
  }: Props = $props();

  const netVotes = $derived(post.upvotes - post.downvotes);
  
  // Truncate content for preview (limit to ~200 characters)
  const truncatedContent = $derived(() => {
    const maxLength = 200;
    if (post.content.length <= maxLength) return post.content;
    return post.content.substring(0, maxLength) + '...';
  });

  const postDetailUrl = $derived(() => {
    const orgPath = post.universityId 
      ? `/universities/${organizationSlug || post.universityId}`
      : `/clubs/${organizationSlug || post.clubId}`;
    return `${base}${orgPath}/posts/${post.id}`;
  });
</script>

<div class="bg-base-100 rounded-lg p-4 hover:shadow-md transition-shadow border border-base-300">
  <!-- Post Header -->
  <div class="flex items-start justify-between gap-3 mb-3">
    <div class="flex items-center gap-3">
      <UserAvatar user={post.author} size="sm" showName={false} />
      <div class="flex flex-col">
        <div class="flex items-center gap-2 text-sm">
          <span class="font-medium">
            {post.author.displayName || post.author.name || m.anonymous_user()}
          </span>
          {#if showOrganization && organizationName}
            <span class="text-base-content/60">in</span>
            <a 
              href="{base}/{organizationType === 'university' ? 'universities' : 'clubs'}/{organizationSlug}"
              class="link link-primary text-sm"
            >
              {organizationName}
            </a>
          {/if}
        </div>
        <div class="text-xs text-base-content/60">
          {formatDistanceToNow(post.createdAt, { addSuffix: true })}
        </div>
      </div>
    </div>

    <!-- Post badges -->
    <div class="flex gap-1">
      {#if post.isPinned}
        <div class="badge badge-success badge-sm">
          <i class="fa-solid fa-thumbtack mr-1"></i>
          {m.pinned_post()}
        </div>
      {/if}
      {#if post.isLocked}
        <div class="badge badge-warning badge-sm">
          <i class="fa-solid fa-lock mr-1"></i>
          {m.locked_post()}
        </div>
      {/if}
    </div>
  </div>

  <!-- Post Content -->
  <a href={postDetailUrl} class="block group">
    <h3 class="text-lg font-semibold mb-2 group-hover:text-primary transition-colors line-clamp-2">
      {post.title}
    </h3>
    <div class="text-base-content/80 text-sm line-clamp-3 prose prose-sm max-w-none mb-3">
      {@html truncatedContent}
    </div>
  </a>

  <!-- Post Footer -->
  <div class="flex items-center justify-between text-sm">
    <!-- Vote count and comments -->
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-1">
        <i class="fa-solid fa-chevron-up text-success"></i>
        <span class="font-medium {netVotes > 0 ? 'text-success' : netVotes < 0 ? 'text-error' : 'text-base-content/60'}">
          {netVotes > 0 ? '+' : ''}{netVotes}
        </span>
        <i class="fa-solid fa-chevron-down text-error"></i>
      </div>
      
      <div class="flex items-center gap-1 text-base-content/60">
        <i class="fa-solid fa-comments"></i>
        <span>{post.commentCount}</span>
        <span>{m.comments().toLowerCase()}</span>
      </div>
    </div>

    <!-- Read more link -->
    <a href={postDetailUrl} class="link link-primary text-sm">
      {m.read_more()} →
    </a>
  </div>
</div>