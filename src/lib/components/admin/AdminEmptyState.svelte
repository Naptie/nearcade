<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Font Awesome class for the empty-state glyph, e.g. `fa-gamepad`. */
    icon: string;
    /** Override the muted icon colour, e.g. `text-warning`. */
    iconClass?: string;
    title: string;
    description?: string;
    /** Optional call-to-action row under the description. */
    action?: Snippet;
  }

  let { icon, iconClass, title, description, action }: Props = $props();
</script>

<div class="py-12 text-center">
  <i class="fa-solid {icon} mb-4 text-4xl {iconClass ?? 'text-base-content/40'}"></i>
  <h3 class="text-base-content mb-2 text-lg font-semibold">{title}</h3>
  {#if description}
    <p class="text-base-content/60">{description}</p>
  {/if}
  {#if action}
    <div class="mt-4 flex flex-wrap justify-center gap-2">{@render action()}</div>
  {/if}
</div>
