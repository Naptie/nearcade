<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { onDestroy } from 'svelte';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import { orpc } from '$lib/api/client';
  import { discardDraftImages } from '$lib/api/draft-images';
  import { isApiError } from '$lib/utils/api-error';
  import { buildImageUploadUrl } from '$lib/utils/image';
  import { toastError } from '$lib/notifications/toast.svelte';
  import type { User } from '$lib/auth/types';
  import type { ImageAsset } from '$lib/types';

  interface Props {
    shopId: number;
    currentUser: User | undefined;
    /** When set, the composer posts a reply to this comment. */
    parentCommentId?: string;
    placeholder?: string;
    submitLabel?: string;
    /** Reply mode: renders a cancel button and clears drafts on dismiss. */
    onCancel?: () => void;
    /** Called after a successful post so the parent can refresh comments. */
    onSubmitted?: () => void;
  }

  let {
    shopId,
    currentUser,
    parentCommentId,
    placeholder = m.comment_placeholder(),
    submitLabel = m.post_comment(),
    onCancel,
    onSubmitted
  }: Props = $props();

  let content = $state('');
  let imageIds = $state<string[]>([]);
  let attachments = $state<ImageAsset[]>([]);
  let isSubmitting = $state(false);

  // Images left in a discarded draft are orphaned server-side; remove them.
  // A successful submit clears `imageIds` first, because those images now
  // belong to the posted comment.
  onDestroy(() => {
    if (imageIds.length > 0) void discardDraftImages(imageIds);
  });

  const handleSubmit = async () => {
    if (!currentUser || isSubmitting || (!content.trim() && imageIds.length === 0)) return;

    isSubmitting = true;

    try {
      await orpc.shops.createComment({
        id: shopId,
        content: content.trim(),
        images: imageIds,
        ...(parentCommentId ? { parentCommentId } : {})
      });

      content = '';
      imageIds = [];
      attachments = [];
      onSubmitted?.();
    } catch (error) {
      toastError(isApiError(error) ? error.message : m.network_error_try_again());
    } finally {
      isSubmitting = false;
    }
  };
</script>

<MarkdownEditor
  bind:value={content}
  bind:attachments
  bind:imageIds
  {placeholder}
  disabled={isSubmitting}
  minHeight="min-h-[100px]"
  {currentUser}
  imageUploadUrl={buildImageUploadUrl({ draftKind: 'shop-comment', shopId })}
/>

<div class="mt-3 flex items-center justify-end">
  <div class="flex gap-2">
    {#if onCancel}
      <button class="btn btn-ghost btn-sm" onclick={onCancel} disabled={isSubmitting}>
        {m.cancel()}
      </button>
    {/if}
    <button
      class="btn btn-primary btn-sm"
      onclick={handleSubmit}
      disabled={isSubmitting || (!content.trim() && imageIds.length === 0)}
    >
      {#if isSubmitting}
        <span class="loading loading-spinner loading-sm"></span>
      {:else}
        <i class="fa-solid fa-paper-plane"></i>
      {/if}
      {submitLabel}
    </button>
  </div>
</div>
