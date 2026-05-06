<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import type { CommentWithAuthorAndVote, ImageAsset, ShopDeleteRequestVoteType } from '$lib/types';
  import type { User } from '$lib/auth/types';
  import { fromPath } from '$lib/utils/scoped';
  import UserAvatar from './UserAvatar.svelte';
  import ConfirmationModal from './ConfirmationModal.svelte';
  import PhotoCarousel from './PhotoCarousel.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { render } from '$lib/utils/markdown';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import { getDisplayName, getFnsLocale } from '$lib/utils';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { getLocale } from '$lib/paraglide/runtime';

  interface Props {
    comment: CommentWithAuthorAndVote;
    currentUserId?: string;
    currentUser?: User | undefined;
    canReply?: boolean;
    canEdit?: boolean;
    onReply?: (commentId: string) => void;
    onEdit?: (commentId: string, newContent: string, imageIds: string[]) => Promise<void>;
    onDelete?: (commentId: string) => void;
    onVote?: (commentId: string, voteType: 'upvote' | 'downvote') => void;
    isPostRendered: boolean;
    depth?: number;
    deleteRequestVoteType?: ShopDeleteRequestVoteType | null;
  }

  let {
    comment,
    currentUserId,
    currentUser = undefined,
    canReply: canReplyGeneral = false,
    canEdit = false,
    onReply,
    onEdit,
    onDelete,
    onVote,
    isPostRendered,
    depth = 0,
    deleteRequestVoteType = null
  }: Props = $props();

  let content = $state('');
  let showMenu = $state(false);
  let isEditing = $state(false);
  let editContent = $state('');
  let editImageIds = $state<string[]>([]);
  let editAttachments = $state<ImageAsset[]>([]);
  let isSavingEdit = $state(false);
  let showDeleteConfirm = $state(false);
  let showHighlight = $state(false);
  let commentElement: HTMLElement | undefined;

  // Limit nesting depth to avoid infinite nesting
  const maxDepth = 1;

  const netVotes = $derived(comment.upvotes - comment.downvotes);
  const isOwnComment = $derived(currentUserId === comment.createdBy);
  const canDelete = $derived(isOwnComment || canEdit);
  const canReply = $derived(canReplyGeneral && depth < maxDepth);

  const shouldIndent = $derived(depth > 0 && depth <= maxDepth);

  // Check if this comment is highlighted from query params
  const isHighlighted = $derived(page.url.searchParams.get('comment') === comment.id);

  const handleVote = (voteType: 'upvote' | 'downvote') => {
    if (onVote) {
      onVote(comment.id, voteType);
    }
  };

  const resetEditState = () => {
    editContent = comment.content;
    editImageIds = comment.images ? [...comment.images] : [];
    editAttachments = comment.resolvedImages ? [...comment.resolvedImages] : [];
  };

  const cleanupDraftImages = async (imageIds: string[]) => {
    await Promise.all(
      imageIds.map(async (imageId) => {
        try {
          await fetch(fromPath(`/api/images/${imageId}`), { method: 'DELETE' });
        } catch (error) {
          console.error('Failed to delete draft image:', error);
        }
      })
    );
  };

  const startEditing = () => {
    resetEditState();
    isEditing = true;
    showMenu = false;
  };

  const cancelEditing = () => {
    const originalImageIdSet = new Set(comment.images ?? []);
    const addedDraftImageIds = editImageIds.filter((imageId) => !originalImageIdSet.has(imageId));
    if (addedDraftImageIds.length > 0) {
      void cleanupDraftImages(addedDraftImageIds);
    }

    isEditing = false;
    resetEditState();
  };

  const handleReply = () => {
    if (onReply) {
      onReply(comment.id);
    }
    showMenu = false;
  };

  const handleDelete = () => {
    showDeleteConfirm = true;
    showMenu = false;
  };

  const confirmDelete = () => {
    if (onDelete) {
      onDelete(comment.id);
    }
  };

  const saveEdit = async () => {
    const trimmedContent = editContent.trim();
    if (!onEdit || (!trimmedContent && editImageIds.length === 0)) return;

    isSavingEdit = true;
    try {
      await onEdit(comment.id, trimmedContent, editImageIds);
      isEditing = false;
      comment.content = trimmedContent;
      comment.images = [...editImageIds];
      comment.resolvedImages = [...editAttachments];
      content = await render(comment.content);
    } catch (error) {
      console.error('Failed to save comment edit:', error);
    } finally {
      isSavingEdit = false;
    }
  };

  $effect(() => {
    render(comment.content).then((html) => {
      content = html;
    });
  });

  $effect(() => {
    if (isPostRendered) {
      setTimeout(() => {
        if (isHighlighted && commentElement) {
          commentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          showHighlight = true;
          setTimeout(() => {
            showHighlight = false;
          }, 2000);
        }
      }, 1000);
    }
  });
</script>

