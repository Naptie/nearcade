<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { base } from '$app/paths';
  
  interface Props {
    isOpen: boolean;
    organizationType: 'university' | 'club';
    organizationId: string;
    organizationName: string;
    onClose: () => void;
    onSuccess?: (postId: string) => void;
  }

  let { 
    isOpen, 
    organizationType,
    organizationId,
    organizationName,
    onClose, 
    onSuccess 
  }: Props = $props();

  let title = $state('');
  let content = $state('');
  let isSubmitting = $state(false);
  let showPreview = $state(false);
  let error = $state('');

  const reset = () => {
    title = '';
    content = '';
    showPreview = false;
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
        const result = await response.json();
        reset();
        onClose();
        if (onSuccess) {
          onSuccess(result.postId);
        }
      } else {
        const errorData = await response.json();
        error = errorData.error || 'Failed to create post';
      }
    } catch (err) {
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
    <div class="modal-box max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold flex items-center gap-2">
          <i class="fa-solid fa-plus"></i>
          {m.create_post()}
        </h3>
        <button 
          class="btn btn-ghost btn-circle btn-sm"
          onclick={handleClose}
          disabled={isSubmitting}
        >
          <i class="fa-solid fa-times"></i>
        </button>
      </div>

      <!-- Organization info -->
      <div class="mb-4 p-3 bg-base-200 rounded-lg text-sm">
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
      <div class="flex-1 flex flex-col min-h-0">
        <!-- Title input -->
        <div class="form-control mb-4">
          <label class="label" for="post-title">
            <span class="label-text">{m.post_title()}</span>
          </label>
          <input
            id="post-title"
            type="text"
            placeholder={m.post_title_placeholder()}
            class="input input-bordered"
            bind:value={title}
            disabled={isSubmitting}
            maxlength="200"
          />
          <label class="label">
            <span class="label-text-alt text-base-content/60">
              {title.length}/200
            </span>
          </label>
        </div>

        <!-- Content tabs -->
        <div class="tabs tabs-boxed mb-2">
          <button 
            class="tab {!showPreview ? 'tab-active' : ''}"
            onclick={() => showPreview = false}
          >
            <i class="fa-solid fa-edit mr-2"></i>
            {m.write()}
          </button>
          <button 
            class="tab {showPreview ? 'tab-active' : ''}"
            onclick={() => showPreview = true}
            disabled={!content.trim()}
          >
            <i class="fa-solid fa-eye mr-2"></i>
            {m.preview()}
          </button>
        </div>

        <!-- Content area -->
        <div class="flex-1 min-h-0">
          {#if showPreview}
            <div class="h-full overflow-y-auto p-4 bg-base-200 rounded-lg prose prose-sm max-w-none">
              {#if content.trim()}
                {@html content}
              {:else}
                <p class="text-base-content/60 italic">{m.nothing_to_preview()}</p>
              {/if}
            </div>
          {:else}
            <textarea
              placeholder={m.post_content_placeholder()}
              class="textarea textarea-bordered resize-none h-full"
              bind:value={content}
              disabled={isSubmitting}
              onkeydown={handleKeyDown}
            ></textarea>
          {/if}
        </div>

        <!-- Markdown hint -->
        <div class="mt-2 text-xs text-base-content/60">
          <i class="fa-brands fa-markdown mr-1"></i>
          {m.markdown_supported()}
        </div>
      </div>

      <!-- Footer -->
      <div class="modal-action">
        <button 
          class="btn btn-ghost"
          onclick={handleClose}
          disabled={isSubmitting}
        >
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
        <div class="text-xs text-base-content/60 ml-2">
          Ctrl+Enter
        </div>
      </div>
    </div>
  </div>
{/if}