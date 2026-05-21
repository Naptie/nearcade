<script module lang="ts">
  interface PointerApproachRegistration {
    element: HTMLElement;
    isEnabled: () => boolean;
    update: (nearby: boolean) => void;
    rect: DOMRectReadOnly | null;
    nearby: boolean;
    dirty: boolean;
    observer: ResizeObserver | null;
  }

  const POINTER_APPROACH_RADIUS = 60;
  const POINTER_APPROACH_MEDIA_QUERY = '(any-hover: hover) and (any-pointer: fine)';

  const pointerApproachRegistrations: PointerApproachRegistration[] = [];

  let pointerApproachFrame = 0;
  let pointerApproachX = 0;
  let pointerApproachY = 0;
  let hasPointerApproachPosition = false;
  let pointerApproachMediaQuery: MediaQueryList | null = null;
  let stopPointerApproachTracking: (() => void) | null = null;

  const getPointerApproachMediaQuery = () => {
    if (!pointerApproachMediaQuery) {
      pointerApproachMediaQuery = window.matchMedia(POINTER_APPROACH_MEDIA_QUERY);
    }

    return pointerApproachMediaQuery;
  };

  const canTrackPointerApproach = () => {
    return (
      typeof window !== 'undefined' &&
      'PointerEvent' in window &&
      getPointerApproachMediaQuery().matches
    );
  };

  const setPointerApproachState = (registration: PointerApproachRegistration, nearby: boolean) => {
    if (registration.nearby === nearby) return;

    registration.nearby = nearby;
    registration.update(nearby);
  };

  const refreshPointerApproachRect = (registration: PointerApproachRegistration) => {
    registration.rect = registration.element.getBoundingClientRect();
    registration.dirty = false;
  };

  const clearPointerApproachState = () => {
    hasPointerApproachPosition = false;

    for (const registration of pointerApproachRegistrations) {
      setPointerApproachState(registration, false);
    }
  };

  const runPointerApproachFrame = () => {
    pointerApproachFrame = 0;

    if (!canTrackPointerApproach() || !hasPointerApproachPosition) {
      clearPointerApproachState();
      return;
    }

    const radiusSquared = POINTER_APPROACH_RADIUS * POINTER_APPROACH_RADIUS;

    for (const registration of pointerApproachRegistrations) {
      if (!registration.isEnabled()) {
        setPointerApproachState(registration, false);
        continue;
      }

      if (registration.dirty || !registration.rect) {
        refreshPointerApproachRect(registration);
      }

      const rect = registration.rect;
      if (!rect) {
        setPointerApproachState(registration, false);
        continue;
      }

      const dx =
        pointerApproachX < rect.left
          ? rect.left - pointerApproachX
          : pointerApproachX > rect.right
            ? pointerApproachX - rect.right
            : 0;
      const dy =
        pointerApproachY < rect.top
          ? rect.top - pointerApproachY
          : pointerApproachY > rect.bottom
            ? pointerApproachY - rect.bottom
            : 0;

      setPointerApproachState(registration, dx * dx + dy * dy <= radiusSquared);
    }
  };

  const schedulePointerApproachFrame = () => {
    if (pointerApproachFrame || typeof window === 'undefined') return;

    pointerApproachFrame = window.requestAnimationFrame(runPointerApproachFrame);
  };

  const markPointerApproachRectsDirty = () => {
    for (const registration of pointerApproachRegistrations) {
      registration.dirty = true;
    }

    schedulePointerApproachFrame();
  };

  const startPointerApproachTracking = () => {
    if (stopPointerApproachTracking || typeof window === 'undefined') return;

    const scrollOptions = { capture: true, passive: true } as const;

    const handlePointerMove = (event: PointerEvent) => {
      if (!canTrackPointerApproach()) return;

      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
        return;
      }

      pointerApproachX = event.clientX;
      pointerApproachY = event.clientY;
      hasPointerApproachPosition = true;
      schedulePointerApproachFrame();
    };

    const handlePointerOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) {
        clearPointerApproachState();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        markPointerApproachRectsDirty();
        return;
      }

      clearPointerApproachState();
    };

    const handleSupportChange = () => {
      markPointerApproachRectsDirty();

      if (!canTrackPointerApproach()) {
        clearPointerApproachState();
      }
    };

    const mediaQuery = getPointerApproachMediaQuery();

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerout', handlePointerOut, { passive: true });
    window.addEventListener('resize', markPointerApproachRectsDirty, { passive: true });
    window.addEventListener('scroll', markPointerApproachRectsDirty, scrollOptions);
    window.addEventListener('blur', clearPointerApproachState);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    mediaQuery.addEventListener('change', handleSupportChange);

    stopPointerApproachTracking = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerout', handlePointerOut);
      window.removeEventListener('resize', markPointerApproachRectsDirty);
      window.removeEventListener('scroll', markPointerApproachRectsDirty, true);
      window.removeEventListener('blur', clearPointerApproachState);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      mediaQuery.removeEventListener('change', handleSupportChange);

      if (pointerApproachFrame) {
        window.cancelAnimationFrame(pointerApproachFrame);
        pointerApproachFrame = 0;
      }
    };
  };

  const registerPointerApproach = (
    element: HTMLElement,
    isEnabled: () => boolean,
    update: (nearby: boolean) => void
  ) => {
    const registration: PointerApproachRegistration = {
      element,
      isEnabled,
      update,
      rect: null,
      nearby: false,
      dirty: true,
      observer: null
    };

    if (typeof ResizeObserver !== 'undefined') {
      registration.observer = new ResizeObserver(() => {
        registration.dirty = true;
        schedulePointerApproachFrame();
      });

      registration.observer.observe(element);
    }

    pointerApproachRegistrations.push(registration);
    startPointerApproachTracking();
    schedulePointerApproachFrame();

    return () => {
      registration.observer?.disconnect();
      registration.nearby = false;
      const registrationIndex = pointerApproachRegistrations.indexOf(registration);
      if (registrationIndex !== -1) {
        pointerApproachRegistrations.splice(registrationIndex, 1);
      }

      if (!pointerApproachRegistrations.length && stopPointerApproachTracking) {
        stopPointerApproachTracking();
        stopPointerApproachTracking = null;
      }
    };
  };
