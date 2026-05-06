<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { tick } from 'svelte';
  import { getDisplayName, pageTitle } from '$lib/utils';
  import type { PageData } from './$types';
  import type { ImageAsset, ShopPhoto } from '$lib/types';
  import ImageViewerModal from '$lib/components/ImageViewerModal.svelte';
  import UploadModal from '$lib/components/UploadModal.svelte';
  import { fromPath } from '$lib/utils/scoped';

  let { data }: { data: PageData } = $props();

  let photos = $derived<ShopPhoto[]>(data.photos);
  let viewerOpen = $state(false);
  let viewerIndex = $state(0);
  let viewerSession = $state(0);
  let uploadOpen = $state(false);

  const openViewer = async (index: number) => {
    viewerIndex = index;
    viewerSession = viewerSession + 1;
    viewerOpen = false;
    await tick();
    viewerOpen = true;
  };

  const handleDelete = (photo: ImageAsset) => {
    photos = photos.filter((p) => p.id !== photo.id);
  };

  const handleUploadSuccess = (result: {
    id: string;
    url: string;
    storageProvider: ShopPhoto['storageProvider'];
    storageKey: string;
    storageObjectId?: string | null;
  }) => {
    const newPhoto: ShopPhoto = {
      id: result.id,
      shopId: data.shop.id,
      url: result.url,
      storageProvider: result.storageProvider,
      storageKey: result.storageKey,
      storageObjectId: result.storageObjectId ?? null,
      uploadedBy: data.user?.id ?? null,
      uploader: data.user,
      uploadedAt: new Date()
    };
    photos = [newPhoto, ...photos];
    uploadOpen = false;
  };
</script>

<svelte:head>
  <title>{pageTitle(m.shop_photos(), data.shop.name)}</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 pt-20 pb-12 sm:px-6 lg:px-8">
  <!-- Breadcrumb / header -->
  <div class="mb-6 flex items-center justify-between gap-4">
    <div class="flex items-center gap-1.5">
      <a href={resolve('/(main)/shops/[id]', { id: String(data.shop.id) })} class="btn btn-ghost">
        <i class="fa-solid fa-arrow-left"></i>
        {data.shop.name}
      </a>
      <span class="text-base-content/40 mr-5">/</span>
      <span class="font-semibold">{m.shop_photos()}</span>
    </div>

    {#if data.user}
      <button class="btn btn-primary btn-soft gap-2" onclick={() => (uploadOpen = true)}>
        <i class="fa-solid fa-upload"></i>
        {m.shop_photos_upload()}
      </button>
    {/if}
  </div>

  {#if photos.length === 0}
    <div class="bg-base-100 border-base-300 rounded-2xl border p-16 text-center shadow-sm">
      <i class="fa-solid fa-camera text-base-content/30 mb-4 text-5xl"></i>
      <p class="text-base-content/60 mb-1">{m.shop_photos_empty()}</p>
      {#if data.user}
        <p class="text-base-content/40 text-sm">{m.shop_photos_empty_hint()}</p>
      {/if}
    </div>
  {:else}
    <!-- Photo grid -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {#each photos as photo, i (photo.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="group relative cursor-pointer overflow-hidden rounded-xl shadow"
          onclick={() => openViewer(i)}
        >
          <img
            src={photo.url}
            alt={m.shop_photos_uploaded_by({
              name: getDisplayName(photo.uploader) ?? m.anonymous_user()
            })}
            class="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-105"
            loading="lazy"
          />
          <!-- Overlay -->
          <div
            class="absolute inset-0 flex flex-col justify-end bg-linear-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          >
            <p class="truncate text-xs text-white/90">
              {getDisplayName(photo.uploader) ?? m.anonymous_user()}
            </p>
            <p class="text-xs text-white/60">
              {new Date(photo.uploadedAt).toLocaleDateString()}
            </p>
          </div>
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
    currentUser={data.user}
    onDelete={handleDelete}
  />
{/key}

<UploadModal
  bind:isOpen={uploadOpen}
  uploadUrl={fromPath(`/api/shops/${data.shop.id}/photos`)}
  confirmLabel={m.shop_photos_upload()}
  onSuccess={handleUploadSuccess}
/>
