<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import type { PostWithAuthor, CommentWithAuthor } from '$lib/types';
  import UserAvatar from './UserAvatar.svelte';
  import Comment from './Comment.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { base } from '$app/paths';
  import { renderMarkdown } from '$lib/markdown';
  import { onMount } from 'svelte';

  interface Props {
    post: PostWithAuthor;
    comments: CommentWithAuthor[];
    userVote: 'upvote' | 'downvote' | null;
    currentUserId?: string;
    organizationType: 'university' | 'club';
    organizationName: string;
    organizationSlug?: string;
    organizationId: string;
  }

  let {
    post,
    comments,
    userVote,
    currentUserId,
    organizationType,
    organizationName,
    organizationSlug,
    organizationId
  }: Props = $props();

  let content = $state('');
  let localUserVote = $state(userVote);
  let localUpvotes = $state(post.upvotes);
  let localDownvotes = $state(post.downvotes);
  let localComments = $state<CommentWithAuthor[]>(comments);
  let isVoting = $state(false);
  let newCommentContent = $state('');
  let isSubmittingComment = $state(false);
  let showCommentPreview = $state(false);
  let commentError = $state('');

  const netVotes = $derived(localUpvotes - localDownvotes);
  const backUrl = $derived.by(() => {
    const orgPath =
      organizationType === 'university'
        ? `/universities/${organizationSlug || organizationId}#posts`
        : `/clubs/${organizationSlug || organizationId}#posts`;
    return `${base}${orgPath}`;
  });

  const handleVote = async (voteType: 'upvote' | 'downvote') => {
    if (!currentUserId || isVoting) return;

    isVoting = true;
    try {
      const response = await fetch(`${base}/api/posts/${post.id}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ voteType })
      });

      if (response.ok) {
        const result = (await response.json()) as {
          upvotes: number;
          downvotes: number;
          userVote: 'upvote' | 'downvote' | null;
        };
        localUpvotes = result.upvotes;
        localDownvotes = result.downvotes;
        localUserVote = result.userVote;
      } else {
        console.error('Failed to vote');
      }
    } catch (error) {
      console.error('Error voting:', error);
    } finally {
      isVoting = false;
    }
  };

  const handleCommentSubmit = async () => {
    if (!currentUserId || !newCommentContent.trim() || isSubmittingComment) return;

    isSubmittingComment = true;
    commentError = '';

    try {
      const response = await fetch(`${base}/api/posts/${post.id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: newCommentContent.trim()
        })
      });

      if (response.ok) {
        newCommentContent = '';
        showCommentPreview = false;
        // Refresh comments by reloading the page
        window.location.reload();
      } else {
        const errorData = (await response.json()) as { error: string };
        commentError = errorData.error || 'Failed to post comment';
      }
    } catch {
      commentError = 'Network error. Please try again.';
    } finally {
      isSubmittingComment = false;
    }
  };

  const handleCommentVote = async (commentId: string, voteType: 'upvote' | 'downvote') => {
    // TODO: Implement comment voting
    console.log('Comment vote:', commentId, voteType);
  };

  const handleCommentReply = (commentId: string) => {
    // TODO: Implement comment replies
    console.log('Reply to comment:', commentId);
  };

  const handleCommentEdit = (commentId: string) => {
    // TODO: Implement comment editing
    console.log('Edit comment:', commentId);
  };

  const handleCommentDelete = (commentId: string) => {
    // TODO: Implement comment deletion
    console.log('Delete comment:', commentId);
  };

  onMount(async () => {
    content = await renderMarkdown(post.content);
  });
</script>

<svelte:head>
  <title>{post.title} - {organizationName} - {m.app_name()}</title>
  <meta name="description" content={post.content.substring(0, 200)} />
</svelte:head>

