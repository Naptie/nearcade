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
    organizationType?: 'university' | 'club';
    organizationId?: string;
    organizationName?: string;
    organizationReadability?: PostReadability;
    canManage?: boolean;
    variant?: 'organization' | 'announcement';
    submitUrl?: string;
    currentUser?: User | undefined;
    cancelHref: string;
    wideMode?: boolean;
    onCreated?: (postId: string) => void;
  }

  let {
    organizationType = 'university',
    organizationId = '',
    organizationName = '',
    organizationReadability = PostReadability.PUBLIC,
    canManage = false,
    variant = 'organization',
    submitUrl,
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
  let publishNow = $state(true);
  let publishAtLocal = $state('');
  let expiresAtLocal = $state('');
  let isAnnouncement = $derived(variant === 'announcement');
  let isScheduled = $derived(!publishNow && Boolean(publishAtLocal));

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
    publishNow = true;
    publishAtLocal = '';
    expiresAtLocal = '';
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
        submitUrl ||
          `/api/${organizationType === 'university' ? 'universities' : 'clubs'}/${organizationId}/posts`
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(
          isAnnouncement
            ? {
                title: title.trim(),
                content: content.trim(),
                images: imageIds,
                publish: publishNow || Boolean(publishAtLocal),
                publishAt:
                  !publishNow && publishAtLocal ? new Date(publishAtLocal).toISOString() : null,
                expiresAt: expiresAtLocal ? new Date(expiresAtLocal).toISOString() : null
              }
            : {
                title: title.trim(),
                content: content.trim(),
                readability,
                images: imageIds
              }
        )
      });

      if (response.ok) {
        const result = (await response.json()) as { postId?: string; announcementId?: string };
        publishedImageIds = [...imageIds];
        reset();
        if (onCreated) {
          onCreated(result.announcementId || result.postId || '');
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
    <i class="fa-solid {isAnnouncement ? 'fa-bullhorn' : 'fa-plus'}"></i>
    {isAnnouncement ? m.new_announcement() : m.create_post()}
  </h3>
  <label class="flex cursor-pointer items-center gap-2 not-xl:hidden" title={m.wide_mode()}>
    <span class="text-base-content/60 text-sm">{m.wide_mode()}</span>
    <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={wideMode} />
  </label>
</div>

<!-- Organization info -->
<div class="bg-base-200 mb-4 rounded-lg p-3 text-sm">
  {#if isAnnouncement}
    <span class="font-medium">{m.posting_announcement()}</span>
    <p class="text-base-content/60 mt-1">{m.announcements_no_reactions()}</p>
  {:else}
    <span class="text-base-content/60">
      {m.posting_to()}:
    </span>
    <span class="font-medium">{organizationName}</span>
  {/if}
</div>

<!-- Error message -->
{#if error}
  <div class="alert alert-error mb-4">
    <i class="fa-solid fa-exclamation-triangle"></i>
    <span>{error}</span>
  </div>
{/if}

<!-- Form -->
<div class="flex min-h-0 flex-1 flex-col gap-4">
  <div class="flex gap-2">
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
    {#if !isAnnouncement}
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
    {/if}
  </div>
  {#if isAnnouncement}
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="form-control">
        <label class="label" for="announcement-publish-at">
          <span class="label-text">{m.announcement_publish_at()}</span>
        </label>
        <input
          id="announcement-publish-at"
          type="datetime-local"
          class="input input-bordered w-full"
          bind:value={publishAtLocal}
          disabled={isSubmitting || publishNow}
        />
        <span class="label-text-alt text-base-content/60 mt-1">
          {publishNow ? m.announcement_publish_immediately() : m.announcement_publish_at_hint()}
        </span>
        <label class="mt-3 flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            class="checkbox checkbox-primary checkbox-sm"
            bind:checked={publishNow}
          />
          <span>{m.announcement_publish_immediately()}</span>
        </label>
      </div>
      <div class="form-control">
        <label class="label" for="announcement-expires">
          <span class="label-text">{m.expires()}</span>
        </label>
        <input
          id="announcement-expires"
          type="datetime-local"
          class="input input-bordered w-full"
          bind:value={expiresAtLocal}
          disabled={isSubmitting}
        />
        <span class="label-text-alt text-base-content/60 mt-1"
          >{m.announcement_expires_at_hint()}</span
        >
      </div>
    </div>
  {/if}

  <!-- Content area -->
  <MarkdownEditor
    bind:value={content}
    bind:attachments
    bind:imageIds
    placeholder={m.post_content_placeholder()}
    disabled={isSubmitting}
    minHeight="min-h-48"
    {currentUser}
    imageUploadUrl={buildImageUploadUrl(
      isAnnouncement
        ? { draftKind: 'announcement' }
        : { draftKind: 'post', organizationType, organizationId }
    )}
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
    {isAnnouncement
      ? publishNow
        ? m.publish_announcement()
        : isScheduled
          ? m.schedule_announcement()
          : m.announcement_draft()
      : m.publish_post()}
  </button>
</div>
