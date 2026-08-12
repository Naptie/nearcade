<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ToastType } from '$lib/notifications/toast.svelte';

  interface Props {
    type: ToastType;
    icon?: string;
    /** Optional bold heading shown above the content. */
    title?: string;
    /** Use the daisyUI soft variant styling. */
    soft?: boolean;
    class?: string;
    children?: Snippet;
  }

  let { type, icon, title, soft = false, class: klass = '', children }: Props = $props();

  const TYPE_ICONS: Record<ToastType, string> = {
    success: 'fa-circle-check',
    error: 'fa-triangle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };
</script>

<div class="alert alert-{type} {soft ? 'alert-soft' : ''} {klass}" role="alert">
  <i class="fa-solid {icon ?? TYPE_ICONS[type]} shrink-0"></i>
  {#if title}
    <div class="min-w-0 flex-1 text-left">
      <h3 class="font-bold">{title}</h3>
      <div class="text-base-content/90">
        {@render children?.()}
      </div>
    </div>
  {:else}
    <div class="min-w-0 flex-1 wrap-break-word">{@render children?.()}</div>
  {/if}
</div>
