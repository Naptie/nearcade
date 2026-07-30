<script lang="ts">
  /**
   * A reusable bottom-sheet drawer for mobile/narrow screens.
   *
   * On narrow screens (< md): renders a fixed bottom sheet with a draggable
   * handle bar, snap points, velocity-based snapping, and drag-to-close.
   * On wider screens (>= md): renders children inline with no wrapper.
   *
   * The component is intentionally minimal in visual styling — pass your own
   * background/border/shadow classes via the `class` prop.
   */
  import { viewport } from '$lib/utils/viewport.svelte';

  type Props = {
    /** Whether the drawer is open (mobile only). Bindable. */
    open?: boolean;
    /** Snap points as fractions of viewport height, ascending. Default [0.15, 0.5, 0.85] */
    snapPoints?: number[];
    /** Initial snap index used when the drawer opens. Default 1 (middle). */
    initialSnap?: number;
    /** Whether to show a backdrop behind the drawer when open. Default false. */
    backdrop?: boolean;
    /** Additional classes for the mobile drawer container (bg, border, shadow, z-index, etc.) */
    class?: string;
    children: import('svelte').Snippet;
  };

  let {
    open = $bindable(false),
    snapPoints = [0.15, 0.5, 0.85],
    initialSnap = 1,
    backdrop = false,
    class: className = '',
    children
  }: Props = $props();

  const isNarrow = $derived(!viewport.md);

  // ---- Internal drag state ----
  let currentSnap = $state(0);
  let dragHeightPx = $state<number | null>(null);
  let isDragging = $state(false);
  let dragStartY = 0;
  let dragStartHeight = 0;
  let lastMoveY = 0;
  let lastMoveTime = 0;
  let velocity = 0;

  // ---- Smart scroll state ----
  let contentEl = $state<HTMLDivElement | null>(null);
  let isTouchActive = $state(false);
  let scrollTouchId: number | null = null;
  let lastTouchY = 0;

  const canScrollUp = (): boolean => {
    if (!contentEl) return false;
    return contentEl.scrollTop > 0;
  };

  const canExpandDrawer = (): boolean => currentSnap < snapPoints.length - 1;
  const canCollapseDrawer = (): boolean => currentSnap > 0;

  const currentHeightPx = $derived.by(() => {
    if (dragHeightPx !== null) return dragHeightPx;
    return snapPoints[currentSnap] * window.innerHeight;
  });

  const clampedHeightPx = $derived(
    Math.max(
      snapPoints[0] * window.innerHeight,
      Math.min(snapPoints[snapPoints.length - 1] * window.innerHeight, currentHeightPx)
    )
  );

  const snapToNearest = (heightPx: number, vel: number) => {
    const vh = window.innerHeight;
    const fraction = heightPx / vh;

    // Close if dragged well below the lowest snap point
    const closeThreshold = snapPoints[0] * 0.5;
    if (fraction < closeThreshold || (vel > 0.8 && fraction < snapPoints[0] * 1.2)) {
      open = false;
      return;
    }

    // Velocity-based snap: positive velocity = dragging down = collapse
    if (Math.abs(vel) > 0.5) {
      if (vel > 0 && currentSnap > 0) currentSnap--;
      else if (vel < 0 && currentSnap < snapPoints.length - 1) currentSnap++;
      return;
    }

    // Otherwise find nearest snap point
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < snapPoints.length; i++) {
      const dist = Math.abs(snapPoints[i] - fraction);
      if (dist < minDist) {
        minDist = dist;
        nearest = i;
      }
    }
    currentSnap = nearest;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!isNarrow) return;
    isDragging = true;
    dragStartY = e.clientY;
    dragStartHeight = clampedHeightPx;
    dragHeightPx = dragStartHeight;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    lastMoveY = e.clientY;
    lastMoveTime = performance.now();
    velocity = 0;
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging) return;
    const now = performance.now();
    const dy = e.clientY - dragStartY;
    const newHeight = dragStartHeight - dy;
    const minH = snapPoints[0] * window.innerHeight * 0.3;
    const maxH = snapPoints[snapPoints.length - 1] * window.innerHeight;
    dragHeightPx = Math.max(minH, Math.min(maxH, newHeight));

    if (lastMoveTime > 0) {
      const dt = now - lastMoveTime;
      if (dt > 0) velocity = (e.clientY - lastMoveY) / dt;
    }
    lastMoveY = e.clientY;
    lastMoveTime = now;
  };

  const onPointerUp = () => {
    if (!isDragging) return;
    isDragging = false;
    snapToNearest(dragHeightPx ?? clampedHeightPx, velocity);
    dragHeightPx = null;
    velocity = 0;
    lastMoveTime = 0;
  };

  const onContentTouchStart = (e: TouchEvent) => {
    if (!contentEl || isDragging) return;
    const touch = e.touches[0];
    scrollTouchId = touch.identifier;
    lastTouchY = touch.clientY;
    // Seed dragHeightPx immediately so the CSS transition is suppressed from
    // the very first pixel of movement — no perceptible "deadzone".
    dragHeightPx = clampedHeightPx;
    isTouchActive = true;
  };

  const onContentTouchMove = (e: TouchEvent) => {
    if (!contentEl || !isTouchActive || scrollTouchId === null || isDragging) return;

    const touch = Array.from(e.touches).find((t) => t.identifier === scrollTouchId);
    if (!touch) return;

    // dy > 0: finger moved up → content moves up (scrolling down to see more below)
    // dy < 0: finger moved down → content moves down (scrolling up to see more above)
    const dy = lastTouchY - touch.clientY;

    if (dy > 0) {
      // Finger up: expand drawer first before letting content scroll down
      if (canExpandDrawer()) {
        e.preventDefault();
        dragHeightPx = Math.min(
          snapPoints[snapPoints.length - 1] * window.innerHeight,
          clampedHeightPx + dy
        );
      }
      // Drawer at max — let content scroll naturally
    } else if (dy < 0) {
      // Finger down: collapse drawer only when content is already at the top
      if (!canScrollUp() && canCollapseDrawer()) {
        e.preventDefault();
        const newHeight = Math.max(snapPoints[0] * window.innerHeight, clampedHeightPx + dy);
        dragHeightPx = newHeight;
        if (newHeight < snapPoints[0] * window.innerHeight * 0.5) {
          open = false;
        }
      }
      // Content not at top — let content scroll naturally
    }

    lastTouchY = touch.clientY;
  };

  const onContentTouchEnd = () => {
    if (dragHeightPx !== null && !isDragging) {
      // Only snap if the height actually changed from the seeded value
      snapToNearest(dragHeightPx, 0);
    }
    dragHeightPx = null;
    isTouchActive = false;
    scrollTouchId = null;
  };

  // Attach touchmove with { passive: false } so preventDefault() works.
  // Svelte's ontouchmove attribute registers passive listeners which can't preventDefault.
  $effect(() => {
    const el = contentEl;
    if (!el) return;
    el.addEventListener('touchmove', onContentTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onContentTouchMove);
  });

  // Reset snap when opening
  $effect(() => {
    if (open) {
      currentSnap = initialSnap;
    }
  });
