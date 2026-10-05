<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();
</script>

<!--
  Canonical row-actions wrapper. Standard button sizing lives in
  `AdminRowAction.svelte`; use it so every table looks the same.
-->
<div class="flex flex-wrap items-center justify-end gap-2">{@render children?.()}</div>
