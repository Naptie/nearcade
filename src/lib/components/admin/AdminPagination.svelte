<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { page } from '$app/state';
  import { buildPageHref, parsePageParam } from '$lib/admin/list-state';

  interface Props {
    /** Current 1-based page number. Falls back to the `page` query param. */
    currentPage?: number | null;
    hasMore?: boolean;
    /** Total row count. Enables the numbered page control and the total readout. */
    total?: number | null;
    /** Rows per page; only used with `total`. */
    pageSize?: number;
    /** Client-driven pagination. When set, renders buttons instead of navigating. */
    onPageChange?: (page: number) => void;
  }

  let { currentPage, hasMore = false, total = null, pageSize = 20, onPageChange }: Props = $props();

  const current = $derived(Math.max(1, currentPage ?? parsePageParam(page.url)));

  const totalPages = $derived(
    total !== null && total !== undefined && pageSize > 0
      ? Math.max(1, Math.ceil(total / pageSize))
      : null
  );

  /** Numbered window around the current page, so long lists stay navigable. */
  const windowPages = $derived.by(() => {
    if (!totalPages) return [];
    const start = Math.max(1, current - 2);
    const end = Math.min(totalPages, current + 2);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });

  const hasNext = $derived(totalPages !== null ? current < totalPages : hasMore);

  const showControls = $derived(hasMore || (totalPages !== null && totalPages > 1));
</script>

{#if showControls}
  <div class="border-base-300 flex flex-wrap items-center justify-center gap-2 border-t p-4">
    {#snippet navButton(target: number, label: string, icon: string, disabled: boolean)}
      {#if disabled}
        <span class="btn btn-soft btn-sm" aria-disabled="true">
          <i class="fa-solid {icon}"></i>
          <span class="not-sm:hidden">{label}</span>
        </span>
      {:else if onPageChange}
        <button type="button" class="btn btn-soft btn-sm" onclick={() => onPageChange(target)}>
          <i class="fa-solid {icon}"></i>
          <span class="not-sm:hidden">{label}</span>
        </button>
      {:else}
        <a class="btn btn-soft btn-sm" href={buildPageHref(page.url, target)}>
          <i class="fa-solid {icon}"></i>
          <span class="not-sm:hidden">{label}</span>
        </a>
      {/if}
    {/snippet}

    {@render navButton(current - 1, m.previous_page(), 'fa-chevron-left', current <= 1)}

    {#each windowPages as windowPage (windowPage)}
      {#if windowPage === current}
        <span class="btn btn-primary btn-sm btn-square">{windowPage}</span>
      {:else if onPageChange}
        <button
          type="button"
          class="btn btn-soft btn-sm btn-square"
          onclick={() => onPageChange(windowPage)}
        >
          {windowPage}
        </button>
      {:else}
        <a class="btn btn-soft btn-sm btn-square" href={buildPageHref(page.url, windowPage)}>
          {windowPage}
        </a>
      {/if}
    {/each}

    {@render navButton(current + 1, m.next_page(), 'fa-chevron-right', !hasNext)}
  </div>
{/if}
