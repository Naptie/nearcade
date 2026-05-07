<script lang="ts">
  import { portal } from '$lib/actions/portal';
  import { m } from '$lib/paraglide/messages';
  import { fade, fly, scale } from 'svelte/transition';
  import { fromPath } from '$lib/utils/scoped';
  import type { ImageAsset } from '$lib/types';
  import type { User } from '$lib/auth/types';
  import { buildImageUploadUrl } from '$lib/utils/image-upload';
  import { getDisplayName } from '$lib/utils';
  import { browser } from '$app/environment';

  interface Props {
    photos: ImageAsset[];
    initialIndex?: number;
    isOpen: boolean;
    currentUser?: User | undefined;
    allowDeleteRequest?: boolean;
    deletePhoto?: (photo: ImageAsset) => Promise<boolean> | boolean;
    getDeleteUrl?: (photo: ImageAsset) => string;
    getDeleteRequestUrl?: (photo: ImageAsset) => string | null;
    getDeleteRequestBody?: (photo: ImageAsset, reason: string, imageIds: string[]) => unknown;
    onClose?: () => void;
    onDelete?: (photo: ImageAsset) => void;
  }

  let {
    photos,
    initialIndex = 0,
    isOpen = $bindable(),
    currentUser = undefined,
    allowDeleteRequest = false,
    deletePhoto,
    getDeleteUrl,
    getDeleteRequestUrl,
    getDeleteRequestBody,
    onClose,
    onDelete
  }: Props = $props();

  // Track a user-initiated offset from the clicked image while the viewer is open.
  let indexOffset = $state(0);

  let isAdmin = $derived(currentUser?.userType === 'site_admin');

  const wrapIndex = (index: number, length: number) => ((index % length) + length) % length;

  let currentIndex = $derived(
    photos.length === 0 ? 0 : wrapIndex(initialIndex + indexOffset, photos.length)
  );
  let isDeleting = $state(false);
  let navigationDirection = $state<-1 | 1>(1);

  // Photo delete request modal state
  let showDeleteRequestModal = $state(false);
  let deleteRequestReason = $state('');
  let isSubmittingDeleteRequest = $state(false);
  let deleteRequestError = $state('');
  let deleteRequestSuccess = $state(false);
  let deleteRequestImageIds = $state<string[]>([]);
  let deleteRequestAttachments = $state<ImageAsset[]>([]);

  let currentPhoto = $derived(photos[currentIndex] ?? null);
  let currentDeleteRequestUrl = $derived.by(() => {
    if (!currentPhoto) return null;
    return (
      getDeleteRequestUrl?.(currentPhoto) ??
      (currentPhoto.shopId !== undefined
        ? fromPath(`/api/shops/${currentPhoto.shopId}/delete-request`)
        : null)
    );
  });
  let canDeleteDirectly = $derived(
    !!currentPhoto && (isAdmin || currentPhoto.uploadedBy === currentUser?.id)
  );
  let canRequestDeletion = $derived(
    !!currentPhoto &&
      !!currentUser?.id &&
      !canDeleteDirectly &&
      allowDeleteRequest &&
      !!currentDeleteRequestUrl
  );

  const resolveDeleteUrl = (photo: ImageAsset) =>
    getDeleteUrl?.(photo) ??
    (photo.shopId !== undefined
      ? fromPath(`/api/shops/${photo.shopId}/photos/${photo.id}`)
      : fromPath(`/api/images/${photo.id}`));

  const resolveDeleteRequestBody = (photo: ImageAsset, reason: string) =>
    getDeleteRequestBody?.(photo, reason, deleteRequestImageIds) ??
    (photo.shopId !== undefined
      ? { reason, photoId: photo.id, images: deleteRequestImageIds }
      : { reason, images: deleteRequestImageIds });

  const cleanupDeleteRequestDrafts = async () => {
    await Promise.all(
      deleteRequestImageIds.map(async (imageId) => {
        try {
          await fetch(fromPath(`/api/images/${imageId}`), { method: 'DELETE' });
        } catch (error) {
          console.error('Failed to delete draft delete request image:', error);
        }
      })
    );
  };

  const closeDeleteRequestModal = (preserveImages = false) => {
    if (!preserveImages && deleteRequestImageIds.length > 0) {
      void cleanupDeleteRequestDrafts();
    }

    showDeleteRequestModal = false;
    deleteRequestReason = '';
    deleteRequestError = '';
    deleteRequestSuccess = false;
    deleteRequestImageIds = [];
    deleteRequestAttachments = [];
  };

  const handleDeleteRequestImageDelete = async (image: ImageAsset) => {
    try {
      const response = await fetch(fromPath(`/api/images/${image.id}`), { method: 'DELETE' });
      if (!response.ok) {
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to delete draft delete request image:', error);
      return false;
    }
  };

  const prev = () => {
    if (photos.length > 1) {
      navigationDirection = -1;
      indexOffset = indexOffset - 1;
    }
  };

  const next = () => {
    if (photos.length > 1) {
      navigationDirection = 1;
      indexOffset = indexOffset + 1;
    }
  };

  const handleClose = () => {
    isOpen = false;
    onClose?.();
  };

  const handleDelete = async () => {
    if (!currentPhoto || isDeleting) return;
    if (!confirm(m.delete_image_confirm())) return;
    isDeleting = true;
    try {
      const deleted = deletePhoto
        ? await deletePhoto(currentPhoto)
        : await fetch(resolveDeleteUrl(currentPhoto), { method: 'DELETE' }).then((res) => res.ok);

      if (deleted) {
        onDelete?.(currentPhoto);
        if (photos.length <= 1) {
          handleClose();
        } else if (currentIndex >= photos.length - 1) {
          indexOffset = indexOffset - 1;
        }
      }
    } finally {
      isDeleting = false;
    }
  };

  const handleSubmitDeleteRequest = async () => {
    if (!currentPhoto || isSubmittingDeleteRequest) return;
    const reason = deleteRequestReason.trim();
    if (!reason) return;
    if (!currentDeleteRequestUrl) return;
    isSubmittingDeleteRequest = true;
    deleteRequestError = '';
    try {
      const res = await fetch(currentDeleteRequestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resolveDeleteRequestBody(currentPhoto, reason))
      });
      if (res.ok) {
        deleteRequestSuccess = true;
        deleteRequestReason = '';
        deleteRequestImageIds = [];
        deleteRequestAttachments = [];
      } else {
        const data = (await res.json()) as { message?: string };
        deleteRequestError = data.message || m.error_occurred();
      }
    } catch {
      deleteRequestError = m.network_error_try_again();
    } finally {
      isSubmittingDeleteRequest = false;
    }
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (!isOpen) return;
    if (showDeleteRequestModal) return; // Don't navigate when modal is open
    if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'Escape') handleClose();
  };

  $effect(() => {
    if (browser) {
      window.addEventListener('keydown', handleKeydown);
      return () => {
        window.removeEventListener('keydown', handleKeydown);
      };
    }
  });
