<script lang="ts">
  import { fly } from 'svelte/transition';
  import { m } from '$lib/paraglide/messages';
  import { toastStore, type ToastType } from '$lib/notifications/toast.svelte';

  const TYPE_ICONS: Record<ToastType, string> = {
    success: 'fa-circle-check',
    error: 'fa-triangle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  const TYPE_BORDERS: Record<ToastType, string> = {
    success: 'border-success',
    error: 'border-error',
    warning: 'border-warning',
    info: 'border-info'
  };

  /**
   * Out-transition for the fake layout holder: it occupies exactly the toast's
   * original height and collapses to zero on exit, so the toasts below glide up
   * smoothly. The real toast is a child with `overflow: visible`, so its height
   * stays intact while it flies out to the right.
   */
  function collapseHeight(node: HTMLElement, { duration = 250 }: { duration?: number } = {}) {
    const height = node.offsetHeight;
    const marginBottom = parseFloat(getComputedStyle(node).marginBottom) || 0;
    return {
      duration,
      css: (t: number) => `
        height: ${t * height}px;
        margin-bottom: ${t * marginBottom}px;
      `
    };
  }
</script>

<!-- Anchored flush against the viewport's right edge so the fly-in/out starts
     at the actual page border. `overflow-hidden` swallows the slide (and the
     full-height toast poking out of the collapsing holder on exit) so it never
     creates a horizontal or vertical scrollbar. Kept always mounted so the
     keyed each block can play in/out transitions for the first and last toast. -->
<div
  class="pointer-events-none fixed top-0 right-0 z-1300 flex max-h-dvh flex-col overflow-hidden px-4 pt-16"
  aria-live="polite"
>
  {#each toastStore.toasts as t (t.id)}
    <!-- fake holder: keeps the toast's height in the layout, collapses on exit -->
    <div class="mb-2 w-full max-w-sm shrink-0" out:collapseHeight={{ duration: 250 }}>
      <div
        class="alert alert-soft {TYPE_BORDERS[
          t.type
        ]} alert-{t.type} pointer-events-auto relative z-10 w-full shadow-lg"
        role={t.type === 'error' ? 'alert' : 'status'}
        aria-live={t.type === 'error' ? 'assertive' : 'polite'}
        in:fly={{ x: '100%', duration: 250 }}
        out:fly={{ x: '100%', duration: 250 }}
      >
        <i class="fa-solid {t.icon ?? TYPE_ICONS[t.type]}"></i>
        <span class="min-w-0 flex-1 wrap-break-word">{t.message}</span>
        {#if t.action}
          {#if t.action.href}
            <a
              href={t.action.href}
              class="btn btn-primary btn-xs shrink-0"
              onclick={() => toastStore.dismiss(t.id)}
            >
              {t.action.label}
            </a>
          {:else}
            <button
              type="button"
              class="btn btn-primary btn-xs shrink-0"
              onclick={() => {
                toastStore.dismiss(t.id);
                t.action?.onClick?.();
              }}
            >
              {t.action.label}
            </button>
          {/if}
        {/if}
        <button
          type="button"
          class="btn btn-circle btn-ghost btn-xs shrink-0"
          onclick={() => toastStore.dismiss(t.id)}
          aria-label={m.close()}
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
  {/each}
</div>
