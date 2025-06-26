<script lang="ts">
  import { browser } from '$app/environment';
  import { preloadCode, preloadData } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';

  interface Props {
    text: string;
    class: string;
    btnCls?: string;
    href?: string;
    callback?: () => void;
  }

  let { text, class: klass, btnCls, href, callback }: Props = $props();

  let buttonElement: HTMLElement;
  let iconElement: HTMLElement;
  let textElement: HTMLElement;
  let collapsedWidth = $state('auto');
  let expandedWidth = $state('auto');
  let iconTranslateX = $state('0px');
  let textTranslateX = $state('0px');

  const measureButtonDimensions = () => {
    if (!buttonElement || !iconElement || !textElement) return;

    const buttonHeight = buttonElement.offsetHeight;
    collapsedWidth = `${buttonHeight}px`;

    // Temporarily show the button at full width to measure
    const originalWidth = buttonElement.style.width;
    const originalTextOpacity = textElement.style.opacity;
    const originalTextPosition = textElement.style.position;

    buttonElement.style.width = 'auto';
    textElement.style.opacity = '1';
    textElement.style.position = 'static';
    textElement.style.transform = 'none';

    const fullWidth = buttonElement.scrollWidth;
    const iconWidth = iconElement.offsetWidth;
    const textWidth = textElement.offsetWidth;

    // Calculate positioning for expanded state
    const gap = 8; // Gap between icon and text
    const totalContentWidth = iconWidth + gap + textWidth;
    const buttonCenter = fullWidth / 2;
    const contentStart = buttonCenter - totalContentWidth / 2;

    // Calculate how much to move the icon from center to left position
    iconTranslateX = `${contentStart - buttonCenter + iconWidth / 2}px`;

    // Calculate text position - it should be at center initially, then move to right of icon
    const textFinalPosition = contentStart + iconWidth + gap;
    textTranslateX = `${textFinalPosition - buttonCenter}px`;

    // Restore original state
    buttonElement.style.width = originalWidth;
    textElement.style.opacity = originalTextOpacity;
    textElement.style.position = originalTextPosition;
    textElement.style.transform = '';

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
    if (browser) {
      if (buttonElement) {
        measureButtonDimensions();
        buttonElement.style.width = collapsedWidth;
      }
      window.addEventListener('resize', measureButtonDimensions);
    }
  });

  onDestroy(() => {
    if (browser) {
      window.removeEventListener('resize', measureButtonDimensions);
    }
  });

  // Remeasure when text changes
  $effect(() => {
    measureButtonDimensions();
  });
</script>

<a
  bind:this={buttonElement}
  {href}
  class="btn btn-ghost btn-sm lg:btn-md adaptive group relative items-center justify-center overflow-hidden whitespace-nowrap {btnCls}"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onclick={() => {
    if (callback) {
      callback();
    }
  }}
  style="--collapsed-width: {collapsedWidth}; --icon-translate-x: {iconTranslateX}; --text-translate-x: {textTranslateX};"
>
  <i bind:this={iconElement} class="icon {klass}"></i>
  <span bind:this={textElement} class="text">{text}</span>
</a>

<style lang="postcss">
  @reference "tailwindcss";

  .adaptive {
    transition: width;
    width: var(--collapsed-width);
    @apply duration-200 ease-out;
  }

  .icon {
    @apply relative z-2 transition-transform duration-200 ease-out;
  }

  .text {
    transform: translateY(-50%) translateX(-50%);
    @apply pointer-events-none absolute top-[50%] left-[50%] z-1 opacity-0 transition duration-200 ease-out;
  }

  .group:hover .icon {
    transform: translateX(var(--icon-translate-x));
  }

  .group:hover .text {
    transform: translateY(-50%) translateX(var(--text-translate-x));
    @apply opacity-100;
  }

  @media not (hover: hover) {
    .adaptive {
      width: var(--collapsed-width) !important;
    }

    .icon {
      transform: none !important;
    }

    .text {
      transform: translateY(-50%) translateX(-50%) !important;
      @apply !opacity-0;
    }
  }
</style>
