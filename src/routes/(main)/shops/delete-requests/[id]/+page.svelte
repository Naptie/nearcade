<script lang="ts">
  import { onMount } from 'svelte';
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { hasBoundPhone } from '$lib/utils';
  import { toastError } from '$lib/notifications/toast.svelte';
  import { phoneRequiredToast } from '$lib/notifications/phone-required';
  import VerifiedContactPrompt from '$lib/components/VerifiedContactPrompt.svelte';
  import { getDisplayName, pageTitle } from '$lib/utils';
  import { buildImageUploadUrl } from '$lib/utils/image';
  import { goto, invalidateAll } from '$app/navigation';
  import Comment from '$lib/components/Comment.svelte';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import PhotoCarousel from '$lib/components/PhotoCarousel.svelte';
  import type { ImageAsset, ShopDeleteRequestVoteType } from '$lib/types';
  import type { PageData } from './$types';
  import { orpc } from '$lib/api/client';
  import { discardDraftImages } from '$lib/api/draft-images';
  import { removeComment, updateComment, voteComment } from '$lib/comments/client';
  import { isApiError } from '$lib/utils/api-error';

  let { data }: { data: PageData } = $props();

  let req = $derived(data.deleteRequest);
  let comments = $derived(data.comments ?? []);
  let voteSummary = $derived(data.voteSummary);
  let hasPhone = $derived(hasBoundPhone(data.user));
  let canParticipate = $derived(
    !!data.user && (hasPhone || data.user.userType === 'site_admin') && req.status === 'pending'
  );
  /** True when the only thing blocking participation is a missing bound phone. */
  let isPhoneOnlyBlock = $derived(
    !!data.user && !hasPhone && data.user.userType !== 'site_admin' && req.status === 'pending'
  );
  let canRetractRequest = $derived(canParticipate && data.user?.id === req.requestedBy);
  let canModerateRequest = $derived(!!data.user && data.user?.userType === 'site_admin');
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

  const resetReplyComposer = (cleanupDrafts = false) => {
    if (cleanupDrafts && replyImageIds.length > 0) {
      void discardDraftImages(replyImageIds);
    }

    replyingTo = null;
    replyContent = '';
    replyImageIds = [];
    replyAttachments = [];
  };

  const handleDeleteRequestVote = async (voteType: ShopDeleteRequestVoteType) => {
    if (isSubmittingVote) return;
    if (!canParticipate) {
      if (isPhoneOnlyBlock) phoneRequiredToast();
      return;
    }

    isSubmittingVote = voteType;
    voteError = '';
    try {
      await orpc.shops.voteDeleteRequest({ id: req.id, voteType });
      invalidateAll();
    } catch (error) {
      voteError = isApiError(error) ? error.message : m.network_error_try_again();
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

    try {
      await orpc.shops.createDeleteRequestComment({
        id: req.id,
        content: newCommentContent.trim(),
        images: newCommentImageIds
      });

      resetNewCommentComposer();
      invalidateAll();
    } catch (error) {
      toastError(isApiError(error) ? error.message : m.network_error_try_again());
    } finally {
      isSubmittingComment = false;
    }
  };

  const handleCommentVote = async (commentId: string, voteType: 'upvote' | 'downvote') => {
    if (!canParticipate) return;

    try {
      await voteComment(commentId, voteType);
    } catch (error) {
      console.error('Error voting on comment:', error);
    }
  };

  const handleCommentReply = (commentId: string) => {
    if (!canParticipate) return;

    if (replyImageIds.length > 0) {
      void discardDraftImages(replyImageIds);
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

    try {
      await orpc.shops.createDeleteRequestComment({
        id: req.id,
        content: replyContent.trim(),
        images: replyImageIds,
        parentCommentId: replyingTo
      });

      resetReplyComposer();
      invalidateAll();
    } catch (error) {
      toastError(isApiError(error) ? error.message : m.network_error_try_again());
    } finally {
      isSubmittingReply = false;
    }
  };

  const handleCommentEdit = async (commentId: string, newContent: string, imageIds: string[]) => {
    if (!canParticipate) return;

    try {
      await updateComment(commentId, newContent, imageIds);
    } catch (error) {
      console.error('Error editing comment:', error);
      throw new Error(
        isApiError(error) ? error.message || 'Failed to edit comment' : 'Failed to edit comment',
        { cause: error }
      );
    }
  };

  const handleCommentDelete = async (commentId: string) => {
    if (!canParticipate) return;

    try {
      await removeComment(commentId);
    } catch (error) {
      console.error('Error deleting comment:', error);
      alert(isApiError(error) ? error.message : m.network_error_try_again());
    }
  };

  const handleProcess = async (action: 'approve' | 'reject') => {
    if (!canModerateRequest || isProcessing) return;
    isProcessing = true;
    processError = '';
    try {
      await orpc.shops.reviewDeleteRequest({
        id: req.id,
        action,
        reviewNote: reviewNote.trim() || null
      });
      reviewNote = '';
      invalidateAll();
    } catch (error) {
      processError = isApiError(error) ? error.message : m.network_error_try_again();
    } finally {
      isProcessing = false;
    }
  };

  const handleRetract = async () => {
    if (!canRetractRequest || isProcessing) return;
    if (!confirm(m.retract_delete_request_confirm())) return;
    isProcessing = true;
    processError = '';
    try {
      await orpc.shops.deleteDeleteRequest({ id: req.id });
      await goto(resolve('/(main)/shops/delete-requests'));
    } catch (error) {
      processError = isApiError(error) ? error.message : m.network_error_try_again();
    } finally {
      isProcessing = false;
    }
  };

  const handleDelete = async () => {
    if (!canModerateRequest || isDeleting) return;
    isDeleting = true;
    processError = '';
    try {
      await orpc.shops.deleteDeleteRequest({ id: req.id });
      await goto(resolve('/(main)/shops/delete-requests'));
    } catch (error) {
      processError = isApiError(error) ? error.message : m.network_error_try_again();
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

  const profileLinkClass =
    'underline decoration-transparent decoration-1 underline-offset-3 transition-colors hover:text-white hover:decoration-white';

  const profileHref = (user?: { id: string; name?: string | null } | null) =>
    user ? resolve('/(main)/users/[id]', { id: user.name ? '@' + user.name : user.id }) : '#';
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
          currentUser={canParticipate ? data.user : undefined}
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
          disabled={(!canParticipate && !isPhoneOnlyBlock) || !!isSubmittingVote}
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
          disabled={(!canParticipate && !isPhoneOnlyBlock) || !!isSubmittingVote}
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

      {#if req.status === 'pending' && !canParticipate && !isPhoneOnlyBlock}
        <VerifiedContactPrompt
          user={data.user}
          loginMessage={m.login_to_vote_and_comment()}
          icon="fa-thumbs-up"
          compact
          class="mt-3"
        />
      {/if}
    </div>

    <!-- Metadata -->
    <div class="mb-6 grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <span class="text-base-content/60">{m.request_by()}</span>
        {#if req.requestedByUser}
          <p class="font-medium">
            <a href={profileHref(req.requestedByUser)} class={profileLinkClass}>
              {getDisplayName(req.requestedByUser)}
            </a>
          </p>
        {:else}
          <p class="font-medium">{req.requestedByName ?? m.unknown_user()}</p>
        {/if}
      </div>
      <div>
        <span class="text-base-content/60">{m.created_at()}</span>
        <p class="font-medium">{new Date(req.createdAt).toLocaleString()}</p>
      </div>
      {#if req.reviewedAt}
        {#if req.reviewNote}
          <div class="sm:row-span-2">
            <span class="text-base-content/60">{m.shop_delete_request_review_note()}</span>
            <p class="font-medium wrap-break-word">{req.reviewNote}</p>
          </div>
        {/if}
        <div>
          <span class="text-base-content/60">{m.reviewer()}</span>
          {#if req.reviewedByUser}
            <p class="font-medium">
              <a href={profileHref(req.reviewedByUser)} class={profileLinkClass}>
                {getDisplayName(req.reviewedByUser)}
              </a>
            </p>
          {:else}
            <p class="font-medium">{m.unknown_user()}</p>
          {/if}
        </div>
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
            disabled={!canRetractRequest || isProcessing}
            title={!canRetractRequest && data.user ? m.phone_binding_required() : undefined}
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
              disabled={!canModerateRequest || isProcessing}
            />
            <div class="flex gap-3">
              <button
                class="btn btn-success flex-1"
                onclick={() => handleProcess('approve')}
                disabled={!canModerateRequest || isProcessing}
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
                disabled={!canModerateRequest || isProcessing}
              >
                {#if isProcessing}
                  <span class="loading loading-spinner loading-xs"></span>
                {:else}
                  <i class="fa-solid fa-xmark"></i>
                {/if}
                {m.admin_reject()}
              </button>
            </div>
            <button
              class="btn btn-ghost w-full"
              onclick={handleDelete}
              disabled={!canModerateRequest || isDeleting}
            >
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
        <button
          class="btn btn-ghost"
          onclick={handleDelete}
          disabled={!canModerateRequest || isDeleting}
        >
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
        <MarkdownEditor
          bind:value={newCommentContent}
          bind:attachments={newCommentAttachments}
          bind:imageIds={newCommentImageIds}
          placeholder={m.comment_placeholder()}
          disabled={isSubmittingComment}
          minHeight="min-h-[100px]"
          currentUser={canParticipate ? data.user : undefined}
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
    {:else if req.status !== 'pending'}
      <div class="bg-base-200 text-base-content/60 mb-6 rounded-xl p-4 text-sm">
        <i class="fa-solid fa-lock mr-2"></i>
        {m.delete_request_discussion_closed()}
      </div>
    {:else}
      <VerifiedContactPrompt
        user={data.user}
        loginMessage={m.login_to_vote_and_comment()}
        icon="fa-comment"
        compact
        class="mb-6"
      />
    {/if}

    {#if comments.length > 0}
      <div class="space-y-1">
        {#each comments.filter((comment) => !comment.parentCommentId) as comment (comment.id)}
          <div>
            <Comment
              {comment}
              currentUserId={canParticipate ? data.user?.id : undefined}
              currentUser={canParticipate ? data.user : undefined}
              canReply={canParticipate}
              canEdit={canModerateRequest}
              onVote={canParticipate ? handleCommentVote : undefined}
              onReply={canParticipate ? handleCommentReply : undefined}
              onEdit={handleCommentEdit}
              onDelete={handleCommentDelete}
              isPostRendered={isCommentsRendered}
              depth={0}
              deleteRequestVoteType={comment.authorDeleteRequestVote?.voteType ?? null}
            />

            {#if replyingTo === comment.id && canParticipate}
              <div class="bg-base-200 mt-2 ml-8 rounded-xl p-4">
                <MarkdownEditor
                  bind:value={replyContent}
                  bind:attachments={replyAttachments}
                  bind:imageIds={replyImageIds}
                  placeholder={m.reply_to_comment()}
                  disabled={isSubmittingReply}
                  minHeight="min-h-[100px]"
                  currentUser={canParticipate ? data.user : undefined}
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
                currentUserId={canParticipate ? data.user?.id : undefined}
                currentUser={canParticipate ? data.user : undefined}
                canReply={canParticipate}
                canEdit={canModerateRequest}
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
        {:else if req.status !== 'pending'}
          <p class="text-base-content/60">{m.delete_request_discussion_closed()}</p>
        {:else}
          <p class="text-base-content/60">{m.login_to_vote_and_comment()}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
