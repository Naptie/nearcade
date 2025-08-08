<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import type { PostWithAuthor } from '$lib/types';
  import UserAvatar from './UserAvatar.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { base } from '$app/paths';
  import { stripMarkdown } from '$lib/markdown';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

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

  let truncatedContent = $state('');

  let netVotes = $derived(post.upvotes - post.downvotes);
  let postDetailUrl = $derived.by(() => {
    const orgPath = post.universityId
      ? `/universities/${organizationSlug || post.universityId}`
      : `/clubs/${organizationSlug || post.clubId}`;
    return `${base}${orgPath}/posts/${post.id}`;
  });

  onMount(() => {
    const maxLength = 500;
    stripMarkdown(post.content).then((text) => {
      if (text.length <= maxLength) return text;
      truncatedContent = text.substring(0, maxLength) + '...';
    });
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="bg-base-100 border-base-300/0 hover:border-primary cursor-pointer rounded-lg border-2 p-4 transition hover:shadow-lg"
  onclick={() => goto(postDetailUrl)}
>
  <!-- Post Header -->
  <div class="mb-3 flex items-start justify-between gap-3">
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
              href="{base}/{organizationType === 'university'
                ? 'universities'
                : 'clubs'}/{organizationSlug}"
              class="link link-primary text-sm"
            >
              {organizationName}
            </a>
          {/if}
        </div>
        <div class="text-base-content/60 text-xs">
          {formatDistanceToNow(post.createdAt, { addSuffix: true })}
        </div>
      </div>
    </div>

    <!-- Post badges -->
    <div class="flex gap-1">
      {#if post.isPinned}
        <div class="badge badge-soft badge-info badge-sm text-nowrap">
          <i class="fa-solid fa-thumbtack"></i>
          <span class="not-sm:hidden">{m.pinned()}</span>
        </div>
      {/if}
      {#if post.isLocked}
        <div class="badge badge-soft badge-warning badge-sm text-nowrap">
          <i class="fa-solid fa-lock"></i>
          <span class="not-sm:hidden">{m.locked()}</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- Post Content -->
  <div>
    <h3 class="mb-2 line-clamp-2 text-lg font-semibold">
      {post.title}
    </h3>
    <div class="mb-3 line-clamp-3 max-w-none text-sm opacity-70">
      {truncatedContent}
    </div>
  </div>

  <!-- Post Footer -->
  <div class="flex items-center justify-between text-sm">
    <!-- Vote count and comments -->
    <div class="flex items-center gap-4">
      <div
        class="flex items-center gap-1 {netVotes > 0
          ? 'text-success'
          : netVotes < 0
            ? 'text-error'
            : 'text-base-content/60'}"
      >
        <div class="relative flex flex-col gap-1">
          <i class="fa-solid fa-caret-up opacity-0"></i>
          <i class="fa-solid fa-caret-up absolute bottom-0.75"></i>
          <i class="fa-solid fa-caret-down absolute top-0.75"></i>
        </div>
        <span class="font-medium">
          {netVotes > 0 ? '+' : ''}{netVotes}
        </span>
      </div>

      <div class="text-base-content/60 flex items-center gap-1">
        <i class="fa-solid fa-comments"></i>
        <span>{post.commentCount}</span>
      </div>
    </div>
  </div>
</div>
