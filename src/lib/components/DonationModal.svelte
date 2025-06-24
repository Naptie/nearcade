<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { browser } from '$app/environment';

  let { isOpen, visitCount, onClose, onDismiss } = $props();

  let dialogElement: HTMLDialogElement;

  const DISMISS_DURATION_DAYS = 7;

  $effect(() => {
    if (!browser || !dialogElement) return;

    if (isOpen) {
      dialogElement.showModal();
    } else {
      dialogElement.close();
    }
  });

  // Close modal when clicking backdrop
  const handleDialogClick = (event: MouseEvent) => {
    if (event.target === dialogElement) {
      onClose();
    }
  };

  // Close modal on Escape key
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    }
  };
</script>

<dialog
  bind:this={dialogElement}
  class="modal"
  onclick={handleDialogClick}
  onkeydown={handleKeydown}
>
  <div class="modal-box relative max-w-xl">
    <!-- Close button -->
    <button
      class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2"
      onclick={onClose}
      aria-label="Close modal"
    >
      <i class="fa-solid fa-xmark"></i>
    </button>

    <!-- Modal content -->
    <div class="text-center">
      <h3 class="mb-4 text-lg font-bold">{m.donate()}</h3>

      <p class="mb-6 text-sm opacity-75">
        {m.donate_description({ count: visitCount })}
      </p>

      <!-- WeChat donation QR code -->
      <div class="mb-6 flex justify-center">
        <img
          src="/donate-wechat.png"
          alt="WeChat Donation QR Code"
          class="w-full rounded-lg shadow-lg"
        />
      </div>

      <div class="flex flex-col gap-2">
        <button class="btn btn-ghost btn-sm" onclick={() => onDismiss(DISMISS_DURATION_DAYS)}>
          {m.dismiss_in({ count: DISMISS_DURATION_DAYS })}
        </button>
      </div>
    </div>
  </div>
</dialog>
