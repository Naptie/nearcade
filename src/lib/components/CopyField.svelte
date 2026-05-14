<script lang="ts">
  import { m } from '$lib/paraglide/messages';

  interface Props {
    /** The value to display in the input. */
    value: string;
    /** Optional override for what is written to the clipboard (defaults to value). */
    copyText?: string;
    /** Optional id for the input element (for label association). */
    id?: string;
    /** Additional CSS classes for the outer wrapper. */
    class?: string;
    /** Additional CSS classes for the input element. */
    inputClass?: string;
    /** How to display the value: 'input' renders a readonly text field, 'text' renders inline code. */
    display?: 'input' | 'text';
    /** Button style variant. */
    buttonStyle?: 'ghost' | 'circle' | 'soft';
    /** Whether to use monospace font in the input. */
    mono?: boolean;
    /** Custom aria-label for the copy button. */
    ariaLabel?: string;
    /** Size variant for the input and button. */
    size?: 'xs' | 'sm' | 'md';
  }

  let {
    value,
    copyText,
    id,
    class: klass = '',
    inputClass = '',
    buttonStyle = 'soft',
    mono = true,
    ariaLabel,
    size = 'md',
    display = 'input'
  }: Props = $props();

  let isCopied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const inputSizeClass = $derived(
    size === 'xs' ? 'input-xs' : size === 'sm' ? 'input-sm' : ''
  );
  const btnSizeClass = $derived(
    size === 'xs' ? 'btn-xs' : size === 'sm' ? 'btn-sm' : ''
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText ?? value);
      isCopied = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        isCopied = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  const btnBase = 'btn transition-all duration-200';
  const btnVariant = $derived(
    buttonStyle === 'circle'
      ? `${btnBase} btn-circle btn-soft hover:bg-primary hover:text-primary-content dark:hover:bg-white dark:hover:text-black ${btnSizeClass}`
      : buttonStyle === 'ghost'
        ? `${btnBase} btn-ghost ${btnSizeClass}`
        : `${btnBase} btn-soft hover:bg-primary hover:text-primary-content dark:hover:bg-white dark:hover:text-black ${btnSizeClass}`
  );
</script>

<div class="flex items-center gap-2 {klass}">
  {#if display === 'text'}
    <code class="truncate text-sm {mono ? 'font-mono' : ''} {inputClass}">{value}</code>
  {:else}
    <input
      {id}
      type="text"
      class="input input-bordered flex-1 text-sm {mono ? 'font-mono' : ''} {inputSizeClass} {inputClass}"
      {value}
      readonly
    />
  {/if}
  <button
    type="button"
    class={btnVariant}
    class:btn-success={isCopied}
    class:btn-active={isCopied}
    onclick={copy}
    title={ariaLabel ?? m.copy()}
    aria-label={ariaLabel ?? m.copy()}
  >
    {#if isCopied}
      <i class="fa-solid fa-check"></i>
    {:else}
      <i class="fa-solid fa-copy"></i>
    {/if}
  </button>
</div>
