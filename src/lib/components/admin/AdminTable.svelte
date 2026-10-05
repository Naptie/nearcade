<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Column headers — wrap each `<th>` in a `<tr>`. */
    head?: Snippet;
    /** Applies `table-fixed` for pages that declare explicit column widths. */
    fixed?: boolean;
    /** Stacks rows as cards on narrow screens instead of scrolling horizontally. */
    class?: string;
    /** Table body rows. */
    children?: Snippet;
  }

  let { head, fixed = false, class: className = '', children }: Props = $props();
</script>

<div class="overflow-x-auto">
  <table class="table w-full {fixed ? 'table-fixed' : ''} {className}">
    {#if head}
      <thead>
        {@render head()}
      </thead>
    {/if}
    <tbody>
      {@render children?.()}
    </tbody>
  </table>
</div>
