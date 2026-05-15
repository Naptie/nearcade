<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import type { User } from '$lib/auth/types';
  import type { ImageAsset } from '$lib/types';
  import { fromPath } from '$lib/utils/scoped';
  import { buildPostImageMarkdown, stripPostImageMarkdownByIds } from '$lib/utils/image';
  import { render } from '$lib/utils/markdown';
  import PhotoCarousel from './PhotoCarousel.svelte';

  interface Props {
    value: string;
    placeholder?: string;
    disabled?: boolean;
    onKeyDown?: (event: KeyboardEvent) => void;
    minHeight?: string;
    currentUser?: User | undefined;
    imageUploadUrl?: string;
    attachmentTitle?: string;
    attachmentUploadLabel?: string;
    attachments?: ImageAsset[];
    imageIds?: string[];
    persistedImageIds?: string[];
    appendUploadedImagesToMarkdown?: boolean;
    uploadedImageAltText?: string;
  }

  let {
    value = $bindable(''),
    placeholder = m.post_content_placeholder(),
    disabled = false,
    onKeyDown,
    minHeight = 'min-h-32',
    currentUser = undefined,
    imageUploadUrl,
    attachmentTitle = '',
    attachmentUploadLabel = m.upload_image(),
    attachments = $bindable([]),
    imageIds = $bindable([]),
    persistedImageIds = [],
    appendUploadedImagesToMarkdown = false,
    uploadedImageAltText = 'image'
  }: Props = $props();

  let preview = $state('');
  let isAttachmentUploadOpen = $state(false);

  $effect(() => {
    if (!value.trim()) {
      preview = '';
    } else {
      render(value).then((html) => {
        preview = html;
      });
    }
  });

  $effect(() => {
    const nextImageIds = attachments.map((attachment) => attachment.id);
    const changed =
      nextImageIds.length !== imageIds.length ||
      nextImageIds.some((imageId, index) => imageId !== imageIds[index]);

    if (changed) {
      imageIds = nextImageIds;
    }
  });

  const handleAttachmentDelete = async (photo: ImageAsset) => {
    if (!persistedImageIds.includes(photo.id)) {
      try {
        const response = await fetch(fromPath(`/api/images/${photo.id}`), { method: 'DELETE' });
        if (!response.ok) {
          return false;
        }
      } catch (error) {
        console.error('Failed to delete draft image:', error);
        return false;
      }
    }

    attachments = attachments.filter((attachment) => attachment.id !== photo.id);
    imageIds = imageIds.filter((imageId) => imageId !== photo.id);

    if (appendUploadedImagesToMarkdown) {
      value = stripPostImageMarkdownByIds(value, [photo.id]);
    }

    return true;
  };

  const handleAttachmentUpload = (photo: ImageAsset) => {
    if (!appendUploadedImagesToMarkdown) {
      return;
    }

    const imageMarkdown = buildPostImageMarkdown(photo.id, photo.url, uploadedImageAltText);
    value = value.trimEnd() ? `${value.trimEnd()}\n\n${imageMarkdown}` : imageMarkdown;
  };
</script>

<!-- Content area -->
<div class="space-y-4">
  <div class="flex {minHeight} relative flex-col sm:flex-row">
    <textarea
      {placeholder}
      class="textarea textarea-bordered h-auto w-auto flex-1 resize-none rounded-2xl not-sm:rounded-b-none sm:rounded-r-none"
      bind:value
      {disabled}
      onkeydown={onKeyDown}
    ></textarea>

    <div
      class="bg-base-200/20 prose prose-sm border-base-content/20 h-auto flex-1 overflow-auto rounded-2xl border px-4 py-2 not-sm:rounded-t-none not-sm:border-t-0 sm:rounded-l-none sm:border-l-0"
    >
      {#if preview}
        {@html preview}
      {:else}
        <p class="text-base-content/60 italic">{m.nothing_to_preview()}</p>
      {/if}
    </div>

    <!-- Markdown hint -->
    <div class="text-base-content/60 absolute -bottom-6 space-x-1 text-xs">
      <button
        class="hover:text-base-content cursor-pointer transition-colors"
        title={attachmentUploadLabel}
        onclick={() => (isAttachmentUploadOpen = true)}
      >
        <i class="fa-solid fa-images"></i>
      </button>
      <i class="fa-brands fa-markdown"></i>
      <span class="not-sm:hidden">{m.markdown_supported()}</span>
    </div>
  </div>

  {#if imageUploadUrl}
    <PhotoCarousel
      bind:photos={attachments}
      title={attachmentTitle}
      uploadLabel={attachmentUploadLabel}
      uploadUrl={imageUploadUrl}
      {currentUser}
      allowDeleteRequest={false}
      showEmptyState={attachments.length > 0}
      onDeletePhoto={handleAttachmentDelete}
      onPhotoUploaded={handleAttachmentUpload}
      bind:isUploadOpen={isAttachmentUploadOpen}
      showUploadButton={false}
    />
  {/if}
</div>
