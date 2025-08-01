<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import FancyButton from './FancyButton.svelte';

  interface Props {
    name: string;
    class: string;
    description?: string;
    image?: string;
    href?: string;
  }

  let { name, class: klass, description, image, href }: Props = $props();

  let dialogElement: HTMLDialogElement | undefined = $state(undefined);

  // Close modal when clicking backdrop
  const handleDialogClick = (event: MouseEvent) => {
    if (event.target === dialogElement) {
      dialogElement.close();
    }
  };

  // Close modal on Escape key
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      dialogElement?.close();
    }
  };
</script>

<FancyButton
  callback={() => {
    dialogElement?.showModal();
  }}
  class={klass}
  text={name}
  {href}
/>

{#if description || image}
  <dialog
    bind:this={dialogElement}
    class="modal"
    onclick={handleDialogClick}
    onkeydown={handleKeydown}
  >
    <div class="modal-box relative max-h-[90vh] max-w-xl">
      <button
        class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2"
        onclick={() => {
          dialogElement?.close();
        }}
        aria-label={m.close_modal()}
      >
        <i class="fa-solid fa-xmark fa-lg"></i>
      </button>

      <div class="text-center">
        <h3 class="mb-4 text-lg font-bold">{name}</h3>
        {#if description}
          <p class="mb-6 text-sm opacity-75">
            {description}
          </p>
        {/if}
        {#if image}
          <div class="mb-6 flex justify-center">
            <img
              src={image}
              alt="{m.image_for_social_media()} {name}"
              class="max-h-[50vh] w-fit rounded-xl object-contain shadow-lg"
            />
          </div>
        {/if}
      </div>
    </div>
  </dialog>
{/if}
