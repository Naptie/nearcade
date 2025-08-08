<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import { fromPath } from '$lib/utils';

  interface Props {
    isOpen: boolean;
    organizationType: 'university' | 'club';
    organizationId: string;
    organizationName: string;
    onClose: () => void;
    onSuccess?: (postId: string) => void;
  }

  let { isOpen, organizationType, organizationId, organizationName, onClose, onSuccess }: Props =
    $props();

  let title = $state('');
  let content = $state('');
  let isSubmitting = $state(false);
  let error = $state('');

  const reset = () => {
    title = '';
    content = '';
    error = '';
    isSubmitting = false;
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
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
          content: content.trim()
        })
      });

      if (response.ok) {
        const result = (await response.json()) as { postId: string };
        reset();
        onClose();
        if (onSuccess) {
          onSuccess(result.postId);
        }
      } else {
        const errorData = (await response.json()) as { error: string };
        error = errorData.error || 'Failed to create post';
      }
    } catch {
      error = m.network_error_try_again();
    } finally {
      isSubmitting = false;
    }
  };
</script>

<div class="modal" class:modal-open={isOpen}>
  <div class="modal-box flex max-h-[90vh] max-w-7xl flex-col overflow-hidden">
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <h3 class="flex items-center gap-2 text-lg font-bold">
        <i class="fa-solid fa-plus"></i>
        {m.create_post()}
      </h3>
      <button
        class="btn btn-ghost btn-circle"
        onclick={handleClose}
        disabled={isSubmitting}
        aria-label={m.close()}
      >
        <i class="fa-solid fa-times fa-lg"></i>
      </button>
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
      <!-- Title input -->
      <div class="form-control mb-4">
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

      <!-- Content area -->
      <MarkdownEditor
        bind:value={content}
        placeholder={m.post_content_placeholder()}
        disabled={isSubmitting}
        minHeight="min-h-32"
      />
    </div>

    <!-- Footer -->
    <div class="modal-action">
      <button class="btn btn-ghost" onclick={handleClose} disabled={isSubmitting}>
        {m.cancel()}
      </button>
      <button
        class="btn btn-primary"
        onclick={handleSubmit}
        disabled={isSubmitting || !title.trim() || !content.trim()}
      >
        {#if isSubmitting}
          <span class="loading loading-spinner loading-sm"></span>
        {:else}
          <i class="fa-solid fa-paper-plane"></i>
        {/if}
        {m.publish_post()}
      </button>
    </div>
  </div>
</div>