<div class="comment {shouldIndent ? 'ml-8' : ''} {depth > maxDepth ? 'opacity-60' : ''}">
  <div
    bind:this={commentElement}
    class="hover:bg-base-300/50 flex gap-3 rounded-xl p-3 transition-colors {showHighlight
      ? 'bg-primary/15'
      : ''}"
    id="comment-{comment.id}"
  >
    <!-- Avatar -->
    <div class="shrink-0">
      <UserAvatar user={comment.author} size="sm" showName={false} />
    </div>

    <div class="flex-1 space-y-2">
      <!-- Header -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-sm">
          <a
            href={resolve('/(main)/users/[id]', { id: '@' + comment.author?.name })}
            class="hover:text-accent font-medium transition-colors"
          >
            {getDisplayName(comment.author)}
          </a>
          {#if deleteRequestVoteType}
            <span
              class="badge badge-xs badge-soft {deleteRequestVoteType === 'favor'
                ? 'badge-success'
                : 'badge-error'}"
            >
              {deleteRequestVoteType === 'favor'
                ? m.delete_request_vote_favor()
                : m.delete_request_vote_against()}
            </span>
          {/if}
          <span class="text-base-content/60">
            {formatDistanceToNow(comment.createdAt, {
              addSuffix: true,
              locale: getFnsLocale(getLocale())
            })}
          </span>
          {#if comment.updatedAt && comment.updatedAt !== comment.createdAt}
            <span class="text-base-content/40 text-xs">
              ({m.edited()})
            </span>
          {/if}
        </div>

        <!-- Menu -->
        {#if currentUserId && (canReply || canDelete || isOwnComment)}
          <details class="dropdown dropdown-end" bind:open={showMenu}>
            <summary class="btn btn-ghost btn-circle btn-xs" aria-label={m.actions()}>
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </summary>
            <ul class="dropdown-content menu bg-base-200 rounded-box z-1 w-48 p-2 shadow">
              {#if canReply}
                <li>
                  <button onclick={handleReply} class="text-primary">
                    <i class="fa-solid fa-reply"></i>
                    {m.reply()}
                  </button>
                </li>
              {/if}
              {#if isOwnComment}
                <li>
                  <button onclick={startEditing} class="text-info">
                    <i class="fa-solid fa-edit"></i>
                    {m.edit_comment()}
                  </button>
                </li>
              {/if}
              {#if canDelete}
                <li>
                  <button onclick={handleDelete} class="text-error">
                    <i class="fa-solid fa-trash"></i>
                    {m.delete_comment()}
                  </button>
                </li>
              {/if}
            </ul>
          </details>
        {/if}
      </div>

      <!-- Content -->
      {#if isEditing}
        <div class="space-y-3">
          <MarkdownEditor
            bind:value={editContent}
            bind:attachments={editAttachments}
            bind:imageIds={editImageIds}
            placeholder={m.comment_placeholder()}
            disabled={isSavingEdit}
            minHeight="min-h-[100px]"
            {currentUser}
            imageUploadUrl={fromPath('/api/images')}
            persistedImageIds={comment.images ?? []}
          />
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onclick={cancelEditing}
              disabled={isSavingEdit}
            >
              {m.cancel()}
            </button>
            <button
              type="button"
              class="btn btn-soft btn-primary btn-sm"
              onclick={saveEdit}
              disabled={isSavingEdit || (!editContent.trim() && editImageIds.length === 0)}
            >
              {#if isSavingEdit}
                <span class="loading loading-spinner loading-xs"></span>
              {/if}
              {m.save()}
            </button>
          </div>
        </div>
      {:else}
        <div class="space-y-3">
          {#if comment.content}
            <div class="prose not-md:prose-xs md:prose-sm max-w-none overflow-x-auto break-all">
              {@html content}
            </div>
          {/if}

          {#if (comment.resolvedImages?.length ?? 0) > 0}
            <PhotoCarousel
              photos={comment.resolvedImages ?? []}
              {currentUser}
              title=""
              allowDeleteRequest={false}
              showEmptyState={false}
              onPhotoDeleted={(photo) => {
                comment.images = (comment.images ?? []).filter((imageId) => imageId !== photo.id);
                comment.resolvedImages = (comment.resolvedImages ?? []).filter(
                  (image) => image.id !== photo.id
                );
              }}
            />
          {/if}
        </div>
      {/if}

      <!-- Actions -->
      {#if !isEditing}
        <div class="flex items-center gap-4 text-sm">
          <!-- Voting -->
          <div class="flex items-center gap-2">
            <button
              class="btn btn-ghost hover:btn-success btn-xs flex items-center gap-1 {comment.vote
                ?.voteType === 'upvote'
                ? 'not-hover:text-success'
                : ''}"
              onclick={() => handleVote('upvote')}
              disabled={!currentUserId}
            >
              <i class="fa-solid fa-caret-up fa-lg"></i>
              <span>{comment.upvotes}</span>
            </button>

            <span
              class="text-base-content/60 font-medium {netVotes > 0
                ? 'text-success'
                : netVotes < 0
                  ? 'text-error'
                  : ''}"
            >
              {netVotes > 0 ? '+' : ''}{netVotes}
            </span>

            <button
              class="btn btn-ghost hover:btn-error btn-xs flex items-center gap-1 {comment.vote
                ?.voteType === 'downvote'
                ? 'not-hover:text-error'
                : ''}"
              onclick={() => handleVote('downvote')}
              disabled={!currentUserId}
            >
              <i class="fa-solid fa-caret-down fa-lg"></i>
              <span>{comment.downvotes}</span>
            </button>
          </div>

          <!-- Reply button -->
          {#if currentUserId && onReply && canReply}
            <button class="btn btn-ghost btn-xs" onclick={handleReply}>
              <i class="fa-solid fa-reply"></i>
              {m.reply()}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<ConfirmationModal
  bind:isOpen={showDeleteConfirm}
  title={m.confirm_delete_comment_title()}
  message={m.confirm_delete_comment()}
  onConfirm={confirmDelete}
  onCancel={() => {}}
/>
