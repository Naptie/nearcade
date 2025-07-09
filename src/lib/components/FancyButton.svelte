<script lang="ts">
  import { browser } from '$app/environment';
  import { preloadCode, preloadData } from '$app/navigation';
  import { onMount, tick } from 'svelte';

  interface Props {
    class: string;
    btnCls?: string;
    href?: string;
    target?: string;
    text?: string;
    content?: () => ReturnType<import('svelte').Snippet>;
    callback?: () => void;
  }

  let { content, text, class: klass, btnCls, href, target, callback }: Props = $props();

  let buttonElement: HTMLElement;
  let iconElement: HTMLElement;
  let contentElement: HTMLElement;
  let collapsedWidth = $state('auto');
  let expandedWidth = $state('auto');
  let iconTranslateX = $state('0px');
  let contentTranslateX = $state('0px');

  const measureButtonDimensions = () => {
    if (!buttonElement || !iconElement || !contentElement) return;

    const buttonHeight = buttonElement.offsetHeight;
    collapsedWidth = `${buttonHeight}px`;

    // Temporarily show the button at full width to measure
    const originalWidth = buttonElement.style.width;
    const originalTextOpacity = contentElement.style.opacity;
    const originalTextPosition = contentElement.style.position;

    buttonElement.style.width = 'auto';
    contentElement.style.opacity = '1';
    contentElement.style.position = 'static';
    contentElement.style.transform = 'none';

    const fullWidth = buttonElement.scrollWidth;
    const iconWidth = iconElement.offsetWidth;
    const contentWidth = contentElement.offsetWidth;

    // Calculate positioning for expanded state
    const gap = 8; // Gap between icon and content
    const totalContentWidth = iconWidth + gap + contentWidth;
    const buttonCenter = fullWidth / 2;
    const contentStart = buttonCenter - totalContentWidth / 2;

    // Calculate how much to move the icon from center to left position
    iconTranslateX = `${contentStart - buttonCenter + iconWidth / 2}px`;

    // Calculate content position - it should be at center initially, then move to right of icon
    const contentFinalPosition = contentStart + iconWidth + gap;
    contentTranslateX = `${contentFinalPosition - buttonCenter}px`;

    // Restore original state
    buttonElement.style.width = originalWidth;
    contentElement.style.opacity = originalTextOpacity;
    contentElement.style.position = originalTextPosition;
    contentElement.style.transform = '';

    expandedWidth = `${fullWidth}px`;
  };

  const handleMouseEnter = () => {
    if (href && !href.startsWith('http')) {
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
        buttonElement.style.width = collapsedWidth;
        tick().then(() => {
          measureButtonDimensions();
        });
      }
      window.addEventListener('resize', measureButtonDimensions);
      return () => {
        window.removeEventListener('resize', measureButtonDimensions);
      };
    }
  });

  // Remeasure when content changes
  $effect(() => {
    measureButtonDimensions();
  });
</script>

<a
  bind:this={buttonElement}
  {href}
  {target}
  class="btn btn-ghost btn-sm lg:btn-md adaptive group relative items-center justify-center overflow-hidden whitespace-nowrap {btnCls}"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onclick={() => {
    if (callback) {
      callback();
    }
  }}
  style="--collapsed-width: {collapsedWidth}; --icon-translate-x: {iconTranslateX}; --content-translate-x: {contentTranslateX};"
>
  <i bind:this={iconElement} class="icon {klass}"></i>
  <div bind:this={contentElement} class="content">
    {#if content}
      {@render content()}
    {:else}
      {text}
    {/if}
  </div>
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

  .content {
    transform: translateY(-50%) translateX(-50%);
    @apply pointer-events-none absolute top-[50%] left-[50%] z-1 opacity-0 transition duration-200 ease-out;
  }

  .group:hover .icon {
    transform: translateX(var(--icon-translate-x));
  }

  .group:hover .content {
    transform: translateY(-50%) translateX(var(--content-translate-x));
    @apply opacity-100;
  }

  @media not (hover: hover) {
    .adaptive {
      width: var(--collapsed-width) !important;
    }

    .icon {
      transform: none !important;
    }

    .content {
      transform: translateY(-50%) translateX(-50%) !important;
      @apply !opacity-0;
    }
  }
</style>
