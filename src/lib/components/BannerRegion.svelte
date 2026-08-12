<script lang="ts">
  import { fly } from 'svelte/transition';
  import { m } from '$lib/paraglide/messages';
  import { bannerStore, type BannerItem } from '$lib/notifications/banner.svelte';
  import type { ToastType } from '$lib/notifications/toast.svelte';

  const TYPE_ICONS: Record<ToastType, string> = {
    success: 'fa-circle-check',
    error: 'fa-triangle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  const handleAction = (banner: BannerItem) => {
    bannerStore.dismiss(banner.id, true);
    banner.action?.onClick?.();
  };
</script>

<div
  class="pointer-events-none fixed inset-x-0 bottom-0 z-1150 flex flex-col items-center gap-2 px-4 pb-4"
>
  {#each bannerStore.banners as banner (banner.id)}
    <div
      class="alert alert-soft alert-{banner.type} border-2 border-{banner.type} pointer-events-auto w-full max-w-3xl gap-2 shadow-lg"
      role="alert"
      transition:fly={{ y: 32, duration: 300 }}
    >
      <i class="fa-solid {banner.icon ?? TYPE_ICONS[banner.type]} shrink-0"></i>

      <div class="min-w-0 flex-1">
        {#if banner.title}
          <h3 class="font-bold">{banner.title}</h3>
        {/if}
        <span class="block text-left wrap-break-word">{banner.message}</span>
      </div>

      {#if banner.action}
        {#if banner.action.href}
          <a href={banner.action.href} class="btn btn-{banner.type} btn-sm shrink-0">
            {banner.action.label}
          </a>
        {:else}
          <button
            type="button"
            class="btn btn-{banner.type} btn-sm shrink-0"
            onclick={() => handleAction(banner)}
          >
            {banner.action.label}
          </button>
        {/if}
      {/if}

      {#if banner.dismissible}
        <button
          type="button"
          class="btn btn-circle btn-ghost btn-xs shrink-0"
          onclick={() => bannerStore.dismiss(banner.id, true)}
          aria-label={m.close()}
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      {/if}
    </div>
  {/each}
</div>
