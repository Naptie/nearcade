<script lang="ts">
  import { diffChars, diffWordsWithSpace } from 'diff';
  import { m } from '$lib/paraglide/messages';

  interface Props {
    oldValue?: string | null;
    newValue?: string | null;
    class?: string;
  }

  let { oldValue, newValue, class: className = '' }: Props = $props();

  interface DiffSegment {
    text: string;
    changed: boolean;
  }

  // CJK text has no word boundaries, so word-level tokenization would flag an
  // entire run for a one-character edit; fall back to character-level there.
  const CJK_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;

  const computeSegments = $derived.by(() => {
    const oldV = oldValue ?? '';
    const newV = newValue ?? '';
    if (!oldValue && !newValue) return null;

    const diffFn = CJK_RE.test(oldV) || CJK_RE.test(newV) ? diffChars : diffWordsWithSpace;
    const before: DiffSegment[] = [];
    const after: DiffSegment[] = [];
    for (const part of diffFn(oldV, newV)) {
      if (part.added) {
        after.push({ text: part.value, changed: true });
      } else if (part.removed) {
        before.push({ text: part.value, changed: true });
      } else {
        before.push({ text: part.value, changed: false });
        after.push({ text: part.value, changed: false });
      }
    }
    return { before, after };
  });
</script>

{#if computeSegments}
  <div class="flex flex-col gap-1 {className}">
    {#if oldValue && newValue}
      <div class="flex items-start gap-1.5">
        <span
          class="text-error w-3 shrink-0 text-center font-mono text-xs font-bold select-none"
          aria-hidden="true">-</span
        >
        <span class="sr-only">{m.from()}:</span>
        <code class="bg-error/10 text-error min-w-0 rounded px-1 text-xs break-all">
          {#each computeSegments.before as segment, i (i)}{#if segment.changed}<span
                class="bg-error/40 text-base-content rounded-xs box-decoration-clone"
                >{segment.text}</span
              >{:else}{segment.text}{/if}{/each}
        </code>
      </div>
      <div class="flex items-start gap-1.5">
        <span
          class="text-success w-3 shrink-0 text-center font-mono text-xs font-bold select-none"
          aria-hidden="true">+</span
        >
        <span class="sr-only">{m.to()}:</span>
        <code class="bg-success/10 text-success min-w-0 rounded px-1 text-xs break-all">
          {#each computeSegments.after as segment, i (i)}{#if segment.changed}<span
                class="bg-success/40 text-base-content rounded-xs box-decoration-clone"
                >{segment.text}</span
              >{:else}{segment.text}{/if}{/each}
        </code>
      </div>
    {:else if newValue}
      <div class="flex items-start gap-1.5">
        <span
          class="text-success w-3 shrink-0 text-center font-mono text-xs font-bold select-none"
          aria-hidden="true">+</span
        >
        <span class="sr-only">{m.set_to()}:</span>
        <code class="bg-success/10 text-success rounded px-1 text-xs break-all">
          {newValue}
        </code>
      </div>
    {:else if oldValue}
      <div class="flex items-start gap-1.5">
        <span
          class="text-error w-3 shrink-0 text-center font-mono text-xs font-bold select-none"
          aria-hidden="true">-</span
        >
        <span class="sr-only">{m.cleared_value()}:</span>
        <code class="bg-error/10 text-error rounded px-1 text-xs break-all">
          {oldValue}
        </code>
      </div>
    {/if}
  </div>
{/if}
