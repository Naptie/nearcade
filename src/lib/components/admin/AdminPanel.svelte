<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Adds `p-4` — use for content cards; leave off for tables/cards with their own padding. */
    padded?: boolean;
    class?: string;
    children?: Snippet;
  }

  let { padded = false, class: className = '', children }: Props = $props();
</script>

<section class="bg-base-100 border-base-300 rounded-lg border shadow-sm {className}">
  {#if padded}
    <div class="p-4">
      {@render children?.()}
    </div>
  {:else}
    {@render children?.()}
  {/if}
</section>
