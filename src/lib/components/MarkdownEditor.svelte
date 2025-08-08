<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import { renderMarkdown } from '$lib/markdown';

  interface Props {
    value: string;
    placeholder?: string;
    disabled?: boolean;
    onKeyDown?: (event: KeyboardEvent) => void;
    minHeight?: string;
    showPreviewTab?: boolean;
  }

  let {
    value = $bindable(''),
    placeholder = m.post_content_placeholder(),
    disabled = false,
    onKeyDown,
    minHeight = 'min-h-32',
    showPreviewTab = true
  }: Props = $props();

  let preview = $state('');
  let showPreview = $state(false);

  $effect(() => {
    if (!value.trim()) {
      preview = '';
    } else {
      renderMarkdown(value).then((html) => {
        preview = html;
      });
    }
  });
</script>

{#if showPreviewTab}
  <!-- Tab Navigation -->
  <div class="tabs tabs-lifted mb-2">
    <button class="tab {!showPreview ? 'tab-active' : ''}" onclick={() => (showPreview = false)}>
      <i class="fa-solid fa-edit mr-1"></i>
      {m.write()}
    </button>
    <button class="tab {showPreview ? 'tab-active' : ''}" onclick={() => (showPreview = true)}>
      <i class="fa-solid fa-eye mr-1"></i>
      {m.preview()}
    </button>
  </div>
{/if}

<!-- Content area -->
<div class="flex {minHeight} flex-col {showPreviewTab ? 'sm:flex-row' : ''}">
  {#if !showPreviewTab || !showPreview}
    <textarea
      {placeholder}
      class="textarea textarea-bordered h-auto w-auto flex-1 resize-none rounded-2xl {showPreviewTab
        ? 'not-sm:rounded-b-none sm:rounded-r-none'
        : ''}"
      bind:value
      {disabled}
      onkeydown={onKeyDown}
    ></textarea>
  {/if}

  {#if showPreviewTab && (showPreview || !showPreview)}
    <div
      class="bg-base-200 prose prose-sm h-auto flex-1 overflow-y-auto rounded-2xl px-4 py-2 {showPreview
        ? ''
        : 'not-sm:rounded-t-none sm:rounded-l-none'} {showPreview && showPreviewTab
        ? 'block'
        : showPreviewTab
          ? 'hidden sm:block'
          : 'hidden'}"
    >
      {#if preview}
        {@html preview}
      {:else}
        <p class="text-base-content/60 italic">{m.nothing_to_preview()}</p>
      {/if}
    </div>
  {/if}
</div>

<!-- Markdown hint -->
<div class="text-base-content/60 mt-2 text-xs">
  <i class="fa-brands fa-markdown mr-1"></i>
  {m.markdown_supported()}
</div>