<div class="mx-auto max-w-4xl px-4 pt-20">
  <!-- Back link -->
  <div class="mb-6">
    <a href={backUrl} class="hover:text-primary flex items-center gap-2 text-sm transition-colors">
      <i class="fa-solid fa-arrow-left"></i>
      {m.back_to_posts()}
    </a>
  </div>

  <!-- Post -->
  <article class="bg-base-100 rounded-lg p-6 shadow-md">
    <!-- Post header -->
    <header class="mb-6">
      <div class="mb-4 flex items-start justify-between gap-4">
        <div class="flex items-center gap-3">
          <UserAvatar user={post.author} size="md" showName={false} />
          <div>
            <div class="font-medium">
              {post.author.displayName || post.author.name || m.anonymous_user()}
            </div>
            <div class="text-base-content/60 text-sm">
              {formatDistanceToNow(post.createdAt, { addSuffix: true })}
              {#if post.updatedAt && post.updatedAt !== post.createdAt}
                <span class="ml-1">({m.edited()})</span>
              {/if}
            </div>
          </div>
        </div>

        <!-- Post badges -->
        <div class="flex gap-2">
          {#if post.isPinned}
            <div class="badge badge-success">
              <i class="fa-solid fa-thumbtack mr-1"></i>
              {m.pinned_post()}
            </div>
          {/if}
          {#if post.isLocked}
            <div class="badge badge-warning">
              <i class="fa-solid fa-lock mr-1"></i>
              {m.locked_post()}
            </div>
          {/if}
        </div>
      </div>

      <h1 class="mb-4 text-3xl font-bold">{post.title}</h1>
    </header>

    <!-- Post content -->
    <div class="prose mb-6 max-w-none">
      {@html content}
    </div>

    <!-- Voting section -->
    <div class="flex items-center justify-between border-t pt-4">
      <div class="flex items-center gap-4">
        <!-- Vote buttons -->
        <div class="flex items-center gap-2">
          <button
            class="btn btn-ghost btn-sm {localUserVote === 'upvote' ? 'btn-success' : ''}"
            onclick={() => handleVote('upvote')}
            disabled={!currentUserId || isVoting}
            title={m.upvote()}
          >
            <i class="fa-solid fa-chevron-up"></i>
            <span>{localUpvotes}</span>
          </button>

          <span
            class="text-lg font-bold {netVotes > 0
              ? 'text-success'
              : netVotes < 0
                ? 'text-error'
                : 'text-base-content/60'}"
          >
            {netVotes > 0 ? '+' : ''}{netVotes}
          </span>

          <button
            class="btn btn-ghost btn-sm {localUserVote === 'downvote' ? 'btn-error' : ''}"
            onclick={() => handleVote('downvote')}
            disabled={!currentUserId || isVoting}
            title={m.downvote()}
          >
            <i class="fa-solid fa-chevron-down"></i>
            <span>{localDownvotes}</span>
          </button>
        </div>

        <!-- Comment count -->
        <div class="text-base-content/60 flex items-center gap-1">
          <i class="fa-solid fa-comments"></i>
          <span>{localComments.length}</span>
          <span>{m.comments().toLowerCase()}</span>
        </div>
      </div>

      {#if !currentUserId}
        <div class="text-base-content/60 text-sm">
          {m.login_to_vote_and_comment()}
        </div>
      {/if}
    </div>
  </article>

  <!-- Comments section -->
  <section class="mt-8">
    <h2 class="mb-6 flex items-center gap-2 text-xl font-semibold">
      <i class="fa-solid fa-comments"></i>
      {m.comments()} ({localComments.length})
    </h2>

    <!-- Add comment form -->
    {#if currentUserId}
      <div class="bg-base-100 mb-6 rounded-lg p-4">
        {#if commentError}
          <div class="alert alert-error mb-4">
            <i class="fa-solid fa-exclamation-triangle"></i>
            <span>{commentError}</span>
          </div>
        {/if}

        <!-- Comment tabs -->
        <div class="tabs tabs-boxed mb-3">
          <button
            class="tab {!showCommentPreview ? 'tab-active' : ''}"
            onclick={() => (showCommentPreview = false)}
          >
            <i class="fa-solid fa-edit mr-2"></i>
            {m.write()}
          </button>
          <button
            class="tab {showCommentPreview ? 'tab-active' : ''}"
            onclick={() => (showCommentPreview = true)}
            disabled={!newCommentContent.trim()}
          >
            <i class="fa-solid fa-eye mr-2"></i>
            {m.preview()}
          </button>
        </div>

        <!-- Comment input area -->
        {#if showCommentPreview}
          <div class="bg-base-200 prose prose-sm mb-3 min-h-[100px] max-w-none rounded-lg p-4">
            {#if newCommentContent.trim()}
              {@html renderMarkdown(newCommentContent)}
            {:else}
              <p class="text-base-content/60 italic">{m.nothing_to_preview()}</p>
            {/if}
          </div>
        {:else}
          <textarea
            placeholder={m.comment_placeholder()}
            class="textarea textarea-bordered mb-3 min-h-[100px] w-full"
            bind:value={newCommentContent}
            disabled={isSubmittingComment}
          ></textarea>
        {/if}

        <div class="flex items-center justify-between">
          <div class="text-base-content/60 text-xs">
            <i class="fa-brands fa-markdown mr-1"></i>
            {m.markdown_supported()}
          </div>
          <button
            class="btn btn-primary btn-sm"
            onclick={handleCommentSubmit}
            disabled={isSubmittingComment || !newCommentContent.trim()}
          >
            {#if isSubmittingComment}
              <span class="loading loading-spinner loading-sm"></span>
            {:else}
              <i class="fa-solid fa-paper-plane"></i>
            {/if}
            {m.post_comment()}
          </button>
        </div>
      </div>
    {/if}

    <!-- Comments list -->
    {#if localComments.length > 0}
      <div class="space-y-1">
        {#each localComments as comment (comment.id)}
          <Comment
            {comment}
            {currentUserId}
            canManage={false}
            onVote={handleCommentVote}
            onReply={handleCommentReply}
            onEdit={handleCommentEdit}
            onDelete={handleCommentDelete}
          />
        {/each}
      </div>
    {:else}
      <div class="bg-base-100 rounded-lg p-8 text-center">
        <i class="fa-solid fa-comments text-base-content/30 mb-4 text-4xl"></i>
        <h3 class="mb-2 text-lg font-medium">{m.no_comments_yet()}</h3>
        {#if currentUserId}
          <p class="text-base-content/60">{m.be_first_to_comment()}</p>
        {:else}
          <p class="text-base-content/60">{m.login_to_comment()}</p>
        {/if}
      </div>
    {/if}
  </section>
</div>
