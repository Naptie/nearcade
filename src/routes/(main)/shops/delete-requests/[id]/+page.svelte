<script lang="ts">
  import { onMount } from 'svelte';
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { pageTitle } from '$lib/utils';
  import { buildImageUploadUrl } from '$lib/utils/image';
  import { goto, invalidateAll } from '$app/navigation';
  import Comment from '$lib/components/Comment.svelte';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import PhotoCarousel from '$lib/components/PhotoCarousel.svelte';
  import type { ImageAsset, ShopDeleteRequestVoteType } from '$lib/types';
  import type { PageData } from './$types';
  import { fromPath } from '$lib/utils/scoped';

  let { data }: { data: PageData } = $props();

  let req = $derived(data.deleteRequest);
  let comments = $derived(data.comments ?? []);
  let voteSummary = $derived(data.voteSummary);
  let canParticipate = $derived(!!data.user && req.status === 'pending');
  let reviewNote = $state('');
  let isProcessing = $state(false);
  let processError = $state('');
  let isDeleting = $state(false);
  let isSubmittingVote = $state<ShopDeleteRequestVoteType | null>(null);
  let voteError = $state('');
  let newCommentContent = $state('');
  let newCommentImageIds = $state<string[]>([]);
  let newCommentAttachments = $state<ImageAsset[]>([]);
  let isSubmittingComment = $state(false);
  let commentError = $state('');
  let replyingTo = $state<string | null>(null);
  let replyContent = $state('');
  let replyImageIds = $state<string[]>([]);
  let replyAttachments = $state<ImageAsset[]>([]);
  let isSubmittingReply = $state(false);
  let isCommentsRendered = $state(false);

  onMount(() => {
    isCommentsRendered = true;
  });

  const resetNewCommentComposer = () => {
    newCommentContent = '';
    newCommentImageIds = [];
    newCommentAttachments = [];
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

  const resetReplyComposer = (cleanupDrafts = false) => {
    if (cleanupDrafts && replyImageIds.length > 0) {
      void cleanupDraftImages(replyImageIds);
    }

    replyingTo = null;
    replyContent = '';
    replyImageIds = [];
    replyAttachments = [];
  };

  const handleDeleteRequestVote = async (voteType: ShopDeleteRequestVoteType) => {
    if (!canParticipate || isSubmittingVote) return;

    isSubmittingVote = voteType;
    voteError = '';
    try {
      const response = await fetch(fromPath(`/api/shops/delete-requests/${req.id}/vote`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voteType })
      });

      if (response.ok) {
        invalidateAll();
      } else {
        const err = (await response.json()) as { message?: string };
        voteError = err.message || m.error_occurred();
      }
    } catch {
      voteError = m.network_error_try_again();
    } finally {
      isSubmittingVote = null;
    }
  };

  const handleCommentSubmit = async () => {
    if (
      !canParticipate ||
      (!newCommentContent.trim() && newCommentImageIds.length === 0) ||
      isSubmittingComment
    )
      return;

    isSubmittingComment = true;
    commentError = '';

    try {
      const response = await fetch(fromPath(`/api/shops/delete-requests/${req.id}/comments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newCommentContent.trim(), images: newCommentImageIds })
      });

      if (response.ok) {
        resetNewCommentComposer();
        invalidateAll();
      } else {
        const errorData = (await response.json()) as { message?: string };
        commentError = errorData.message || m.failed_to_post_comment();
      }
    } catch {
      commentError = m.network_error_try_again();
    } finally {
      isSubmittingComment = false;
    }
  };

  const handleCommentVote = async (commentId: string, voteType: 'upvote' | 'downvote') => {
    if (!canParticipate) return;

    try {
      const response = await fetch(fromPath(`/api/comments/${commentId}/vote`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voteType })
      });

      if (response.ok) {
        invalidateAll();
      }
    } catch (error) {
      console.error('Error voting on comment:', error);
    }
  };

  const handleCommentReply = (commentId: string) => {
    if (replyImageIds.length > 0) {
      void cleanupDraftImages(replyImageIds);
    }

    replyingTo = commentId;
    replyContent = '';
    replyImageIds = [];
    replyAttachments = [];
  };

  const submitReply = async () => {
    if (
      !canParticipate ||
      (!replyContent.trim() && replyImageIds.length === 0) ||
      !replyingTo ||
      isSubmittingReply
    )
      return;

    isSubmittingReply = true;
    commentError = '';

    try {
      const response = await fetch(fromPath(`/api/shops/delete-requests/${req.id}/comments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: replyContent.trim(),
          images: replyImageIds,
          parentCommentId: replyingTo
        })
      });

      if (response.ok) {
        resetReplyComposer();
        invalidateAll();
      } else {
        const errorData = (await response.json()) as { message?: string };
        commentError = errorData.message || m.failed_to_post_comment();
      }
    } catch {
      commentError = m.network_error_try_again();
    } finally {
      isSubmittingReply = false;
    }
  };

  const handleCommentEdit = async (commentId: string, newContent: string, imageIds: string[]) => {
    if (!data.user) return;

    try {
      const response = await fetch(fromPath(`/api/comments/${commentId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent, images: imageIds })
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { message?: string };
        throw new Error(errorData.message || 'Failed to edit comment');
      }

      invalidateAll();
    } catch (error) {
      console.error('Error editing comment:', error);
      throw error;
    }
  };

  const handleCommentDelete = async (commentId: string) => {
    if (!data.user) return;

    try {
      const response = await fetch(fromPath(`/api/comments/${commentId}`), {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { message?: string };
        alert(errorData.message || 'Failed to delete comment');
      } else {
        invalidateAll();
      }
    } catch (error) {
      console.error('Error deleting comment:', error);
      alert(m.network_error_try_again());
    }
  };

  const handleProcess = async (action: 'approve' | 'reject') => {
    if (isProcessing) return;
    isProcessing = true;
    processError = '';
    try {
      const response = await fetch(fromPath(`/api/shops/delete-requests/${req.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewNote: reviewNote.trim() || null })
      });
      if (response.ok) {
        reviewNote = '';
        invalidateAll();
      } else {
        const err = (await response.json()) as { message?: string };
        processError = err.message || m.error_occurred();
      }
    } catch {
      processError = m.network_error_try_again();
    } finally {
      isProcessing = false;
    }
  };

  const handleRetract = async () => {
    if (isProcessing) return;
    if (!confirm(m.retract_delete_request_confirm())) return;
    isProcessing = true;
    processError = '';
    try {
      const response = await fetch(fromPath(`/api/shops/delete-requests/${req.id}`), {
        method: 'DELETE'
      });
      if (response.ok) {
        await goto(resolve('/(main)/shops/delete-requests'));
      } else {
        const err = (await response.json()) as { message?: string };
        processError = err.message || m.error_occurred();
      }
    } catch {
      processError = m.network_error_try_again();
    } finally {
      isProcessing = false;
    }
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    isDeleting = true;
    processError = '';
    try {
      const response = await fetch(fromPath(`/api/shops/delete-requests/${req.id}`), {
        method: 'DELETE'
      });
      if (response.ok) {
        await goto(resolve('/(main)/shops/delete-requests'));
      } else {
        const err = (await response.json()) as { message?: string };
        processError = err.message || m.error_occurred();
      }
    } catch {
      processError = m.network_error_try_again();
    } finally {
      isDeleting = false;
    }
  };

  const statusBadgeClass = $derived(
    req.status === 'pending'
      ? 'badge-warning'
      : req.status === 'approved'
        ? 'badge-success'
        : 'badge-error'
  );