</script>

{#if isOpen && currentPhoto}
  <div
    use:portal
    class="fixed inset-0 z-1000 flex items-center justify-center bg-black/90"
    transition:fade={{ duration: 180 }}
    onclick={(e) => {
      if (e.target === e.currentTarget && !showDeleteRequestModal) handleClose();
    }}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        if (!showDeleteRequestModal) {
          handleClose();
        }
      }
    }}
    role="button"
    tabindex="0"
  >
    <!-- Close button -->
    <button
      class="btn btn-ghost btn-circle absolute top-14 right-4 text-white"
      onclick={handleClose}
      aria-label={m.close()}
      transition:fade={{ duration: 180 }}
    >
      <i class="fa-solid fa-xmark text-xl"></i>
    </button>

    <!-- Prev button -->
    {#if photos.length > 1}
      <button
        class="btn btn-ghost btn-circle absolute top-1/2 left-4 -translate-y-1/2 text-white"
        onclick={prev}
        aria-label="Previous"
        transition:fade={{ duration: 180 }}
      >
        <i class="fa-solid fa-chevron-left text-xl"></i>
      </button>
    {/if}

    <!-- Main image -->
    <div class="grid w-full max-w-screen-2xl place-items-center overflow-hidden px-14 py-10">
      {#key currentPhoto.id}
        <div
          class="col-start-1 row-start-1 w-full"
          in:scale={{ duration: 220, start: 0.96 }}
          out:scale={{ duration: 180, start: 0.98 }}
        >
          <div
            class="flex max-h-screen w-full flex-col items-center gap-3"
            in:fly={{ x: navigationDirection * 40, duration: 220 }}
            out:fly={{ x: navigationDirection * -40, duration: 180 }}
          >
            <img
              src={currentPhoto.url}
              alt={m.shop_photos_uploaded_by({
                name: getDisplayName(currentPhoto.uploader) ?? m.anonymous_user()
              })}
              class="max-h-[75vh] w-full rounded-lg object-contain shadow-2xl"
            />

            <!-- Photo info bar -->
            <div class="flex w-full items-center justify-between gap-4 text-white">
              <div class="min-w-0 text-sm">
                <p class="truncate text-white/80">
                  {m.shop_photos_uploaded_by({
                    name: getDisplayName(currentPhoto.uploader) ?? m.anonymous_user()
                  })}
                </p>
                <p class="text-xs text-white/50">
                  {new Date(currentPhoto.uploadedAt).toLocaleString()}
                </p>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                {#if photos.length > 1}
                  <span class="text-sm text-white/50">{currentIndex + 1} / {photos.length}</span>
                {/if}
                {#if canDeleteDirectly}
                  <button
                    class="btn btn-error btn-soft btn-sm"
                    onclick={handleDelete}
                    disabled={isDeleting}
                  >
                    {#if isDeleting}
                      <span class="loading loading-spinner loading-xs"></span>
                    {:else}
                      <i class="fa-solid fa-trash-can"></i>
                    {/if}
                    {m.delete()}
                  </button>
                {:else if canRequestDeletion}
                  <button
                    class="btn btn-warning btn-soft btn-sm"
                    onclick={() => {
                      showDeleteRequestModal = true;
                      deleteRequestSuccess = false;
                      deleteRequestError = '';
                      deleteRequestReason = '';
                      deleteRequestImageIds = [];
                      deleteRequestAttachments = [];
                    }}
                  >
                    <i class="fa-solid fa-flag"></i>
                    {m.request_delete_shop()}
                  </button>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/key}
    </div>

    <!-- Next button -->
    {#if photos.length > 1}
      <button
        class="btn btn-ghost btn-circle absolute top-1/2 right-4 -translate-y-1/2 text-white"
        onclick={next}
        aria-label="Next"
        transition:fade={{ duration: 180 }}
      >
        <i class="fa-solid fa-chevron-right text-xl"></i>
      </button>
    {/if}
  </div>

  <!-- Photo delete request modal (shown on top of viewer) -->
  {#if showDeleteRequestModal}
    <div
      use:portal
      class="fixed inset-0 z-1010 flex items-center justify-center bg-black/60 p-4"
      transition:fade={{ duration: 150 }}
      onclick={(e) => {
        if (e.target === e.currentTarget) closeDeleteRequestModal();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          e.preventDefault();
          closeDeleteRequestModal();
        }
      }}
      role="button"
      tabindex="0"
    >
      <div class="bg-base-100 w-full max-w-md rounded-2xl p-6 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-bold">{m.shop_photo_delete_request()}</h3>
          <button
            class="btn btn-ghost btn-circle btn-sm"
            onclick={() => closeDeleteRequestModal()}
            aria-label={m.close()}
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        {#if deleteRequestSuccess}
          <div class="flex flex-col items-center gap-3 py-4 text-center">
            <i class="fa-solid fa-circle-check text-success text-4xl"></i>
            <p class="font-medium">{m.shop_delete_request_submitted()}</p>
            <button
              class="btn btn-primary w-full"
              onclick={() => {
                closeDeleteRequestModal(true);
              }}
            >
              {m.close()}
            </button>
          </div>
        {:else}
          {#if deleteRequestError}
            <div class="alert alert-error alert-soft mb-4 py-2 text-sm">
              <i class="fa-solid fa-triangle-exclamation"></i>
              <span>{deleteRequestError}</span>
            </div>
          {/if}
          <label class="label mb-1" for="photo-delete-reason">
            <span class="label-text">{m.shop_delete_request_reason()}</span>
          </label>
          <textarea
            id="photo-delete-reason"
            class="textarea textarea-bordered w-full rounded-xl"
            rows="3"
            placeholder={m.shop_photo_delete_request_reason_placeholder()}
            bind:value={deleteRequestReason}
          ></textarea>

          {#if currentUser}
            <div class="mt-4 space-y-3">
              {#await import('./PhotoCarousel.svelte') then { default: PhotoCarousel }}
                <PhotoCarousel
                  bind:photos={deleteRequestAttachments}
                  {currentUser}
                  title={m.evidence_images()}
                  titleClass="label-text text-current/60"
                  uploadLabel={m.upload_image()}
                  uploadUrl={buildImageUploadUrl({
                    draftKind: 'shop-delete-request',
                    shopId: currentPhoto?.shopId
                  })}
                  allowDeleteRequest={false}
                  showEmptyState={false}
                  onDeletePhoto={handleDeleteRequestImageDelete}
                  onPhotoDeleted={(photo) => {
                    deleteRequestImageIds = deleteRequestImageIds.filter(
                      (imageId) => imageId !== photo.id
                    );
                  }}
                  onPhotoUploaded={(photo) => {
                    deleteRequestImageIds = [
                      photo.id,
                      ...deleteRequestImageIds.filter((imageId) => imageId !== photo.id)
                    ];
                  }}
                />
              {/await}
            </div>
          {/if}

          <div class="mt-4 flex gap-2">
            <button class="btn btn-ghost flex-1" onclick={() => closeDeleteRequestModal()}>
              {m.cancel()}
            </button>
            <button
              class="btn btn-warning w-fit flex-1"
              onclick={handleSubmitDeleteRequest}
              disabled={!deleteRequestReason.trim() || isSubmittingDeleteRequest}
            >
              {#if isSubmittingDeleteRequest}
                <span class="loading loading-spinner loading-xs"></span>
              {:else}
                <i class="fa-solid fa-paper-plane"></i>
              {/if}
              {m.submit_delete_request()}
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
{/if}
