<script>
  import { m } from '$lib/paraglide/messages';

  let { href = '', class: klass = 'tooltip-right' } = $props();
</script>

{#snippet mark()}
  <span class="text-success relative transition-colors" class:hover:text-white={!!href}>
    <i class="fa-solid fa-certificate fa-lg"></i>
    <span class="absolute inset-x-0 text-center">
      <i class="text-base-200 fa-solid fa-check fa-xs"></i>
    </span>
  </span>
{/snippet}

<div class="tooltip {klass}" data-tip={m.verified()}>
  {#if href}
    <a {href}>
      {@render mark()}
    </a>
  {:else}
    {@render mark()}
  {/if}
</div>
