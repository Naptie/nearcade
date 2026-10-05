<script lang="ts">
  import type { Snippet } from 'svelte';
  import { m } from '$lib/paraglide/messages';
  import { pageTitle } from '$lib/utils';

  interface Props {
    /** Localized page title — used for both `<svelte:head>` and the visible `<h1>`. */
    title: string;
    /** Optional supporting copy rendered under the title. */
    description?: string;
    /** Optional back link rendered above the title (detail pages). */
    backHref?: string;
    backLabel?: string;
    /** Header right-hand slot: stats, primary actions. Centered on mobile, end-aligned on desktop. */
    actions?: Snippet;
    children?: Snippet;
  }

  let { title, description, backHref, backLabel, actions, children }: Props = $props();
</script>

<svelte:head>
  <title>{pageTitle(title, m.admin_panel())}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
    <div class="not-sm:w-full not-sm:text-center">
      {#if backHref}
        <a href={backHref} class="btn btn-ghost btn-sm mb-2 -ml-2">
          <i class="fa-solid fa-arrow-left"></i>
          {backLabel ?? m.back()}
        </a>
      {/if}
      <h1 class="text-base-content text-3xl font-bold">{title}</h1>
      {#if description}
        <p class="text-base-content/60 mt-1">{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="flex flex-wrap items-center justify-center gap-3 sm:justify-end">
        {@render actions()}
      </div>
    {/if}
  </div>

  {@render children?.()}
</div>
