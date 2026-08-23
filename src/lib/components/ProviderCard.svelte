<script lang="ts">
  import type { Snippet } from 'svelte';
  import ProviderIcon from './ProviderIcon.svelte';
  import { m } from '$lib/paraglide/messages';

  export interface Provider {
    name: string;
    icon: string;
    class?: string;
  }

  let {
    provider,
    variant = 'bind',
    busy = false,
    disabled = false,
    subtitle,
    onclick
  }: {
    provider: Provider;
    /** bind = available to link, bound = already linked (unlink on click), pick = platform picker */
    variant?: 'bind' | 'bound' | 'pick';
    busy?: boolean;
    disabled?: boolean;
    /** Optional second line under the name; defaults per variant. */
    subtitle?: Snippet;
    onclick?: (event: MouseEvent) => void;
  } = $props();

  const isBound = $derived(variant === 'bound');
</script>

<button
  type="button"
  class="{isBound
    ? 'bg-base-300/50 group hover:bg-error'
    : 'bg-base-300/50 group'} flex cursor-pointer items-center gap-3 rounded-lg p-3 text-left transition-colors {isBound
    ? ''
    : (provider.class ?? '')}"
  class:pointer-events-none={isBound && disabled}
  {onclick}
  disabled={!isBound && (busy || disabled)}
  aria-busy={busy}
>
  <div
    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors {isBound
      ? 'not-group-hover:bg-green-500/20'
      : 'not-group-hover:bg-base-300'}"
  >
    {#if busy}
      <i class="fa-solid fa-spinner fa-spin fa-lg"></i>
    {:else}
      <ProviderIcon
        icon={provider.icon}
        name={provider.name}
        class="fa-lg {isBound ? 'transition-colors group-hover:text-white' : ''}"
      />
    {/if}
  </div>
  <div class="min-w-0 flex-1">
    <span class="block font-medium {isBound ? 'transition-colors group-hover:text-white' : ''}">
      {provider.name}
    </span>
    {#if subtitle}
      {@render subtitle()}
    {:else if isBound}
      <p class="text-success text-xs group-hover:hidden">{m.bound()}</p>
      <p class="text-xs text-current/60 not-group-hover:hidden">{m.click_to_unbind()}</p>
    {:else if variant === 'bind'}
      <p class="text-xs text-current/60">{m.click_to_bind()}</p>
    {/if}
  </div>
  {#if isBound}
    <div class="grid place-items-center">
      <i
        class="fa-solid fa-check text-success col-start-1 row-start-1 transition-opacity group-hover:opacity-0"
      ></i>
      <i
        class="fa-solid fa-minus text-error col-start-1 row-start-1 opacity-0 mix-blend-difference transition-opacity group-hover:opacity-100"
      ></i>
    </div>
  {:else}
    <i class="fa-solid fa-plus text-primary mix-blend-difference"></i>
  {/if}
</button>
