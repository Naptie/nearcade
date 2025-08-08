<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import { base } from '$app/paths';
  import { renderMarkdown } from '$lib/markdown';

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
  let preview = $state('');

  $effect(() => {
    if (!content.trim()) {
      preview = '';
    } else {
      renderMarkdown(content).then((html) => {
        preview = html;
      });
    }
  });

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
      const endpoint = `${base}/api/${organizationType === 'university' ? 'universities' : 'clubs'}/${organizationId}/posts`;
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
      error = 'Network error. Please try again.';
    } finally {
      isSubmitting = false;
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };
</script>

{#if isOpen}
  <div class="modal modal-open">
    <div class="modal-box flex max-h-[90vh] max-w-7xl flex-col overflow-hidden">
      <!-- Header -->
      <div class="mb-4 flex items-center justify-between">
        <h3 class="flex items-center gap-2 text-lg font-bold">
          <i class="fa-solid fa-plus"></i>
          {m.create_post()}
        </h3>
        <button
          class="btn btn-ghost btn-circle btn-sm"
          onclick={handleClose}
          disabled={isSubmitting}
          aria-label={m.close()}
        >
          <i class="fa-solid fa-times"></i>
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
        <div class="flex min-h-32 flex-col sm:flex-row">
          <textarea
            placeholder={m.post_content_placeholder()}
            class="textarea textarea-bordered h-auto w-auto flex-1 resize-none rounded-2xl not-sm:rounded-b-none sm:rounded-r-none"
            bind:value={content}
            disabled={isSubmitting}
            onkeydown={handleKeyDown}
          ></textarea>
          <div
            class="bg-base-200 prose prose-sm h-auto flex-1 overflow-y-auto rounded-2xl px-4 py-2 not-sm:rounded-t-none sm:rounded-l-none"
          >
            {#if preview}
              {@html preview}
            {:else}
              <p class="text-base-content/60 italic">{m.nothing_to_preview()}</p>
            {/if}
          </div>
        </div>

        <!-- Markdown hint -->
        <div class="text-base-content/60 mt-2 text-xs">
          <i class="fa-brands fa-markdown mr-1"></i>
          {m.markdown_supported()}
        </div>
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
        <div class="text-base-content/60 ml-2 text-xs">Ctrl+Enter</div>
      </div>
    </div>
  </div>
{/if}
