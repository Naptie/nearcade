<script lang="ts">
  import { m } from '$lib/paraglide/messages';

  interface Props {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmButtonClass?: string;
    onConfirm: () => void;
    onCancel: () => void;
  }

  let {
    isOpen = $bindable(),
    title,
    message,
    confirmText = m.confirm(),
    cancelText = m.cancel(),
    confirmButtonClass = 'btn-error',
    onConfirm,
    onCancel
  }: Props = $props();

  const handleConfirm = () => {
    onConfirm();
    isOpen = false;
  };

  const handleCancel = () => {
    onCancel();
    isOpen = false;
  };
</script>

<div class="modal" class:modal-open={isOpen}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">{title}</h3>
    <p class="py-4">{message}</p>
    <div class="modal-action">
      <button class="btn btn-ghost" onclick={handleCancel}>
        {cancelText}
      </button>
      <button class="btn {confirmButtonClass}" onclick={handleConfirm}>
        {confirmText}
      </button>
    </div>
  </div>
</div>
