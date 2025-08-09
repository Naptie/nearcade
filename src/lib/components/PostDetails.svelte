<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import { type PostWithAuthor, type CommentWithAuthorAndVote, PostWritability } from '$lib/types';
  import UserAvatar from './UserAvatar.svelte';
  import Comment from './Comment.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import ConfirmationModal from './ConfirmationModal.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { base } from '$app/paths';
  import { renderMarkdown } from '$lib/markdown';
  import { onMount, onDestroy } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { getDisplayName, fromPath } from '$lib/utils';

  interface Props {
    post: PostWithAuthor;
    comments: CommentWithAuthorAndVote[];
    userVote: 'upvote' | 'downvote' | null;
    currentUserId?: string;
    organizationType: 'university' | 'club';
    organizationName: string;
    organizationSlug?: string;
    organizationId: string;
    canJoinOrganization: boolean;
    postWritability?: PostWritability;
    canManage?: boolean; // User can pin/unpin, lock/unlock posts
    canEdit?: boolean; // User can edit/delete posts
    canComment?: boolean; // User can comment on posts
  }

  let {
    post,
    comments,
    userVote,
    currentUserId,
    organizationType,
    organizationName,
    organizationSlug,
    organizationId,
    canJoinOrganization,
    postWritability = organizationType === 'university'
      ? PostWritability.UNIV_MEMBERS
      : PostWritability.CLUB_MEMBERS,
    canManage = false,
    canEdit = false,
    canComment: canCommentGeneral = false
  }: Props = $props();

  let content = $state('');
  let isVoting = $state(false);
  let newCommentContent = $state('');
  let isSubmittingComment = $state(false);
  let commentError = $state('');
  let replyingTo = $state<string | null>(null);
  let replyContent = $state('');
  let isSubmittingReply = $state(false);
  let componentMounted = $state(true);
  let localPost = $state(post);
  let showManageMenu = $state(false);
  let isEditingPost = $state(false);
  let editTitle = $state(post.title);
  let editContent = $state(post.content);
  let isSavingPost = $state(false);
  let showDeletePostConfirm = $state(false);
  let showDeleteCommentConfirm = $state(false);
  let deletingCommentId = $state('');

  let netVotes = $derived(post.upvotes - post.downvotes);
  let isOwnPost = $derived(currentUserId === post.createdBy);
  let canEditPost = $derived(isOwnPost || canEdit);
  let canManagePost = $derived(canManage);

  // Determine if user can vote based on post readability permissions
  let canVote = $derived.by(() => {
    if (!currentUserId) return false;
    if (localPost.isLocked && !canManagePost) return false;

    // Voting permissions align with post readability - anyone who can read can vote
    // The API already handles this, so for UI we just need to check basic permissions
    // The actual permission enforcement is done in the API
    return true;
  });

  // Determine if user can comment based on post writability permissions
  let canComment = $derived.by(() => {
    if (!currentUserId) return false;
    if (localPost.isLocked && !canManagePost) return false;
    return canCommentGeneral;
  });
  let backUrl = $derived.by(() => {
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
      const response = await fetch(fromPath(`/api/posts/${post.id}/vote`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ voteType })
      });

      if (response.ok) {
        invalidateAll();
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
      const response = await fetch(fromPath(`/api/posts/${post.id}/comments`), {
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
        invalidateAll();
      } else {
        const errorData = (await response.json()) as { error: string };
        commentError = errorData.error || m.failed_to_post_comment();
      }
    } catch {
      commentError = m.network_error_try_again();
    } finally {
      isSubmittingComment = false;
    }
  };

  const handleCommentVote = async (commentId: string, voteType: 'upvote' | 'downvote') => {
    if (!currentUserId) return;

    try {
      const response = await fetch(fromPath(`/api/comments/${commentId}/vote`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ voteType })
      });

      if (response.ok) {
        invalidateAll();
      } else {
        console.error('Failed to vote on comment');
      }
    } catch (error) {
      console.error('Error voting on comment:', error);
    }
  };

  const handleCommentReply = (commentId: string) => {
    replyingTo = commentId;
    replyContent = '';
  };

  const submitReply = async () => {
    if (!currentUserId || !replyContent.trim() || !replyingTo || isSubmittingReply) return;

    isSubmittingReply = true;
    commentError = '';

    try {
      const response = await fetch(fromPath(`/api/posts/${post.id}/comments`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: replyContent.trim(),
          parentCommentId: replyingTo
        })
      });

      if (response.ok) {
        replyingTo = null;
        replyContent = '';
        invalidateAll();
      } else {
        const errorData = (await response.json()) as { error: string };
        commentError = errorData.error || m.failed_to_post_comment();
      }
    } catch {
      commentError = m.network_error_try_again();
    } finally {
      isSubmittingReply = false;
    }
  };

  const handleCommentEdit = async (commentId: string, newContent: string) => {
    if (!currentUserId) return;

    try {
      const response = await fetch(fromPath(`/api/comments/${commentId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: newContent })
      });

      if (response.ok) {
        // Update the comment in local state
        comments = comments.map((comment) =>
          comment.id === commentId
            ? { ...comment, content: newContent, updatedAt: new Date() }
            : comment
        );
      } else {
        const errorData = (await response.json()) as { error: string };
        throw new Error(errorData.error || 'Failed to edit comment');
      }
    } catch (error) {
      console.error('Error editing comment:', error);
      throw error; // Re-throw so the component can handle it
    }
  };

  const handleCommentDelete = async (commentId: string) => {
    if (!currentUserId) return;

    deletingCommentId = commentId;
    showDeleteCommentConfirm = true;
  };

  const confirmDeleteComment = async () => {
    if (!deletingCommentId) return;

    try {
      const response = await fetch(fromPath(`/api/comments/${deletingCommentId}`), {
        method: 'DELETE'
      });

      if (response.ok) {
        // Remove comment from local state
        comments = comments.filter(
          (c) => c.id !== deletingCommentId && c.parentCommentId !== deletingCommentId
        );
      } else {
        const errorData = (await response.json()) as { error: string };
        alert(errorData.error || 'Failed to delete comment');
      }
    } catch (error) {
      console.error('Error deleting comment:', error);
      alert(m.network_error_try_again());
    }
  };

  // Post management functions
  const togglePinPost = async () => {
    if (!canManagePost) return;

    try {
      const response = await fetch(fromPath(`/api/posts/${post.id}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ isPinned: !localPost.isPinned })
      });

      if (response.ok) {
        localPost = { ...localPost, isPinned: !localPost.isPinned };
        showManageMenu = false;
      } else {
        const errorData = (await response.json()) as { error: string };
        alert(errorData.error || 'Failed to update post');
      }
    } catch (error) {
      console.error('Error updating post:', error);
      alert(m.network_error_try_again());
    }
  };

  const toggleLockPost = async () => {
    if (!canManagePost) return;

    try {
      const response = await fetch(fromPath(`/api/posts/${post.id}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ isLocked: !localPost.isLocked })
      });

      if (response.ok) {
        localPost = { ...localPost, isLocked: !localPost.isLocked };
        showManageMenu = false;
      } else {
        const errorData = (await response.json()) as { error: string };
        alert(errorData.error || 'Failed to update post');
      }
    } catch (error) {
      console.error('Error updating post:', error);
      alert(m.network_error_try_again());
    }
  };

  const startEditingPost = () => {
    if (!canEditPost) return;
    isEditingPost = true;
    editTitle = localPost.title;
    editContent = localPost.content;
    showManageMenu = false;
  };

  const cancelEditingPost = () => {
    isEditingPost = false;
    editTitle = localPost.title;
    editContent = localPost.content;
  };

  const savePostEdit = async () => {
    if (!canEditPost || !editTitle.trim() || !editContent.trim()) return;

    isSavingPost = true;
    try {
      const response = await fetch(fromPath(`/api/posts/${post.id}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: editTitle.trim(),
          content: editContent.trim()
        })
      });

      if (response.ok) {
        localPost = {
          ...localPost,
          title: editTitle.trim(),
          content: editContent.trim(),
          updatedAt: new Date()
        };
        isEditingPost = false;
        // Re-render content
        content = await renderMarkdown(localPost.content);
      } else {
        const errorData = (await response.json()) as { error: string };
        alert(errorData.error || 'Failed to update post');
      }
    } catch (error) {
      console.error('Error updating post:', error);
      alert(m.network_error_try_again());
    } finally {
      isSavingPost = false;
    }
  };

  const deletePost = async () => {
    if (!canEditPost) return;
    showDeletePostConfirm = true;
  };

  const confirmDeletePost = async () => {
    try {
      const response = await fetch(fromPath(`/api/posts/${post.id}`), {
        method: 'DELETE'
      });

      if (response.ok) {
        // Redirect back to posts list
        window.location.href = backUrl;
      } else {
        const errorData = (await response.json()) as { error: string };
        alert(errorData.error || 'Failed to delete post');
      }
    } catch (error) {
      console.error('Error deleting post:', error);
      alert(m.network_error_try_again());
    }
  };

  onMount(async () => {
    content = await renderMarkdown(localPost.content);
  });

  onDestroy(() => {
    componentMounted = false;
  });
