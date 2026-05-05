<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import ImageViewerModal from './ImageViewerModal.svelte';
  import UploadModal from './UploadModal.svelte';
  import type { ShopPhoto } from '$lib/types';
  import { fromPath } from '$lib/utils/scoped';
  import type { User } from '$lib/auth/types';

  interface Props {
    shopId: number;
    photos: ShopPhoto[];
    currentUser?: User | undefined;
    /** Called after a photo is deleted so the parent can refresh */
    onPhotoDeleted?: (photo: ShopPhoto) => void;
    /** Called after a photo is uploaded */
    onPhotoUploaded?: (photo: ShopPhoto) => void;
  }

  let {
    shopId,
    photos = $bindable(),
    currentUser = undefined,
    onPhotoDeleted,
    onPhotoUploaded
  }: Props = $props();

  let viewerOpen = $state(false);
  let viewerIndex = $state(0);
  let uploadOpen = $state(false);

  const openViewer = (index: number) => {
    viewerIndex = index;
    viewerOpen = true;
  };

  const handleDelete = (photo: ShopPhoto) => {
    photos = photos.filter((p) => p.id !== photo.id);
    onPhotoDeleted?.(photo);
  };

  const handleUploadSuccess = (result: { photoId: string; url: string }) => {
    const newPhoto: ShopPhoto = {
      id: result.photoId,
      shopId,
      shopName: '',
      url: result.url,
      uploadedBy: currentUser?.id ?? null,
      uploader: currentUser,
      uploadedAt: new Date()
    };
    photos = [newPhoto, ...photos];
    uploadOpen = false;
    onPhotoUploaded?.(newPhoto);
  };
</script>

<div class="space-y-3">
  <!-- Section header -->
  <div class="flex items-center justify-between gap-2">
    <h3 class="text-base font-semibold">{m.shop_photos()}</h3>
    <div class="flex items-center gap-2">
      {#if currentUser}
        <button class="btn btn-ghost btn-sm gap-1" onclick={() => (uploadOpen = true)}>
          <i class="fa-solid fa-upload text-xs"></i>
          {m.shop_photos_upload()}
        </button>
      {/if}
      {#if photos.length > 0}
        <a
          href={resolve('/(main)/shops/[id]/photos', { id: String(shopId) })}
          class="btn btn-ghost btn-sm gap-1"
        >
          <i class="fa-solid fa-images text-xs"></i>
          {m.shop_photos_view_all()}
        </a>
      {/if}
    </div>
  </div>

  {#if photos.length === 0}
    <div class="border-base-300 rounded-xl border p-6 text-center">
      <i class="fa-solid fa-camera text-base-content/30 mb-2 text-2xl"></i>
      <p class="text-base-content/60 text-sm">{m.shop_photos_empty()}</p>
      {#if currentUser}
        <p class="text-base-content/40 mt-1 text-xs">{m.shop_photos_empty_hint()}</p>
      {/if}
    </div>
  {:else}
    <!-- Horizontal scroll carousel -->
    <div class="scrollbar-thin scrollbar-thumb-base-300 -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
      {#each photos as photo, i (photo.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="relative h-28 w-28 shrink-0 cursor-pointer overflow-hidden rounded-xl shadow"
          onclick={() => openViewer(i)}
        >
          <img
            src={photo.url}
            alt={photo.shopName}
            class="h-full w-full object-cover transition-transform duration-200 hover:scale-105"
            loading="lazy"
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

<ImageViewerModal
  bind:isOpen={viewerOpen}
  {photos}
  initialIndex={viewerIndex}
  {currentUser}
  onDelete={handleDelete}
/>

<UploadModal
  bind:isOpen={uploadOpen}
  uploadUrl={fromPath(`/api/shops/${shopId}/photos`)}
  onSuccess={handleUploadSuccess}
/>
