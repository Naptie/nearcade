<script lang="ts">
  import { browser } from '$app/environment';
  import { preloadCode, preloadData } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';
  import { onMount } from 'svelte';

  interface Props {
    class?: string;
    btnCls?: string;
    square?: boolean;
    padding?: number;
    href?: string;
    target?: string;
    text?: string;
    image?: string;
    content?: () => ReturnType<import('svelte').Snippet>;
    callback?: () => void;
    expanded?: boolean;
    override?: boolean;
  }

  let {
    image,
    content,
    text,
    class: klass = '',
    btnCls = 'btn-ghost btn-sm lg:btn-md',
    square = true,
    padding = 0,
    href,
    target,
    callback,
    expanded = $bindable(false),
    override = false
  }: Props = $props();

  let buttonElement: HTMLElement;
  let iconElement: HTMLElement | undefined = $state(undefined);
  let contentElement: HTMLElement;
  let initialWidth = $state(NaN);
  let lastMeasured = $state(0);
  let timeout = $state<ReturnType<typeof setTimeout> | null>(null);

  const measureButtonDimensions = () => {
    if (!browser || !buttonElement || !iconElement || !contentElement) return;
    if (Date.now() - lastMeasured < 1000) return;
    lastMeasured = Date.now();

    const buttonHeight = buttonElement.offsetHeight;
    const collapsedWidth = `${square ? buttonHeight : initialWidth}px`;

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

    const fullWidth = clone.scrollWidth + padding;
    const iconWidth = (clone.querySelector('.icon') as HTMLElement).offsetWidth;
    const contentWidth = cloneContent.offsetWidth;

    document.body.removeChild(clone); // Clean up the clone

    // --- Calculations ---
    const gap = 8; // Gap between icon and content
    const totalContentWidth = iconWidth + gap + contentWidth;
    const buttonCenter = fullWidth / 2;
    const startPosition = buttonCenter - totalContentWidth / 2;

    const iconTranslateX = image
      ? `${buttonHeight / 2 - buttonCenter}px`
      : `${startPosition - buttonCenter + iconWidth / 2}px`;
    const contentFinalPosition = image ? buttonHeight : startPosition + iconWidth + gap;
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
    if (window.matchMedia('(hover: hover)').matches && !override) {
      clearTimeout(timeout!);
      expanded = true;
    }
  };

  const handleMouseLeave = () => {
    if (!override) {
      timeout = setTimeout(() => {
        expanded = false;
      }, 600);
    }
  };

  onMount(() => {
    if (browser) {
      initialWidth = buttonElement.offsetWidth;
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

  $effect(() => {
    if (text || content) {
      measureButtonDimensions();
    }
  });

  $effect(() => {
    if (buttonElement) {
      if (expanded) {
        buttonElement.style.width = 'var(--expanded-width)';
      } else {
        buttonElement.style.width = 'var(--collapsed-width)';
      }
    }
  });
</script>

<a
  bind:this={buttonElement}
  {href}
  {target}
  class="btn adaptive group relative items-center justify-center overflow-hidden whitespace-nowrap {image
    ? 'px-2'
    : ''} {btnCls}"
  class:expanded
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onclick={() => {
    if (callback) {
      callback();
    }
  }}
>
  {#if image || !klass.includes('fa-')}
    <div bind:this={iconElement} class="avatar icon {image ? '' : 'avatar-placeholder'}">
      <div class="w-5.5 lg:w-7 {klass} {image ? '' : 'bg-neutral text-neutral-content'}">
        {#if image}
          <img src={image} alt={m.icon()} />
        {:else if text}
          <span class="text-xs lg:text-sm">{text.trim()[0]}</span>
        {/if}
      </div>
    </div>
  {:else}
    <i bind:this={iconElement} class="icon {klass}"></i>
  {/if}
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
    transition:
      width 0.15s cubic-bezier(0.33, 1, 0.68, 1),
      flex 0.15s cubic-bezier(0.33, 1, 0.68, 1),
      color 0.2s cubic-bezier(0, 0, 0.2, 1),
      background-color 0.2s cubic-bezier(0, 0, 0.2, 1),
      border-color 0.2s cubic-bezier(0, 0, 0.2, 1);
  }

  .icon {
    @apply z-2 transition-transform duration-150 ease-out;
  }

  .content {
    transform: translateY(-50%) translateX(-50%);
    @apply pointer-events-none absolute top-[50%] left-[50%] z-1 opacity-0 transition duration-200 ease-out;
  }

  .group:hover .icon,
  .expanded .icon {
    transform: translateX(var(--icon-translate-x));
  }

  .group:hover .content,
  .expanded .content {
    transform: translateY(-50%) translateX(var(--content-translate-x));
    @apply opacity-100;
  }

  @media not (hover: hover) {
    .icon,
    .content {
      transform: none !important;
    }
    .content {
      @apply !opacity-0;
    }
  }
</style>
