<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { onMount, onDestroy } from 'svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { fromPath } from '$lib/utils/scoped';
  import type { ShopPhoto } from '$lib/types';
  import type { User } from '$lib/auth/types';
  import { getDisplayName } from '$lib/utils';

  interface Props {
    photos: ShopPhoto[];
    initialIndex?: number;
    isOpen: boolean;
    currentUser?: User | undefined;
    onClose?: () => void;
    onDelete?: (photo: ShopPhoto) => void;
  }

  let {
    photos,
    initialIndex = 0,
    isOpen = $bindable(),
    currentUser = undefined,
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

  let currentPhoto = $derived(photos[currentIndex] ?? null);
  let canDeleteDirectly = $derived(
    !!currentPhoto && (isAdmin || currentPhoto.uploadedBy === currentUser?.id)
  );
  let canRequestDeletion = $derived(!!currentPhoto && !!currentUser?.id && !canDeleteDirectly);

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
    if (!confirm(m.delete() + '?')) return;
    isDeleting = true;
    try {
      const res = await fetch(
        fromPath(`/api/shops/${currentPhoto.shopId}/photos/${currentPhoto.id}`),
        { method: 'DELETE' }
      );
      if (res.ok) {
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
    isSubmittingDeleteRequest = true;
    deleteRequestError = '';
    try {
      const res = await fetch(fromPath(`/api/shops/${currentPhoto.shopId}/delete-request`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, photoId: currentPhoto.id })
      });
      if (res.ok) {
        deleteRequestSuccess = true;
        deleteRequestReason = '';
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

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

{#if isOpen && currentPhoto}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-1100 flex items-center justify-center bg-black/90"
    transition:fade={{ duration: 180 }}
    onclick={(e) => {
      if (e.target === e.currentTarget && !showDeleteRequestModal) handleClose();
    }}
  >
    <!-- Close button -->
    <button
      class="btn btn-ghost btn-circle absolute top-4 right-4 text-white"
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
              alt={currentPhoto.shopName}
              class="max-h-[75vh] max-w-full rounded-lg object-contain shadow-2xl"
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
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-1110 flex items-center justify-center bg-black/60 p-4"
      transition:fade={{ duration: 150 }}
      onclick={(e) => {
        if (e.target === e.currentTarget) showDeleteRequestModal = false;
      }}
    >
      <div class="bg-base-100 w-full max-w-md rounded-2xl p-6 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-bold">{m.shop_photo_delete_request()}</h3>
          <button
            class="btn btn-ghost btn-circle btn-sm"
            onclick={() => (showDeleteRequestModal = false)}
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
                showDeleteRequestModal = false;
                deleteRequestSuccess = false;
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
          <div class="mt-4 flex gap-2">
            <button class="btn btn-ghost flex-1" onclick={() => (showDeleteRequestModal = false)}>
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
