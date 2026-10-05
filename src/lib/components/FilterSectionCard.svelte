<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Font Awesome class for the header icon. */
    icon: string;
    /** Localized section heading. */
    title: string;
    /** Span both columns of the parent grid. */
    span?: boolean;
    children: Snippet;
  }

  const { icon, title, span = false, children }: Props = $props();
</script>

<section class="rounded-box bg-base-200/40 flex flex-col gap-3 p-4 {span ? 'sm:col-span-2' : ''}">
  <h4 class="flex items-center gap-2 text-sm font-semibold">
    <i class="fa-solid {icon} text-base-content/40"></i>
    <span class="min-w-0 flex-1 truncate">{title}</span>
  </h4>
  {@render children()}
</section>
