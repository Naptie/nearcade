<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { tick } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import ImageViewerModal from './ImageViewerModal.svelte';
  import UploadModal from './UploadModal.svelte';
  import type { ImageAsset } from '$lib/types';
  import { fromPath } from '$lib/utils/scoped';
  import type { User } from '$lib/auth/types';
  import { getDisplayName } from '$lib/utils';

  interface Props {
    shopId?: number;
    photos: ImageAsset[];
    currentUser?: User | undefined;
    title?: string;
    titleClass?: string;
    uploadUrl?: string;
    uploadLabel?: string;
    emptyMessage?: string;
    emptyHint?: string;
    showEmptyState?: boolean;
    viewAllHref?: string;
    viewAllLabel?: string;
    allowDeleteRequest?: boolean;
    onDeletePhoto?: (photo: ImageAsset) => Promise<boolean> | boolean;
    getDeleteUrl?: (photo: ImageAsset) => string;
    getDeleteRequestUrl?: (photo: ImageAsset) => string | null;
    getDeleteRequestBody?: (photo: ImageAsset, reason: string) => unknown;
    /** Called after a photo is deleted so the parent can refresh */
    onPhotoDeleted?: (photo: ImageAsset) => void;
    /** Called after a photo is uploaded */
    onPhotoUploaded?: (photo: ImageAsset) => void;
    showUploadButton?: boolean;
    isUploadOpen?: boolean;
  }

  let {
    shopId,
    photos = $bindable(),
    currentUser = undefined,
    title = m.shop_photos(),
    titleClass = 'text-base font-semibold',
    uploadUrl,
    uploadLabel = m.shop_photos_upload(),
    emptyMessage = m.shop_photos_empty(),
    emptyHint = m.shop_photos_empty_hint(),
    showEmptyState = true,
    viewAllHref,
    viewAllLabel = m.shop_photos_view_all(),
    allowDeleteRequest = shopId !== undefined,
    onDeletePhoto,
    getDeleteUrl,
    getDeleteRequestUrl,
    getDeleteRequestBody,
    onPhotoDeleted,
    onPhotoUploaded,
    showUploadButton = true,
    isUploadOpen = $bindable(false)
  }: Props = $props();

  let resolvedUploadUrl = $derived(
    uploadUrl ?? (shopId !== undefined ? fromPath(`/api/shops/${shopId}/photos`) : undefined)
  );
  let resolvedViewAllHref = $derived(
    viewAllHref ??
      (shopId !== undefined
        ? resolve('/(main)/shops/[id]/photos', { id: String(shopId) })
        : undefined)
  );
  let showHeader = $derived(
    !!title || (!!currentUser && !!resolvedUploadUrl) || !!resolvedViewAllHref
  );

  let viewerOpen = $state(false);
  let viewerIndex = $state(0);
  let viewerSession = $state(0);

  const openViewer = async (index: number) => {
    viewerIndex = index;
    viewerSession = viewerSession + 1;
    viewerOpen = false;
    await tick();
    viewerOpen = true;
  };

  const handleDelete = (photo: ImageAsset) => {
    photos = photos.filter((p) => p.id !== photo.id);
    onPhotoDeleted?.(photo);
  };

  const handleUploadSuccess = (result: {
    id: string;
    url: string;
    storageProvider: ImageAsset['storageProvider'];
    storageKey: string;
    storageObjectId?: string | null;
  }) => {
    const newPhoto: ImageAsset = {
      id: result.id,
      ...(shopId !== undefined ? { shopId } : {}),
      url: result.url,
      storageProvider: result.storageProvider,
      storageKey: result.storageKey,
      storageObjectId: result.storageObjectId ?? null,
      uploadedBy: currentUser?.id ?? null,
      uploader: currentUser,
      uploadedAt: new Date()
    };
    photos = [newPhoto, ...photos];
    isUploadOpen = false;
    onPhotoUploaded?.(newPhoto);
  };
</script>

<div class="space-y-3">
  <!-- Section header -->
  {#if showHeader}
    <div class="flex items-center justify-between gap-2">
      {#if title}
        <h3 class={titleClass}>{title}</h3>
      {:else}
        <div></div>
      {/if}
      <div class="flex items-center gap-2">
        {#if currentUser && resolvedUploadUrl && showUploadButton}
          <button class="btn btn-ghost btn-sm gap-1" onclick={() => (isUploadOpen = true)}>
            <i class="fa-solid fa-upload text-xs"></i>
            {uploadLabel}
          </button>
        {/if}
        {#if photos.length > 0 && resolvedViewAllHref}
          <a href={resolvedViewAllHref} class="btn btn-ghost btn-sm gap-1">
            <i class="fa-solid fa-images text-xs"></i>
            {viewAllLabel}
          </a>
        {/if}
      </div>
    </div>
  {/if}

  {#if photos.length === 0 && showEmptyState}
    <div class="border-base-300 rounded-xl border p-6 text-center">
      <i class="fa-solid fa-camera text-base-content/30 mb-2 text-2xl"></i>
      <p class="text-base-content/60 text-sm">{emptyMessage}</p>
      {#if currentUser}
        <p class="text-base-content/40 mt-1 text-xs">{emptyHint}</p>
      {/if}
    </div>
  {:else if photos.length > 0}
    <!-- Horizontal scroll carousel -->
    <div class="scrollbar-thin scrollbar-thumb-base-300 -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
      {#each photos as photo, i (photo.id)}
        <div
          animate:flip={{ duration: 250 }}
          in:fly={{ x: -32, duration: 250, delay: 50 }}
          out:fade={{ duration: 180 }}
          class="relative h-28 w-28 shrink-0 cursor-pointer overflow-hidden rounded-xl shadow"
          role="button"
          tabindex="0"
          onclick={() => openViewer(i)}
          onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && openViewer(i)}
          aria-label={m.shop_photos_uploaded_by({
            name: getDisplayName(photo.uploader) ?? m.anonymous_user()
          })}
        >
          <img
            src={photo.url}
            alt={m.shop_photos_uploaded_by({
              name: getDisplayName(photo.uploader) ?? m.anonymous_user()
            })}
            class="h-full w-full object-cover transition-transform duration-200 hover:scale-105"
            loading="lazy"
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

{#key viewerSession}
  <ImageViewerModal
    bind:isOpen={viewerOpen}
    {photos}
    initialIndex={viewerIndex}
    {currentUser}
    {allowDeleteRequest}
    deletePhoto={onDeletePhoto}
    {getDeleteUrl}
    {getDeleteRequestUrl}
    {getDeleteRequestBody}
    onDelete={handleDelete}
  />
{/key}

{#if resolvedUploadUrl}
  <UploadModal
    bind:isOpen={isUploadOpen}
    uploadUrl={resolvedUploadUrl}
    confirmLabel={uploadLabel}
    onSuccess={handleUploadSuccess}
  />
{/if}
