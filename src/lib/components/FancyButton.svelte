<script lang="ts">
  import { browser } from '$app/environment';
  import { preloadCode, preloadData } from '$app/navigation';
  import { onMount } from 'svelte';

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

  // No need for collapsedWidth, expandedWidth, etc. to be state.
  // We can set them directly as CSS custom properties.

  // --- REFACTORED MEASUREMENT LOGIC ---
  const measureButtonDimensions = () => {
    if (!browser || !buttonElement || !iconElement || !contentElement) return;

    const buttonHeight = buttonElement.offsetHeight;
    const collapsedWidth = `${buttonHeight}px`;

    // Set the collapsed width immediately
    buttonElement.style.setProperty('--collapsed-width', collapsedWidth);

    // --- Measure expanded state ---
    // Use a temporary clone to avoid flickering or layout shifts on the actual element
    const clone = buttonElement.cloneNode(true) as HTMLElement;
    const cloneContent = clone.querySelector('.content') as HTMLElement;
    clone.style.width = 'auto';
    clone.style.visibility = 'hidden';
    clone.style.position = 'absolute';
    clone.style.pointerEvents = 'none';
    if (cloneContent) {
      cloneContent.style.opacity = '1';
      cloneContent.style.position = 'static';
      cloneContent.style.transform = 'none';
    }

    document.body.appendChild(clone);

    const fullWidth = clone.scrollWidth;
    const iconWidth = (clone.querySelector('.icon') as HTMLElement).offsetWidth;
    const contentWidth = cloneContent.offsetWidth;

    document.body.removeChild(clone); // Clean up the clone

    // --- Calculations ---
    const gap = 8; // Gap between icon and content
    const totalContentWidth = iconWidth + gap + contentWidth;
    const buttonCenter = fullWidth / 2;
    const contentStart = buttonCenter - totalContentWidth / 2;

    const iconTranslateX = `${contentStart - buttonCenter + iconWidth / 2}px`;
    const contentFinalPosition = contentStart + iconWidth + gap;
    // The content is already centered by `left: 50%`, so we calculate its offset from that center.
    const contentTranslateX = `${contentFinalPosition - buttonCenter}px`;

    // Set the calculated values as CSS custom properties
    buttonElement.style.setProperty('--expanded-width', `${fullWidth}px`);
    buttonElement.style.setProperty('--icon-translate-x', iconTranslateX);
    buttonElement.style.setProperty('--content-translate-x', contentTranslateX);
  };

  const handleMouseEnter = () => {
    if (href && !href.startsWith('http')) {
      preloadCode(href);
      preloadData(href);
    }
    if (buttonElement && window.matchMedia('(hover: hover)').matches) {
      buttonElement.style.width = 'var(--expanded-width)';
    }
  };

  const handleMouseLeave = () => {
    if (buttonElement) {
      buttonElement.style.width = 'var(--collapsed-width)';
    }
  };

  onMount(() => {
    if (browser) {
      // Set initial width to avoid layout jank
      buttonElement.style.width = 'var(--collapsed-width, 3rem)'; // Provide a fallback

      const setupMeasurements = () => {
        // Run the initial measurement
        measureButtonDimensions();

        // Create a ResizeObserver to automatically remeasure if the button size changes
        const observer = new ResizeObserver(() => {
          measureButtonDimensions();
        });

        // Observe the button and its content for any size changes
        observer.observe(buttonElement);
        if (contentElement) {
          observer.observe(contentElement);
        }

        return () => {
          observer.disconnect();
        };
      };

      // Wait for fonts to be ready, then run our setup
      const cleanup = document.fonts.ready.then(setupMeasurements);

      return () => {
        // Ensure the observer is disconnected when the component is destroyed
        cleanup.then((cleanupFn) => cleanupFn && cleanupFn());
      };
    }
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
    width: var(--collapsed-width);
    transition: width 0.2s ease-out;
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
    .icon,
    .content {
      transform: none !important;
    }
    .content {
      @apply !opacity-0;
    }
  }
</style>
