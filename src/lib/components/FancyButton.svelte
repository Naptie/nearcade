<script lang="ts">
  import { preloadCode, preloadData } from '$app/navigation';
  import { onMount } from 'svelte';

  interface Props {
    text: string;
    class: string;
    btnCls?: string;
    href?: string;
    callback?: () => void;
  }

  let { text, class: klass, btnCls, href, callback }: Props = $props();

  let buttonElement: HTMLElement;
  let collapsedWidth = $state('3rem');
  let expandedWidth = $state('auto');

  const measureButtonWidth = () => {
    if (!buttonElement) return;

    const originalWidth = buttonElement.style.width;
    buttonElement.style.width = 'auto';
    const fullWidth = buttonElement.scrollWidth;
    buttonElement.style.width = originalWidth;

    expandedWidth = `${fullWidth}px`;
  };

  const handleMouseEnter = () => {
    if (href) {
      preloadCode(href);
      preloadData(href);
    }
    if (buttonElement && window.matchMedia('(hover: hover)').matches) {
      buttonElement.style.width = expandedWidth;
    }
  };

  const handleMouseLeave = () => {
    if (buttonElement) {
      buttonElement.style.width = collapsedWidth;
    }
  };

  onMount(() => {
    if (buttonElement) {
      measureButtonWidth();
      buttonElement.style.width = collapsedWidth;
    }
  });
</script>

<a
  bind:this={buttonElement}
  {href}
  class="btn btn-ghost btn-sm adaptive group items-center justify-start gap-2 overflow-hidden whitespace-nowrap {btnCls}"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onclick={() => {
    if (callback) {
      callback();
    }
  }}
  style="--collapsed-width: {collapsedWidth};"
>
  <i class={klass}></i>
  <span class="opacity-0 transition group-hover:opacity-100">{text}</span>
</a>

<style>
  .adaptive {
    transition: width 0.2s ease-out;
    width: var(--collapsed-width);
  }

  @media not (hover: hover) {
    .adaptive {
      width: var(--collapsed-width) !important;
    }
  }
</style>