</script>

<svelte:head>
  <title>{pageTitle(req.shopName, m.shop_delete_requests())}</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 pt-20 pb-12 sm:px-6 lg:px-8">
  <!-- Breadcrumb -->
  <div class="mb-6">
    <a href={resolve('/(main)/shops/delete-requests')} class="btn btn-ghost btn-sm">
      <i class="fa-solid fa-arrow-left"></i>
      {m.shop_delete_requests()}
    </a>
  </div>

  <div class="bg-base-100 border-base-300 rounded-2xl border p-6 shadow-sm">
    <!-- Header -->
    <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">
          {req.photoId ? m.shop_photo_delete_request() : m.shop_delete_request()}
        </h1>
        <p class="text-base-content/60 mt-1 font-mono text-sm">{req.id}</p>
      </div>
      <span class="badge {statusBadgeClass} badge-lg">
        {#if req.status === 'pending'}
          {m.shop_delete_request_pending()}
        {:else if req.status === 'approved'}
          {m.shop_delete_request_approved()}
        {:else}
          {m.shop_delete_request_rejected()}
        {/if}
      </span>
    </div>

    <!-- Shop info -->
    <div class="bg-base-200 mb-6 rounded-xl p-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="font-semibold">{req.shopName}</p>
          <p class="text-base-content/60 text-sm">#{req.shopId}</p>
        </div>
        <a
          href={resolve('/(main)/shops/[id]', { id: String(req.shopId) })}
          class="btn btn-ghost btn-sm"
          target="_blank"
          rel="noopener"
        >
          <i class="fa-solid fa-arrow-up-right-from-square"></i>
          {m.view()}
        </a>
      </div>
    </div>

    <!-- Photo preview (for photo delete requests) -->
    {#if req.photoUrl}
      <div class="mb-6">
        <h2 class="mb-2 text-sm font-semibold tracking-wide uppercase opacity-60">
          {m.shop_photos()}
        </h2>
        <img
          src={req.photoUrl}
          alt={req.shopName}
          class="max-h-60 max-w-full rounded-xl object-cover shadow"
        />
      </div>
    {/if}

    <!-- Reason -->
    <div class="mb-6">
      <h2 class="mb-2 text-sm font-semibold tracking-wide uppercase opacity-60">
        {m.shop_delete_request_reason()}
      </h2>
      <p class="bg-base-200 rounded-xl p-4 text-sm">{req.reason}</p>
    </div>

    {#if (req.resolvedImages?.length ?? 0) > 0}
      <div class="mb-6">
        <h2 class="mb-2 text-sm font-semibold tracking-wide uppercase opacity-60">
          {m.evidence_images()}
        </h2>
        <PhotoCarousel
          photos={req.resolvedImages ?? []}
          currentUser={data.user ?? undefined}
          title=""
          allowDeleteRequest={false}
          showEmptyState={false}
          onPhotoDeleted={(photo) => {
            req.images = (req.images ?? []).filter((imageId) => imageId !== photo.id);
            req.resolvedImages = (req.resolvedImages ?? []).filter(
              (image) => image.id !== photo.id
            );
          }}
        />
      </div>
    {/if}

    <!-- Voting -->
    <div class="mb-6">
      <div class="mb-2 flex items-center justify-between gap-3">
        <h2 class="text-sm font-semibold tracking-wide uppercase opacity-60">
          {m.delete_request_vote_section()}
        </h2>
        <span class="text-base-content/60 text-sm">
          {req.status === 'pending' ? m.delete_request_vote_open() : m.delete_request_vote_closed()}
        </span>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <button
          class="btn justify-between {voteSummary.userVote === 'favor'
            ? 'btn-success'
            : 'btn-ghost'}"
          onclick={() => handleDeleteRequestVote('favor')}
          disabled={!canParticipate || !!isSubmittingVote}
        >
          <span class="flex items-center gap-2">
            {#if isSubmittingVote === 'favor'}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              <i class="fa-solid fa-thumbs-up"></i>
            {/if}
            {m.delete_request_vote_favor()}
          </span>
          <span class="badge badge-soft">{voteSummary.favorVotes}</span>
        </button>

        <button
          class="btn justify-between {voteSummary.userVote === 'against'
            ? 'btn-error'
            : 'btn-ghost'}"
          onclick={() => handleDeleteRequestVote('against')}
          disabled={!canParticipate || !!isSubmittingVote}
        >
          <span class="flex items-center gap-2">
            {#if isSubmittingVote === 'against'}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              <i class="fa-solid fa-thumbs-down"></i>
            {/if}
            {m.delete_request_vote_against()}
          </span>
          <span class="badge badge-soft">{voteSummary.againstVotes}</span>
        </button>
      </div>

      {#if voteError}
        <div class="alert alert-error alert-soft mt-3">
          <i class="fa-solid fa-exclamation-triangle"></i>
          <span>{voteError}</span>
        </div>
      {/if}
    </div>

    <!-- Metadata -->
    <div class="mb-6 grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <span class="text-base-content/60">{m.request_by()}</span>
        <p class="font-medium">{req.requestedByName ?? m.anonymous_user()}</p>
      </div>
      <div>
        <span class="text-base-content/60">{m.created_at()}</span>
        <p class="font-medium">{new Date(req.createdAt).toLocaleString()}</p>
      </div>
      {#if req.reviewedAt}
        {#if req.reviewNote}
          <div>
            <span class="text-base-content/60">{m.shop_delete_request_review_note()}</span>
            <p class="font-medium">{req.reviewNote}</p>
          </div>
        {/if}
        <div>
          <span class="text-base-content/60">{m.reviewed_at()}</span>
          <p class="font-medium">{new Date(req.reviewedAt).toLocaleString()}</p>
        </div>
      {/if}
    </div>

    {#if processError}
      <div class="alert alert-error alert-soft mb-4">
        <i class="fa-solid fa-exclamation-triangle"></i>
        <span>{processError}</span>
      </div>
    {/if}

    <!-- Actions -->
    {#if req.status === 'pending'}
      <div class="border-base-300 space-y-3 border-t pt-6">
        <!-- Requester: retract -->
        {#if data.user?.id === req.requestedBy}
          <button
            class="btn btn-warning btn-soft w-full"
            onclick={handleRetract}
            disabled={isProcessing}
          >
            {#if isProcessing}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              <i class="fa-solid fa-rotate-left"></i>
            {/if}
            {m.retract_delete_request()}
          </button>
        {/if}

        <!-- Admin: approve/reject/delete -->
        {#if data.user?.userType === 'site_admin'}
          <div class="space-y-3">
            <input
              type="text"
              class="input input-bordered w-full"
              placeholder={m.shop_delete_request_review_note()}
              bind:value={reviewNote}
              disabled={isProcessing}
            />
            <div class="flex gap-3">
              <button
                class="btn btn-success flex-1"
                onclick={() => handleProcess('approve')}
                disabled={isProcessing}
              >
                {#if isProcessing}
                  <span class="loading loading-spinner loading-xs"></span>
                {:else}
                  <i class="fa-solid fa-check"></i>
                {/if}
                {m.admin_approve()}
              </button>
              <button
                class="btn btn-error flex-1"
                onclick={() => handleProcess('reject')}
                disabled={isProcessing}
              >
                {#if isProcessing}
                  <span class="loading loading-spinner loading-xs"></span>
                {:else}
                  <i class="fa-solid fa-xmark"></i>
                {/if}
                {m.admin_reject()}
              </button>
            </div>
            <button class="btn btn-ghost w-full" onclick={handleDelete} disabled={isDeleting}>
              {#if isDeleting}
                <span class="loading loading-spinner loading-xs"></span>
              {:else}
                <i class="fa-solid fa-trash"></i>
              {/if}
              {m.delete_this_request()}
            </button>
          </div>
        {/if}
      </div>
    {:else if data.user?.userType === 'site_admin'}
      <div class="border-base-300 border-t pt-6">
        <button class="btn btn-ghost" onclick={handleDelete} disabled={isDeleting}>
          {#if isDeleting}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            <i class="fa-solid fa-trash"></i>
          {/if}
          {m.delete_this_request()}
        </button>
      </div>
    {/if}
  </div>

  <div class="bg-base-100 border-base-300 mt-6 rounded-2xl border p-6 shadow-sm">
    <h2 class="mb-6 flex items-center gap-2 text-xl font-semibold">
      <i class="fa-solid fa-comments"></i>
      {m.comments()} ({comments.length})
    </h2>

    {#if canParticipate}
      <div class="bg-base-200 mb-6 rounded-xl p-4">
        {#if commentError}
          <div class="alert alert-error mb-4">
            <i class="fa-solid fa-exclamation-triangle"></i>
            <span>{commentError}</span>
          </div>
        {/if}

        <MarkdownEditor
          bind:value={newCommentContent}
          bind:attachments={newCommentAttachments}
          bind:imageIds={newCommentImageIds}
          placeholder={m.comment_placeholder()}
          disabled={isSubmittingComment}
          minHeight="min-h-[100px]"
          currentUser={data.user}
          imageUploadUrl={buildImageUploadUrl({
            draftKind: 'delete-request-comment',
            deleteRequestId: req.id
          })}
        />

        <div class="mt-3 flex items-end justify-between gap-3">
          <p class="text-base-content/60 text-xs">
            {m.delete_request_comment_stance_hint()}
          </p>
          <button
            class="btn btn-primary btn-sm"
            onclick={handleCommentSubmit}
            disabled={isSubmittingComment ||
              (!newCommentContent.trim() && newCommentImageIds.length === 0)}
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
    {:else if data.user}
      <div class="bg-base-200 text-base-content/60 mb-6 rounded-xl p-4 text-sm">
        <i class="fa-solid fa-lock mr-2"></i>
        {m.delete_request_discussion_closed()}
      </div>
    {:else}
      <div class="bg-base-200 mb-6 flex flex-col items-center gap-2 rounded-xl p-4">
        <i class="fa-solid fa-comment text-base-content/40 text-2xl"></i>
        <button
          class="text-base-content/60 hover:link-accent cursor-pointer text-sm transition-colors"
          onclick={() => {
            window.dispatchEvent(new CustomEvent('nearcade-login'));
          }}
        >
          {m.login_to_comment()}
        </button>
      </div>
    {/if}

    {#if comments.length > 0}
      <div class="space-y-1">
        {#each comments.filter((comment) => !comment.parentCommentId) as comment (comment.id)}
          <div>
            <Comment
              {comment}
              currentUserId={data.user?.id}
              currentUser={data.user}
              canReply={canParticipate}
              canEdit={data.user?.userType === 'site_admin'}
              onVote={canParticipate ? handleCommentVote : undefined}
              onReply={canParticipate ? handleCommentReply : undefined}
              onEdit={handleCommentEdit}
              onDelete={handleCommentDelete}
              isPostRendered={isCommentsRendered}
              depth={0}
              deleteRequestVoteType={comment.authorDeleteRequestVote?.voteType ?? null}
            />

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
                  bind:attachments={replyAttachments}
                  bind:imageIds={replyImageIds}
                  placeholder={m.reply_to_comment()}
                  disabled={isSubmittingReply}
                  minHeight="min-h-[100px]"
                  currentUser={data.user}
                  imageUploadUrl={buildImageUploadUrl({
                    draftKind: 'delete-request-comment',
                    deleteRequestId: req.id
                  })}
                />

                <div class="mt-3 flex items-center justify-end">
                  <div class="flex gap-2">
                    <button
                      class="btn btn-ghost btn-sm"
                      onclick={() => {
                        resetReplyComposer(true);
                      }}
                      disabled={isSubmittingReply}
                    >
                      {m.cancel()}
                    </button>
                    <button
                      class="btn btn-primary btn-sm"
                      onclick={submitReply}
                      disabled={isSubmittingReply ||
                        (!replyContent.trim() && replyImageIds.length === 0)}
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

            {#each comments.filter((reply) => reply.parentCommentId === comment.id) as reply (reply.id)}
              <Comment
                comment={reply}
                currentUserId={data.user?.id}
                currentUser={data.user}
                canReply={canParticipate}
                canEdit={data.user?.userType === 'site_admin'}
                onVote={canParticipate ? handleCommentVote : undefined}
                onReply={canParticipate ? handleCommentReply : undefined}
                onEdit={handleCommentEdit}
                onDelete={handleCommentDelete}
                isPostRendered={isCommentsRendered}
                depth={1}
                deleteRequestVoteType={reply.authorDeleteRequestVote?.voteType ?? null}
              />
            {/each}
          </div>
        {/each}
      </div>
    {:else}
      <div class="bg-base-200 rounded-xl p-8 text-center">
        <i class="fa-solid fa-comments text-base-content/30 mb-4 text-4xl"></i>
        <h3 class="mb-2 text-lg font-medium">{m.no_comments_yet()}</h3>
        {#if canParticipate}
          <p class="text-base-content/60">{m.be_first_to_comment()}</p>
        {:else if data.user}
          <p class="text-base-content/60">{m.delete_request_discussion_closed()}</p>
        {:else}
          <p class="text-base-content/60">{m.login_to_comment()}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
