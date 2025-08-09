<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import type { CommentWithAuthorAndVote } from '$lib/types';
  import UserAvatar from './UserAvatar.svelte';
  import ConfirmationModal from './ConfirmationModal.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { render } from '$lib/markdown';
  import { onMount } from 'svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import { getDisplayName } from '$lib/utils';
  import { base } from '$app/paths';

  interface Props {
    comment: CommentWithAuthorAndVote;
    currentUserId?: string;
    canReply?: boolean;
    canEdit?: boolean;
    onReply?: (commentId: string) => void;
    onEdit?: (commentId: string, newContent: string) => Promise<void>;
    onDelete?: (commentId: string) => void;
    onVote?: (commentId: string, voteType: 'upvote' | 'downvote') => void;
    depth?: number;
  }

  let {
    comment,
    currentUserId,
    canReply: canReplyGeneral = false,
    canEdit = false,
    onReply,
    onEdit,
    onDelete,
    onVote,
    depth = 0
  }: Props = $props();

  let content = $state('');
  let showMenu = $state(false);
  let isEditing = $state(false);
  let editContent = $state(comment.content);
  let isSavingEdit = $state(false);
  let showDeleteConfirm = $state(false);

  // Limit nesting depth to avoid infinite nesting
  const maxDepth = 1;

  const netVotes = $derived(comment.upvotes - comment.downvotes);
  const isOwnComment = $derived(currentUserId === comment.createdBy);
  const canEditOrDelete = $derived(isOwnComment || canEdit);
  const canReply = $derived(canReplyGeneral && depth < maxDepth);

  const shouldIndent = $derived(depth > 0 && depth <= maxDepth);

  const handleVote = (voteType: 'upvote' | 'downvote') => {
    if (onVote) {
      onVote(comment.id, voteType);
    }
  };

  const startEditing = () => {
    isEditing = true;
    editContent = comment.content;
    showMenu = false;
  };

  const cancelEditing = () => {
    isEditing = false;
    editContent = comment.content;
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
    if (!onEdit || !editContent.trim()) return;

    isSavingEdit = true;
    try {
      await onEdit(comment.id, editContent.trim());
      isEditing = false;
      comment.content = editContent.trim();
      // Re-render markdown content
      content = await render(comment.content);
    } catch (error) {
      console.error('Failed to save comment edit:', error);
    } finally {
      isSavingEdit = false;
    }
  };

  onMount(async () => {
    content = await render(comment.content);
  });
</script>

<div class="comment {shouldIndent ? 'ml-8' : ''} {depth > maxDepth ? 'opacity-60' : ''}">
  <div class="hover:bg-base-300/50 flex gap-3 rounded-xl p-3 transition-colors">
    <!-- Avatar -->
    <div class="shrink-0">
      <UserAvatar user={comment.author} size="sm" showName={false} />
    </div>

    <div class="flex-1 space-y-2">
      <!-- Header -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-sm">
          <a
            href="{base}/users/@{comment.author.name}"
            class="hover:text-accent font-medium transition-colors"
          >
            {getDisplayName(comment.author)}
          </a>
          <span class="text-base-content/60">
            {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
          </span>
          {#if comment.updatedAt && comment.updatedAt !== comment.createdAt}
            <span class="text-base-content/40 text-xs">
              ({m.edited()})
            </span>
          {/if}
        </div>

        <!-- Menu -->
        {#if currentUserId && (canReply || canEditOrDelete)}
          <details class="dropdown dropdown-end" bind:open={showMenu}>
            <summary class="btn btn-ghost btn-circle btn-xs" aria-label={m.actions()}>
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </summary>
            <ul class="dropdown-content menu bg-base-200 rounded-box z-[1] w-48 p-2 shadow">
              {#if canReply}
                <li>
                  <button onclick={handleReply} class="text-primary">
                    <i class="fa-solid fa-reply"></i>
                    {m.reply()}
                  </button>
                </li>
              {/if}
              {#if canEditOrDelete}
                <li>
                  <button onclick={startEditing} class="text-info">
                    <i class="fa-solid fa-edit"></i>
                    {m.edit_comment()}
                  </button>
                </li>
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
            placeholder={m.comment_placeholder()}
            disabled={isSavingEdit}
            minHeight="min-h-[100px]"
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
              disabled={isSavingEdit || !editContent.trim()}
            >
              {#if isSavingEdit}
                <span class="loading loading-spinner loading-xs"></span>
              {/if}
              {m.save()}
            </button>
          </div>
        </div>
      {:else}
        <div class="prose not-md:prose-xs md:prose-sm max-w-none overflow-x-auto">
          {@html content}
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