</script>

<svelte:head>
  <title>{post.title} - {organizationName} - {m.app_name()}</title>
  <meta name="description" content={post.content.substring(0, 200)} />
</svelte:head>

{#if componentMounted}
  <div class="mx-auto {isEditingPost ? 'max-w-full' : 'max-w-6xl'} pt-20 pb-4 sm:px-4">
    <!-- Back link -->
    <div class="mb-6 not-sm:px-4">
      <a
        href={backUrl}
        class="hover:text-primary flex items-center gap-2 text-sm transition-colors"
      >
        <i class="fa-solid fa-arrow-left"></i>
        {m.back_to_posts()}
      </a>
    </div>

    <!-- Post -->
    <article class="bg-base-100 rounded-2xl p-6 shadow transition-shadow hover:shadow-xl">
      <!-- Post header -->
      <header class="mb-6">
        <div class="mb-4 flex items-start justify-between gap-4">
          <div class="flex items-center gap-3">
            <UserAvatar user={post.author} size="md" showName={false} />
            <div>
              <a
                href="{base}/users/@{post.author.name}"
                class="hover:text-accent font-medium transition-colors"
              >
                {getDisplayName(post.author)}
              </a>
              <div class="text-base-content/60 text-sm">
                {formatDistanceToNow(post.createdAt, { addSuffix: true })}
                {#if post.updatedAt && post.updatedAt !== post.createdAt}
                  <span class="ml-1">({m.edited()})</span>
                {/if}
              </div>
            </div>
          </div>

          <!-- Post badges -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex gap-2 text-nowrap">
              {#if localPost.isPinned}
                <div class="badge badge-soft badge-info">
                  <i class="fa-solid fa-thumbtack"></i>
                  <span class="not-sm:hidden">{m.pinned()}</span>
                </div>
              {/if}
              {#if localPost.isLocked}
                <div class="badge badge-soft badge-warning">
                  <i class="fa-solid fa-lock mr-1"></i>
                  <span class="not-sm:hidden">{m.locked()}</span>
                </div>
              {/if}
            </div>

            <!-- Management menu -->
            {#if currentUserId && (canManagePost || canEditPost)}
              <details class="dropdown dropdown-end" bind:open={showManageMenu}>
                <summary class="btn btn-ghost btn-circle btn-sm" aria-label={m.actions()}>
                  <i class="fa-solid fa-ellipsis-vertical"></i>
                </summary>
                <ul class="dropdown-content menu bg-base-200 rounded-box z-[1] w-56 p-2 shadow">
                  {#if canManagePost}
                    <li>
                      <button onclick={togglePinPost} class="text-info">
                        <i class="fa-solid fa-thumbtack"></i>
                        {localPost.isPinned ? m.unpin_post() : m.pin_post()}
                      </button>
                    </li>
                    <li>
                      <button onclick={toggleLockPost} class="text-warning">
                        <i class="fa-solid {localPost.isLocked ? 'fa-unlock' : 'fa-lock'}"></i>
                        {localPost.isLocked ? m.unlock_post() : m.lock_post()}
                      </button>
                    </li>
                  {/if}
                  {#if canEditPost}
                    <li>
                      <button onclick={startEditingPost} class="text-success">
                        <i class="fa-solid fa-edit"></i>
                        {m.edit_post()}
                      </button>
                    </li>
                    <li>
                      <button onclick={deletePost} class="text-error">
                        <i class="fa-solid fa-trash"></i>
                        {m.delete_post()}
                      </button>
                    </li>
                  {/if}
                </ul>
              </details>
            {/if}
          </div>
        </div>

        <!-- Post title -->
        {#if isEditingPost}
          <div class="mb-4">
            <input
              type="text"
              class="input input-bordered w-full text-2xl font-bold"
              bind:value={editTitle}
              disabled={isSavingPost}
              maxlength="200"
            />
          </div>
        {:else}
          <h1 class="mb-4 text-3xl font-bold md:text-4xl">{localPost.title}</h1>
        {/if}
      </header>

      <!-- Post content -->
      {#if isEditingPost}
        <div class="mb-6">
          <MarkdownEditor
            bind:value={editContent}
            placeholder={m.post_content_placeholder()}
            disabled={isSavingPost}
            minHeight="min-h-48"
          />
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="btn btn-ghost"
              onclick={cancelEditingPost}
              disabled={isSavingPost}
            >
              {m.cancel()}
            </button>
            <button
              type="button"
              class="btn btn-primary"
              onclick={savePostEdit}
              disabled={isSavingPost || !editTitle.trim() || !editContent.trim()}
            >
              {#if isSavingPost}
                <span class="loading loading-spinner loading-sm"></span>
              {/if}
              {m.save_changes()}
            </button>
          </div>
        </div>
      {:else}
        <div class="prose not-md:prose-sm mb-6 max-w-none overflow-x-auto">
          {@html content}
        </div>
      {/if}

      <!-- Voting section -->
      <div class="flex items-center justify-between pt-4 not-sm:flex-col">
        <div class="flex items-center gap-4">
          <!-- Vote buttons -->
          <div class="flex items-center gap-2">
            <button
              class="btn btn-ghost hover:btn-success btn-sm {userVote === 'upvote'
                ? 'not-hover:text-success'
                : ''}"
              onclick={() => handleVote('upvote')}
              disabled={!canVote || isVoting}
              title={m.upvote()}
            >
              <i class="fa-solid fa-caret-up fa-lg"></i>
              <span>{post.upvotes}</span>
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
              class="btn btn-ghost hover:btn-error btn-sm {userVote === 'downvote'
                ? 'not-hover:text-error'
                : ''}"
              onclick={() => handleVote('downvote')}
              disabled={!canVote || isVoting}
              title={m.downvote()}
            >
              <i class="fa-solid fa-caret-down fa-lg"></i>
              <span>{post.downvotes}</span>
            </button>
          </div>

          <!-- Comment count -->
          <div class="text-base-content/60 flex items-center gap-1 text-nowrap not-sm:hidden">
            <i class="fa-solid fa-comments"></i>
            <span>{comments.length}</span>
            <span>{m.comments().toLowerCase()}</span>
          </div>
        </div>

        {#if !currentUserId}
          <button
            class="text-base-content/60 hover:text-accent link cursor-pointer text-sm transition-colors"
            onclick={() => {
              window.dispatchEvent(new CustomEvent('nearcade-login'));
            }}
          >
            {m.login_to_vote_and_comment()}
          </button>
        {/if}
      </div>
    </article>

    <!-- Comments section -->
    <section class="mt-8">
      <h2 class="mb-6 flex items-center gap-2 text-xl font-semibold not-sm:px-4">
        <i class="fa-solid fa-comments"></i>
        {m.comments()} ({comments.length})
      </h2>

      <!-- Add comment form -->
      {#if canComment}
        <div class="bg-base-100 mb-6 rounded-xl p-4">
          {#if commentError}
            <div class="alert alert-error mb-4">
              <i class="fa-solid fa-exclamation-triangle"></i>
              <span>{commentError}</span>
            </div>
          {/if}

          <MarkdownEditor
            bind:value={newCommentContent}
            placeholder={m.comment_placeholder()}
            disabled={isSubmittingComment}
            minHeight="min-h-[100px]"
          />

          <div class="mt-3 flex justify-end">
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
      {:else if currentUserId && (localPost.isLocked || !canComment)}
        <div class="bg-base-200 group mb-6 flex flex-col items-center gap-2 rounded-xl p-4">
          {#if localPost.isLocked}
            <i class="fa-solid fa-lock text-warning text-2xl"></i>
            <p class="text-base-content/60">{m.post_locked_no_comments()}</p>
          {:else if canJoinOrganization && organizationType === 'university' && postWritability === PostWritability.UNIV_MEMBERS}
            <i class="fa-solid fa-user-check text-warning text-2xl"></i>
            <a
              href="{base}/universities/{organizationSlug || organizationId}/verify"
              class="text-base-content/60 group-hover:link-accent transition-colors"
              >{m.verify_and_join_university_to_comment()}</a
            >
          {:else if canJoinOrganization && organizationType === 'club' && postWritability === PostWritability.CLUB_MEMBERS}
            <i class="fa-solid fa-user-check text-warning text-2xl"></i>
            <a
              href="{base}/clubs/{organizationSlug || organizationId}"
              class="text-base-content/60 group-hover:link-accent transition-colors"
              >{m.join_club_to_comment()}</a
            >
          {:else}
            <i class="fa-solid fa-ban text-error text-4xl"></i>
            <p class="text-base-content/60">{m.no_comment_permission()}</p>
          {/if}
        </div>
      {/if}

      <!-- Comments list -->
      {#if comments.length > 0}
        <div class="space-y-1">
          {#each comments.filter((c) => !c.parentCommentId) as comment (comment.id)}
            <div>
              <Comment
                {comment}
                {currentUserId}
                canReply={canComment}
                {canEdit}
                onVote={canVote ? handleCommentVote : undefined}
                onReply={canComment ? handleCommentReply : undefined}
                onEdit={handleCommentEdit}
                onDelete={handleCommentDelete}
                depth={0}
              />

              <!-- Reply form -->
              {#if replyingTo === comment.id}
                <div class="bg-base-200 mt-2 ml-8 rounded-xl p-4">
                  {#if commentError}
                    <div class="alert alert-error mb-4">
                      <i class="fa-solid fa-exclamation-triangle"></i>
                      <span>{commentError}</span>
                    </div>
                  {/if}

                  <MarkdownEditor
                    bind:value={replyContent}
                    placeholder={m.reply_to_comment()}
                    disabled={isSubmittingReply}
                    minHeight="min-h-[100px]"
                  />

                  <div class="mt-3 flex items-center justify-end">
                    <div class="flex gap-2">
                      <button
                        class="btn btn-ghost btn-sm"
                        onclick={() => {
                          replyingTo = null;
                          replyContent = '';
                        }}
                        disabled={isSubmittingReply}
                      >
                        {m.cancel()}
                      </button>
                      <button
                        class="btn btn-primary btn-sm"
                        onclick={submitReply}
                        disabled={isSubmittingReply || !replyContent.trim()}
                      >
                        {#if isSubmittingReply}
                          <span class="loading loading-spinner loading-sm"></span>
                        {:else}
                          <i class="fa-solid fa-paper-plane"></i>
                        {/if}
                        {m.reply()}
                      </button>
                    </div>
                  </div>
                </div>
              {/if}

              <!-- Nested replies -->
              {#each comments.filter((c) => c.parentCommentId === comment.id) as reply (reply.id)}
                <Comment
                  comment={reply}
                  {currentUserId}
                  canReply={canComment}
                  {canEdit}
                  onVote={canVote ? handleCommentVote : undefined}
                  onReply={canComment ? handleCommentReply : undefined}
                  onEdit={handleCommentEdit}
                  onDelete={handleCommentDelete}
                  depth={1}
                />
              {/each}
            </div>
          {/each}
        </div>
      {:else}
        <div class="bg-base-100 rounded-xl p-8 text-center">
          <i class="fa-solid fa-comments text-base-content/30 mb-4 text-4xl"></i>
          <h3 class="mb-2 text-lg font-medium">{m.no_comments_yet()}</h3>
          {#if currentUserId}
            {#if canComment}
              <p class="text-base-content/60">{m.be_first_to_comment()}</p>
            {/if}
          {:else}
            <p class="text-base-content/60">{m.login_to_comment()}</p>
          {/if}
        </div>
      {/if}
    </section>
  </div>
{/if}

<!-- Confirmation Modals -->
<ConfirmationModal
  bind:isOpen={showDeletePostConfirm}
  title={m.confirm_delete_post_title()}
  message={m.confirm_delete_post()}
  onConfirm={confirmDeletePost}
  onCancel={() => {}}
/>

<ConfirmationModal
  bind:isOpen={showDeleteCommentConfirm}
  title={m.confirm_delete_comment_title()}
  message={m.confirm_delete_comment()}
  onConfirm={confirmDeleteComment}
  onCancel={() => {
    deletingCommentId = '';
  }}
/>
