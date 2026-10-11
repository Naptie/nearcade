<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { onDestroy } from 'svelte';
  import PhotoCarousel from '$lib/components/PhotoCarousel.svelte';
  import { fromPath } from '$lib/utils/scoped';
  import { buildImageUploadUrl } from '$lib/utils/image';
  import type { User } from '$lib/auth/types';
  import type { ImageAsset } from '$lib/types';

  interface Props {
    shopId: number;
    user: User | undefined;
    /** Opens/closes the modal; bind from the parent. */
    open: boolean;
    /** Called after a successful submission so the parent can refresh. */
    onSubmitted?: () => void;
  }

  let { shopId, user, open = $bindable(false), onSubmitted }: Props = $props();

  let reason = $state('');
  let imageIds = $state<string[]>([]);
  let attachments = $state<ImageAsset[]>([]);
  let isSubmitting = $state(false);
  let error = $state('');
  let success = $state('');

  const cleanupDraftImages = async (ids: string[]) => {
    await Promise.all(
      ids.map(async (imageId) => {
        try {
          await fetch(fromPath(`/api/images/${imageId}`), { method: 'DELETE' });
        } catch (err) {
          console.error('Failed to delete draft image:', err);
        }
      })
    );
  };

  const reset = (cleanupDrafts = false) => {
    if (cleanupDrafts && imageIds.length > 0) {
      void cleanupDraftImages(imageIds);
    }
    open = false;
    reason = '';
    error = '';
    imageIds = [];
    attachments = [];
  };

  // Leftover drafts on navigation would otherwise be orphaned server-side.
  onDestroy(() => {
    if (imageIds.length > 0) void cleanupDraftImages(imageIds);
  });

  const handleSubmit = async () => {
    if (!reason.trim() || isSubmitting) return;
    isSubmitting = true;
    error = '';
    try {
      const response = await fetch(fromPath(`/api/shops/${shopId}/delete-request`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), images: imageIds })
      });
      if (response.ok) {
        success = m.shop_delete_request_submitted();
        reason = '';
        imageIds = [];
        attachments = [];
        open = false;
        onSubmitted?.();
      } else {
        const err = (await response.json()) as { message?: string };
        error = err.message || m.error_occurred();
      }
    } catch {
      error = m.network_error_try_again();
    } finally {
      isSubmitting = false;
    }
  };
</script>

{#if open}
  <div class="modal modal-open">
    <div class="modal-box">
      <h3 class="mb-4 text-lg font-bold">
        <i class="fa-solid fa-trash-can text-warning mr-2"></i>
        {m.request_delete_shop()}
      </h3>

      {#if error}
        <div class="alert alert-error alert-soft mb-4">
          <i class="fa-solid fa-exclamation-triangle"></i>
          <span>{error}</span>
        </div>
      {/if}

      <div class="form-control mb-4">
        <label class="label" for="delete-request-reason">
          <span class="label-text">{m.shop_delete_request_reason()}</span>
        </label>
        <textarea
          id="delete-request-reason"
          class="textarea textarea-bordered w-full rounded-xl"
          rows="4"
          placeholder={m.shop_delete_request_reason_placeholder()}
          bind:value={reason}
          disabled={isSubmitting}
        ></textarea>
      </div>

      <PhotoCarousel
        bind:photos={attachments}
        currentUser={user}
        title={m.evidence_images()}
        titleClass="label-text text-current/60"
        uploadLabel={m.upload_image()}
        uploadUrl={buildImageUploadUrl({
          draftKind: 'shop-delete-request',
          shopId
        })}
        allowDeleteRequest={false}
        showEmptyState={attachments.length > 0}
        onPhotoDeleted={(photo) => {
          imageIds = imageIds.filter((imageId) => imageId !== photo.id);
        }}
      />

      <div class="modal-action">
        <button class="btn btn-ghost" onclick={() => reset(true)} disabled={isSubmitting}>
          {m.cancel()}
        </button>
        <button
          class="btn btn-warning w-fit"
          onclick={handleSubmit}
          disabled={isSubmitting || !reason.trim()}
        >
          {#if isSubmitting}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            <i class="fa-solid fa-paper-plane"></i>
          {/if}
          <span class="sm:hidden">{m.submit()}</span>
          <span class="not-sm:hidden">{m.submit_delete_request()}</span>
        </button>
      </div>
    </div>
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      onclick={() => reset(true)}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          reset(true);
        }
      }}
    ></div>
  </div>
{/if}

<!-- Delete Request Success Toast -->
{#if success}
  <div class="toast toast-end toast-bottom z-50">
    <div class="alert alert-success">
      <i class="fa-solid fa-circle-check"></i>
      <span>{success}</span>
      <button class="btn btn-ghost btn-xs" onclick={() => (success = '')} aria-label={m.close()}>
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  </div>
{/if}