</script>

{#if isNarrow}
  <!-- Mobile: bottom-sheet drawer -->
  {#if backdrop && open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-200 bg-black/40 {open
        ? 'opacity-100'
        : 'opacity-0'} pointer-events-auto transition-opacity duration-300"
      onclick={() => (open = false)}
      onkeydown={(e) => e.key === 'Escape' && (open = false)}
    ></div>
  {/if}

  <div
    class="pointer-events-auto fixed inset-x-0 bottom-0 z-250 flex flex-col overflow-hidden rounded-t-2xl
           {isDragging || isTouchActive ? '' : 'transition-[height] duration-300 ease-out'}
           {className}"
    style="height: {open ? clampedHeightPx : 0}px; {open ? '' : 'pointer-events: none;'}"
    role="dialog"
    aria-modal="true"
  >
    <!-- Drag handle -->
    <div
      role="separator"
      aria-label="Resize drawer"
      class="flex shrink-0 cursor-grab touch-none items-center justify-center py-2 active:cursor-grabbing {open
        ? 'opacity-100'
        : 'opacity-0'} pointer-events-auto transition-opacity duration-200"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
    >
      <div class="bg-base-content/25 h-1.5 w-12 rounded-full"></div>
    </div>

    <!-- Content -->
    <div
      bind:this={contentEl}
      role="region"
      aria-label="Drawer content"
      class="min-h-0 flex-1 overflow-y-auto {open
        ? 'opacity-100'
        : 'opacity-0'} pointer-events-auto transition-opacity duration-200"
      ontouchstart={onContentTouchStart}
      ontouchend={onContentTouchEnd}
      ontouchcancel={onContentTouchEnd}
    >
      {@render children()}
    </div>
  </div>
{/if}
