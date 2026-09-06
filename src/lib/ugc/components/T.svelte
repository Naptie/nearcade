<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import { render } from '$lib/utils/markdown';
  import { fade } from 'svelte/transition';
  import { normalizeUgcText, translationCacheKey } from '../hash';
  import { onUgcTranslated, resolveUgcTextState } from '../client';
  import { UGC_TRANSLATION_ENABLED } from '$lib/constants';
  import type { UgcTranslationField } from '../types';

  interface Props {
    /** Original user-generated text. */
    text: string;
    /** Which user-facing UGC field this is — gates on the reader's opt-in. */
    field: UgcTranslationField;
    /** Pre-resolved translation (e.g. `_t` attached by a server loader). When
     * present the fetch round-trip is skipped entirely. */
    translation?: string | null;
    /** Render as sanitized Markdown instead of plain text. */
    markdown?: boolean;
    class?: string;
  }

  let {
    text,
    field,
    translation = null,
    markdown = false,
    class: className = ''
  }: Props = $props();

  // Original first: the translation is a progressive upgrade that swaps in
  // when (and only when) the write-time job has cached one and the reader
  // opted into translating this field.
  let fetched = $state<string | null>(null);
  let renderedHtml = $state('');
  let requested = $state('');

  const normalized = $derived(normalizeUgcText(text));
  const translated = $derived(translation ?? fetched);

  const swapInTranslation = (result: string): void => {
    if (!result || result === normalized) return;
    fetched = result;
  };

  $effect(() => {
    // Feature temporarily disabled — never fetch/fade (see switch.ts).
    if (!UGC_TRANSLATION_ENABLED || !normalized || translation || requested === normalized) return;
    requested = normalized;
    let unsubscribe: (() => void) | null = null;
    // resolveUgcTextState gates on the reader's opt-in and returns 'pending'
    // when work is issued — the poller then calls swapInTranslation.
    void resolveUgcTextState(text, field).then((status) => {
      if (status.state === 'cached') {
        swapInTranslation(status.text);
      } else if (status.state === 'pending') {
        const key = translationCacheKey(status.hash, status.locale);
        unsubscribe = onUgcTranslated(key, swapInTranslation);
      }
    });
    return () => {
      unsubscribe?.();
    };
  });

  $effect(() => {
    if (!markdown) {
      renderedHtml = '';
      return;
    }
    const source = translated ?? text;
    void render(source).then((html) => (renderedHtml = html));
  });
</script>

{#if markdown}
  <span class={className}>
    {#key translated}
      <span transition:fade={{ duration: 250 }}>
        {@html renderedHtml}
      </span>
    {/key}
  </span>
  {#if UGC_TRANSLATION_ENABLED && translated}
    <span
      class="text-base-content/40 ml-1 align-middle text-xs"
      title={m.ai_translated_disclosure()}
    >
      <i class="fa-solid fa-language" aria-hidden="true"></i>
      <span class="not-sm:hidden">{m.ai_translation_badge()}</span>
    </span>
  {/if}
{:else}
  <span class={className}>
    {#key translated}
      <span transition:fade={{ duration: 250 }}>{translated ?? text}</span>
    {/key}
  </span>
  {#if UGC_TRANSLATION_ENABLED && translated}
    <span
      class="badge badge-ghost badge-sm gap-0.5 align-middle font-normal"
      title={m.ai_translated_disclosure()}
    >
      <i class="fa-solid fa-language text-xs" aria-hidden="true"></i>
      <!-- <span class="hidden sm:inline">{m.ai_translation_badge()}</span> -->
    </span>
  {/if}
{/if}
