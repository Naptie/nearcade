<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import type { User } from '$lib/auth/types';
  import { buildImageUploadUrl } from '$lib/utils/image';
  import { getDefaultPostReadability } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import { PostReadability, type ImageAsset } from '$lib/types';
  import { onDestroy } from 'svelte';

  interface Props {
    organizationType: 'university' | 'club';
    organizationId: string;
    organizationName: string;
    organizationReadability: PostReadability;
    canManage: boolean;
    currentUser?: User | undefined;
    cancelHref: string;
    wideMode?: boolean;
    onCreated?: (postId: string) => void;
  }

  let {
    organizationType,
    organizationId,
    organizationName,
    organizationReadability,
    canManage,
    currentUser = undefined,
    cancelHref,
    wideMode = $bindable(false),
    onCreated
  }: Props = $props();

  let title = $state('');
  let content = $state('');
  let imageIds = $state<string[]>([]);
  let attachments = $state<ImageAsset[]>([]);
  let readability = $derived<PostReadability>(getDefaultPostReadability(organizationReadability));
  let isSubmitting = $state(false);
  let error = $state('');
  let publishedImageIds = $state<string[]>([]);

  const readabilityOptions = $derived([
    { value: PostReadability.PUBLIC, label: m.post_readability_public() },
    { value: PostReadability.UNIV_MEMBERS, label: m.post_readability_university_members() },
    ...(organizationType === 'club'
      ? [{ value: PostReadability.CLUB_MEMBERS, label: m.post_readability_club_members() }]
      : [])
  ]);

  const reset = () => {
    title = '';
    content = '';
    imageIds = [];
    attachments = [];
    readability = getDefaultPostReadability(organizationReadability);
    error = '';
    isSubmitting = false;
  };

  const cleanupDraftImages = () => {
    const draftIds = imageIds.filter((imageId) => !publishedImageIds.includes(imageId));
    if (draftIds.length > 0) {
      void Promise.all(
        draftIds.map((imageId) => fetch(fromPath(`/api/images/${imageId}`), { method: 'DELETE' }))
      );
    }
  };

  onDestroy(() => {
    cleanupDraftImages();
  });

  const handleSubmit = async () => {
    if (!title.trim() || (!content.trim() && imageIds.length === 0)) {
      error = 'Title and content are required';
      return;
    }

    isSubmitting = true;
    error = '';

    try {
      const endpoint = fromPath(
        `/api/${organizationType === 'university' ? 'universities' : 'clubs'}/${organizationId}/posts`
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          readability,
          images: imageIds
        })
      });

      if (response.ok) {
        const result = (await response.json()) as { postId: string };
        publishedImageIds = [...imageIds];
        reset();
        if (onCreated) {
          onCreated(result.postId);
        }
      } else {
        const errorData = (await response.json()) as { message: string };
        error = errorData.message || 'Failed to create post';
      }
    } catch {
      error = m.network_error_try_again();
    } finally {
      isSubmitting = false;
    }
  };
</script>

<!-- Header -->
<div class="mb-4 flex items-center justify-between">
  <h3 class="flex items-center gap-2 text-lg font-bold">
    <i class="fa-solid fa-plus"></i>
    {m.create_post()}
  </h3>
  <label class="flex cursor-pointer items-center gap-2 not-xl:hidden" title={m.wide_mode()}>
    <span class="text-base-content/60 text-sm">{m.wide_mode()}</span>
    <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={wideMode} />
  </label>
</div>

<!-- Organization info -->
<div class="bg-base-200 mb-4 rounded-lg p-3 text-sm">
  <span class="text-base-content/60">
    {m.posting_to()}:
  </span>
  <span class="font-medium">{organizationName}</span>
</div>

<!-- Error message -->
{#if error}
  <div class="alert alert-error mb-4">
    <i class="fa-solid fa-exclamation-triangle"></i>
    <span>{error}</span>
  </div>
{/if}

<!-- Form -->
<div class="flex min-h-0 flex-1 flex-col">
  <div class="mb-4 flex gap-2">
    <!-- Title input -->
    <div class="form-control flex-1">
      <label class="label" for="post-title">
        <span class="label-text">{m.post_title()}</span>
      </label>
      <input
        id="post-title"
        type="text"
        placeholder={m.post_title_placeholder()}
        class="input input-bordered w-full"
        bind:value={title}
        disabled={isSubmitting}
        maxlength="200"
      />
      <label class="label" for="post-title">
        <span class="label-text-alt text-base-content/60">
          {title.length}/200
        </span>
      </label>
    </div>
    <!-- Readability selection -->
    <div class="form-control">
      <label class="label" for="post-readability">
        <span class="label-text">{m.post_visibility()}</span>
      </label>
      <select
        id="post-readability"
        class="select select-bordered"
        bind:value={readability}
        disabled={isSubmitting}
      >
        {#each readabilityOptions.filter((option) => canManage || option.value >= organizationReadability) as option (option.value)}
          <option value={option.value}>
            {option.label}
          </option>
        {/each}
      </select>
    </div>
  </div>

  <!-- Content area -->
  <MarkdownEditor
    bind:value={content}
    bind:attachments
    bind:imageIds
    placeholder={m.post_content_placeholder()}
    disabled={isSubmitting}
    minHeight="min-h-48"
    {currentUser}
    imageUploadUrl={buildImageUploadUrl({
      draftKind: 'post',
      organizationType,
      organizationId
    })}
    appendUploadedImagesToMarkdown={true}
  />
</div>

<!-- Footer -->
<div class="mt-4 flex justify-end gap-2">
  <a href={cancelHref} class="btn btn-ghost">
    {m.cancel()}
  </a>
  <button
    class="btn btn-primary"
    onclick={handleSubmit}
    disabled={isSubmitting || !title.trim() || (!content.trim() && imageIds.length === 0)}
  >
    {#if isSubmitting}
      <span class="loading loading-spinner loading-sm"></span>
    {:else}
      <i class="fa-solid fa-paper-plane"></i>
    {/if}
    {m.publish_post()}
  </button>
</div>
