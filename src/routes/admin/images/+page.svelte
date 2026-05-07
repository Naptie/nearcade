<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import type { ImageAsset } from '$lib/types';
  import type { PageData } from './$types';
  import { pageTitle, getDisplayName } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import ImageViewerModal from '$lib/components/ImageViewerModal.svelte';

  let { data }: { data: PageData } = $props();

  let deletedImageIds = $state<string[]>([]);
  let images = $derived(data.images.filter((image) => !deletedImageIds.includes(image.id)));
  let totalCount = $derived(Math.max(0, data.totalCount - deletedImageIds.length));
  let viewerOpen = $state(false);
  let viewerIndex = $state(0);

  const openViewer = (index: number) => {
    viewerIndex = index;
    viewerOpen = true;
  };

  const handleDeleteRequest = async (image: ImageAsset) => {
    const response = await fetch(fromPath(`/api/images/${image.id}`), { method: 'DELETE' });
    return response.ok;
  };

  const handleDelete = (image: ImageAsset) => {
    if (!deletedImageIds.includes(image.id)) {
      deletedImageIds = [...deletedImageIds, image.id];
    }
  };

  const getOwnerLabel = (image: ImageAsset) => {
    if (image.shopId) {
      return m.admin_image_usage_shop({ id: image.shopId });
    }
    if (image.postId) {
      return m.admin_image_usage_post({ id: image.postId });
    }
    if (image.commentId) {
      return m.admin_image_usage_comment({ id: image.commentId });
    }
    if (image.deleteRequestId) {
      return m.admin_image_usage_delete_request({ id: image.deleteRequestId });
    }
    return m.admin_image_usage_unassigned();
  };
</script>

<svelte:head>
  <title>{pageTitle(m.admin_images(), m.admin_panel())}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
    <div class="not-sm:text-center">
      <h1 class="text-base-content text-3xl font-bold">{m.admin_images()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_images_description()}</p>
    </div>

    <div class="stats shadow">
      <div class="stat px-4 py-2">
        <div class="stat-title text-xs">{m.total()}</div>
        <div class="stat-value text-primary text-xl">{totalCount}</div>
      </div>
    </div>
  </div>

  <div class="bg-base-100 border-base-300 rounded-lg border p-4 shadow-sm">
    <form method="GET" class="flex flex-col gap-3 sm:flex-row">
      <div class="form-control flex-1">
        <label class="label" for="search">
          <span class="label-text font-medium">{m.search()}</span>
        </label>
        <input
          id="search"
          name="search"
          type="text"
          class="input input-bordered w-full"
          value={data.search}
          placeholder={m.admin_images_search_placeholder()}
        />
      </div>
      <div class="flex items-end">
        <button type="submit" class="btn btn-primary w-full sm:w-auto">
          <i class="fa-solid fa-magnifying-glass"></i>
          {m.search()}
        </button>
      </div>
    </form>
  </div>

  <div class="bg-base-100 border-base-300 rounded-lg border shadow-sm">
    {#if images.length > 0}
      <div class="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
        {#each images as image, index (image.id)}
          <div class="border-base-300 overflow-hidden rounded-xl border">
            <button
              type="button"
              class="bg-base-200 block h-52 w-full overflow-hidden"
              onclick={() => openViewer(index)}
            >
              <img
                src={image.url}
                alt={image.id}
                class="h-full w-full object-cover"
                loading="lazy"
              />
            </button>

            <div class="space-y-3 p-4">
              <div>
                <div class="text-base-content/50 mb-1 text-xs font-medium">
                  {m.admin_image_id()}
                </div>
                <code class="block text-xs break-all">{image.id}</code>
              </div>

              <div>
                <div class="text-base-content/50 mb-1 text-xs font-medium">
                  {m.admin_image_owner()}
                </div>
                <div class="text-sm">{getOwnerLabel(image)}</div>
              </div>

              <div>
                <div class="text-base-content/50 mb-1 text-xs font-medium">
                  {m.admin_image_storage_key()}
                </div>
                <code class="block text-xs break-all">{image.storageKey}</code>
              </div>

              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div class="text-base-content/50 mb-1 text-xs font-medium">
                    {m.admin_image_uploaded_by()}
                  </div>
                  <div class="truncate text-sm">
                    {getDisplayName(image.uploader) ?? image.uploadedBy ?? m.anonymous_user()}
                  </div>
                </div>

                <div>
                  <div class="text-base-content/50 mb-1 text-xs font-medium">
                    {m.admin_image_uploaded_at()}
                  </div>
                  <div class="text-sm">{new Date(image.uploadedAt).toLocaleString()}</div>
                </div>
              </div>

              <div class="flex justify-end gap-2">
                <button
                  type="button"
                  class="btn btn-soft btn-sm"
                  onclick={() => openViewer(index)}
                  title={m.admin_image_preview()}
                >
                  <i class="fa-solid fa-eye"></i>
                </button>
                <button
                  type="button"
                  class="btn btn-error btn-soft btn-sm"
                  onclick={async () => {
                    if (!confirm(m.delete_image_confirm())) return;
                    if (!(await handleDeleteRequest(image))) return;
                    handleDelete(image);
                  }}
                  title={m.delete()}
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>

      <div class="border-base-300 border-t p-4">
        <div class="flex justify-center gap-2">
          {#if data.currentPage > 1}
            <a
              href={`?page=${data.currentPage - 1}${data.search ? `&search=${encodeURIComponent(data.search)}` : ''}`}
              class="btn btn-soft"
            >
              {m.previous_page()}
            </a>
          {/if}

          <span class="btn btn-disabled btn-soft">{m.page({ page: data.currentPage })}</span>

          {#if data.hasMore}
            <a
              href={`?page=${data.currentPage + 1}${data.search ? `&search=${encodeURIComponent(data.search)}` : ''}`}
              class="btn btn-soft"
            >
              {m.next_page()}
            </a>
          {/if}
        </div>
      </div>
    {:else}
      <div class="py-12 text-center">
        <i class="fa-solid fa-images text-base-content/40 mb-4 text-4xl"></i>
        <h3 class="text-base-content mb-2 text-lg font-semibold">{m.admin_no_images_found()}</h3>
        <p class="text-base-content/60">
          {data.search ? m.admin_no_images_found_search() : m.admin_no_images_found_empty()}
        </p>
      </div>
    {/if}
  </div>
</div>

<ImageViewerModal
  bind:isOpen={viewerOpen}
  photos={images}
  initialIndex={viewerIndex}
  currentUser={data.user}
  allowDeleteRequest={false}
  deletePhoto={handleDeleteRequest}
  onDelete={handleDelete}
/>
