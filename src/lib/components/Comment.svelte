<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import type { CommentWithAuthor } from '$lib/types';
  import UserAvatar from './UserAvatar.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { enhance } from '$app/forms';
  
  interface Props {
    comment: CommentWithAuthor;
    currentUserId?: string;
    canManage?: boolean;
    onReply?: (commentId: string) => void;
    onEdit?: (commentId: string) => void;
    onDelete?: (commentId: string) => void;
    onVote?: (commentId: string, voteType: 'upvote' | 'downvote') => void;
    isReplying?: boolean;
    depth?: number;
  }

  let { 
    comment, 
    currentUserId, 
    canManage = false,
    onReply,
    onEdit,
    onDelete,
    onVote,
    isReplying = false,
    depth = 0
  }: Props = $props();

  let showMenu = $state(false);
  let isEditing = $state(false);
  let editContent = $state(comment.content);

  const netVotes = $derived(comment.upvotes - comment.downvotes);
  const isOwnComment = $derived(currentUserId === comment.createdBy);
  const canEditOrDelete = $derived(isOwnComment || canManage);
  
  // Limit nesting depth to avoid infinite nesting
  const maxDepth = 3;
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
    if (onDelete && confirm(m.confirm_delete_comment())) {
      onDelete(comment.id);
    }
    showMenu = false;
  };
</script>

<div class="comment {shouldIndent ? 'ml-8' : ''} {depth > maxDepth ? 'opacity-60' : ''}">
  <div class="flex gap-3 p-3 hover:bg-base-300/50 rounded-lg transition-colors">
    <!-- Avatar -->
    <div class="shrink-0">
      <UserAvatar user={comment.author} size="sm" showName={false} />
    </div>

    <div class="flex-1 space-y-2">
      <!-- Header -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-sm">
          <span class="font-medium">
            {comment.author.displayName || comment.author.name || m.anonymous_user()}
          </span>
          <span class="text-base-content/60">
            {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
          </span>
          {#if comment.updatedAt && comment.updatedAt.getTime() !== comment.createdAt.getTime()}
            <span class="text-base-content/40 text-xs">
              ({m.edited()})
            </span>
          {/if}
        </div>

        <!-- Menu -->
        {#if currentUserId}
          <div class="dropdown dropdown-end">
            <button
              type="button"
              tabindex="0"
              role="button"
              class="btn btn-ghost btn-circle btn-xs"
              onclick={() => (showMenu = !showMenu)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  showMenu = !showMenu;
                }
              }}
            >
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
            {#if showMenu}
              <ul class="dropdown-content menu bg-base-200 rounded-box z-[1] w-48 p-2 shadow">
                <li>
                  <button onclick={handleReply} class="text-primary">
                    <i class="fa-solid fa-reply"></i>
                    {m.reply()}
                  </button>
                </li>
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
            {/if}
          </div>
        {/if}
      </div>

      <!-- Content -->
      {#if isEditing}
        <form 
          method="POST" 
          action="?/editComment"
          use:enhance={() => {
            return async ({ result }) => {
              if (result.type === 'success') {
                isEditing = false;
              }
            };
          }}
        >
          <input type="hidden" name="commentId" value={comment.id} />
          <div class="space-y-3">
            <textarea
              name="content"
              bind:value={editContent}
              class="textarea textarea-bordered w-full min-h-[100px]"
              placeholder={m.comment_placeholder()}
              required
            ></textarea>
            <div class="flex gap-2">
              <button type="submit" class="btn btn-primary btn-sm">
                {m.save()}
              </button>
              <button type="button" class="btn btn-ghost btn-sm" onclick={cancelEditing}>
                {m.cancel()}
              </button>
            </div>
          </div>
        </form>
      {:else}
        <div class="prose prose-sm max-w-none">
          {@html comment.content}
        </div>
      {/if}

      <!-- Actions -->
      {#if !isEditing}
        <div class="flex items-center gap-4 text-sm">
          <!-- Voting -->
          <div class="flex items-center gap-2">
            <button 
              class="btn btn-ghost btn-xs flex items-center gap-1"
              onclick={() => handleVote('upvote')}
              disabled={!currentUserId}
            >
              <i class="fa-solid fa-chevron-up"></i>
              <span>{comment.upvotes}</span>
            </button>
            
            <span class="text-base-content/60 font-medium {netVotes > 0 ? 'text-success' : netVotes < 0 ? 'text-error' : ''}">
              {netVotes > 0 ? '+' : ''}{netVotes}
            </span>
            
            <button 
              class="btn btn-ghost btn-xs flex items-center gap-1"
              onclick={() => handleVote('downvote')}
              disabled={!currentUserId}
            >
              <i class="fa-solid fa-chevron-down"></i>
              <span>{comment.downvotes}</span>
            </button>
          </div>

          <!-- Reply button -->
          {#if currentUserId && onReply}
            <button 
              class="btn btn-ghost btn-xs"
              onclick={handleReply}
            >
              <i class="fa-solid fa-reply"></i>
              {m.reply()}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>