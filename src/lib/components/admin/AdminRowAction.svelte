<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Button colour intent. */
    variant?: 'primary' | 'error' | 'neutral';
    /** Icon-only buttons collapse the label and need an accessible name. */
    iconOnly?: boolean;
    label?: string;
    /** For icon-only buttons. */
    title?: string;
    href?: string;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    onclick?: (event: MouseEvent) => void;
    children?: Snippet;
  }

  let {
    variant = 'primary',
    iconOnly = false,
    label,
    title,
    href,
    type = 'button',
    disabled = false,
    onclick,
    children
  }: Props = $props();

  const tone = $derived(
    variant === 'error' ? 'btn-error' : variant === 'neutral' ? 'btn-ghost' : 'btn-primary'
  );

  const classes = $derived(
    `btn btn-soft btn-sm text-nowrap ${tone} ${iconOnly ? 'btn-square' : ''}`
  );
</script>

{#if href}
  <a
    class={classes}
    {href}
    {title}
    aria-label={iconOnly ? title : undefined}
    target="_blank"
    rel="noopener noreferrer"
  >
    {@render children?.()}
    {#if iconOnly && label}<span class="sr-only">{label}</span>{/if}
  </a>
{:else}
  <button
    {type}
    class={classes}
    {disabled}
    {onclick}
    {title}
    aria-label={iconOnly ? title : undefined}
  >
    {@render children?.()}
    {#if iconOnly && label}<span class="sr-only">{label}</span>{/if}
  </button>
{/if}