</script>

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
    stayExpandedOnWideScreens?: boolean;
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
    override = false,
    stayExpandedOnWideScreens = false
  }: Props = $props();

  let buttonElement: HTMLElement;
  let iconElement: HTMLElement | undefined = $state(undefined);
  let contentElement: HTMLElement;
  let initialWidth = $state(NaN);
  let lastMeasured = $state(0);
  let timeout = $state<ReturnType<typeof setTimeout> | null>(null);
  let windowWidth = $state(browser ? window.innerWidth : 0);
  let isHovered = $state(false);
  let isNearby = $state(false);
  let stayExpanded = $derived(windowWidth >= 1280 && stayExpandedOnWideScreens);

  const clearCollapseTimeout = () => {
    if (!timeout) return;

    clearTimeout(timeout);
    timeout = null;
  };

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
    if (window.matchMedia('(any-hover: hover)').matches && !override) {
      clearCollapseTimeout();
      isHovered = true;
    }
  };

  const handleMouseLeave = () => {
    if (!override) {
      clearCollapseTimeout();
      timeout = setTimeout(() => {
        isHovered = false;
        timeout = null;
      }, 600);
    }
  };

  onMount(() => {
    initialWidth = buttonElement.offsetWidth;
    // Set initial width to avoid layout jank
    buttonElement.style.width = 'var(--collapsed-width, 3rem)'; // Provide a fallback

    const cleanupPointerApproach = registerPointerApproach(
      buttonElement,
      () => !override && !stayExpanded,
      (nearby) => {
        isNearby = nearby;
      }
    );

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

    // Window resize observer for tracking window width in real-time
    const handleResize = () => {
      windowWidth = window.innerWidth;
    };

    if (stayExpandedOnWideScreens) {
      window.addEventListener('resize', handleResize);
    }

    return () => {
      // Ensure the observer is disconnected when the component is destroyed
      cleanup.then((cleanupFn) => cleanupFn && cleanupFn());
      cleanupPointerApproach();
      clearCollapseTimeout();
      if (stayExpandedOnWideScreens) {
        window.removeEventListener('resize', handleResize);
      }
    };
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

  $effect(() => {
    if (override || stayExpanded) {
      isNearby = false;
      return;
    }

    if (buttonElement) {
      markPointerApproachRectsDirty();
    }
  });

  $effect(() => {
    if ((stayExpanded || isHovered || isNearby) && !override) {
      expanded = true;
    }
    if (!stayExpanded && !isHovered && !isNearby && !override) {
      expanded = false;
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

  @media not (any-hover: hover) {
    .icon,
    .content {
      transform: none !important;
    }
    .content {
      @apply opacity-0!;
    }
  }
</style>
