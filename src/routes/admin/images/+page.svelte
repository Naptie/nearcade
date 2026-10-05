<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import type { ImageAsset } from '$lib/types';
  import type { PageData } from './$types';
  import { getDisplayName } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import ImageViewerModal from '$lib/components/ImageViewerModal.svelte';
  import AdminPage from '$lib/components/admin/AdminPage.svelte';
  import AdminStats from '$lib/components/admin/AdminStats.svelte';
  import AdminToolbar from '$lib/components/admin/AdminToolbar.svelte';
  import AdminPanel from '$lib/components/admin/AdminPanel.svelte';
  import AdminPagination from '$lib/components/admin/AdminPagination.svelte';
  import AdminEmptyState from '$lib/components/admin/AdminEmptyState.svelte';
  import AdminRowActions from '$lib/components/admin/AdminRowActions.svelte';

  let { data }: { data: PageData } = $props();

  let deletedImageIds = $state<string[]>([]);
  let images = $derived(data.images.filter((image) => !deletedImageIds.includes(image.id)));
  // Client-side deletions shrink the count, so the toolbar summary and the
  // pagination window stay in sync with the rows actually on screen.
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

<AdminPage title={m.admin_images()} description={m.admin_images_description()}>
  {#snippet actions()}
    <AdminStats stats={[{ label: m.total(), value: totalCount }]} />
  {/snippet}

  <AdminToolbar placeholder={m.admin_images_search_placeholder()} total={totalCount} />

  <AdminPanel>
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

              <AdminRowActions>
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
              </AdminRowActions>
            </div>
          </div>
        {/each}
      </div>

      <AdminPagination
        currentPage={data.currentPage}
        hasMore={data.hasMore}
        total={totalCount}
        pageSize={data.pageSize}
      />
    {:else}
      <AdminEmptyState
        icon="fa-images"
        title={m.admin_no_images_found()}
        description={data.search
          ? m.admin_no_images_found_search()
          : m.admin_no_images_found_empty()}
      />
    {/if}
  </AdminPanel>
</AdminPage>

<ImageViewerModal
  bind:isOpen={viewerOpen}
  photos={images}
  initialIndex={viewerIndex}
  currentUser={data.user}
  allowDeleteRequest={false}
  deletePhoto={handleDeleteRequest}
  onDelete={handleDelete}
/>
