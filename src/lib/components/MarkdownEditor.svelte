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
  }

  let {
    value = $bindable(''),
    placeholder = m.post_content_placeholder(),
    disabled = false,
    onKeyDown,
    minHeight = 'min-h-32'
  }: Props = $props();

  let preview = $state('');

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

<!-- Content area -->
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
  <div class="text-base-content/60 absolute -bottom-6 text-xs">
    <i class="fa-brands fa-markdown"></i>
    <span class="ml-1 not-sm:hidden">{m.markdown_supported()}</span>
  </div>
</div>
