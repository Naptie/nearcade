/**
 * Smooth width animation for MapLibre's compact attribution pill.
 *
 * MapLibre v6 expands and collapses the pill by toggling the
 * `maplibregl-compact-show` class and flipping the label between
 * `display: none` and `display: block`, which snaps. Padding and surface
 * colors animate through CSS transitions in `src/lib/styles/maplibre.css`;
 * the label's width and opacity animate here with the Web Animations API
 * because their start and end values follow the attribution text's
 * measured size.
 *
 * One document-level observer watches every `.maplibregl-ctrl-attrib` on
 * the page, so all map instances — discover, the globe and the location
 * picker — and any future ones are covered without per-map wiring. The
 * collapse on map drag (`_updateCompactMinimize` inside MapLibre) is
 * picked up the same way as clicks on the pill's button.
 */

import { browser } from '$app/environment';

const PILL_SELECTOR = '.maplibregl-ctrl-attrib.maplibregl-compact';
const INNER_SELECTOR = '.maplibregl-ctrl-attrib-inner';
const WIDTH_ANIM_ID = 'maplibre-attrib-width';
const ANIM_MS = 200;
const ANIM_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * The label's natural width plus the pill's expanded padding, remembered
 * while the pill is expanded (the only state where the label is rendered
 * and measurable), so a later collapse can animate from it and an expand
 * can target the width the label will actually occupy once the expanded
 * padding has landed — including the wrapped two-line layout when the
 * attribution text is wider than the screen.
 */
const expandedMetrics = new WeakMap<
  HTMLElement,
  { width: number; height: number; padLeft: number; padRight: number }
>();

/** Class toggles seen in the current observer batch, keyed by pill. */
const batchToggles = new Map<HTMLElement, string>();

let observer: MutationObserver | undefined;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function runningWidthAnimations(label: HTMLElement): Animation[] {
  return label.getAnimations().filter((animation) => animation.id === WIDTH_ANIM_ID);
}

/** Reset the animation-only inline styles we put on the pill and label. */
function clearAnimationStyles(pill: HTMLElement, label: HTMLElement): void {
  pill.style.height = '';
  pill.style.transition = '';
  pill.style.paddingLeft = '';
  pill.style.paddingRight = '';
  label.style.display = '';
  label.style.overflow = '';
  label.style.whiteSpace = '';
  label.style.textAlign = '';
}

/**
 * Keep the pill's `<details>` element permanently `open`. MapLibre's toggle
 * dance is inverted: its expand branch *removes* `open` while adding
 * `maplibregl-compact-show`, and a closed details hides its content natively
 * (`content-visibility: hidden` on `::details-content`), which removes the
 * label from the pill's layout entirely — killing the width animation and
 * snapping the pill. Visibility is already controlled purely by the compact
 * CSS classes, so the attribute itself can stay set.
 *
 * The pin must also survive the `<summary>`'s native toggle. That toggle is
 * the click's default action, which runs *after* this file's observer has
 * already reacted to the class change and re-pinned `open` — so the pin is
 * flipped straight back off unless `open` mutations are watched too. They
 * are (see `observeAttributions`), and each one is pinned again in the same
 * microtask checkpoint, before the browser can paint the missing label.
 */
function pinDetailsOpen(pill: HTMLElement): void {
  if (!pill.hasAttribute('open')) pill.setAttribute('open', '');
}

/**
 * Remember the label's natural width and the pill's expanded padding for a
 * pill seen in a steady state. Skipped while anything is still animating on
 * the pill or the label so mid-flight layouts are never cached.
 */
function cacheExpandedMetrics(pill: HTMLElement, label: HTMLElement): void {
  if (runningWidthAnimations(label).length > 0 || pill.getAnimations().length > 0) return;
  if (!pill.classList.contains('maplibregl-compact-show')) return;
  clearAnimationStyles(pill, label);
  const padding = getComputedStyle(pill);
  expandedMetrics.set(pill, {
    width: label.offsetWidth,
    height: label.offsetHeight,
    padLeft: parseFloat(padding.paddingLeft) || 0,
    padRight: parseFloat(padding.paddingRight) || 0
  });
}

function startWidthAnimation(pill: HTMLElement): void {
  // A resize can leave compact mode entirely (MapLibre removes both compact
  // classes at once); that mode switch re-renders the label naturally and is
  // not an expand/collapse to animate.
  if (!pill.classList.contains('maplibregl-compact')) return;
  const label = pill.querySelector<HTMLElement>(INNER_SELECTOR);
  if (!label || typeof label.animate !== 'function' || prefersReducedMotion()) return;

  const expanding = pill.classList.contains('maplibregl-compact-show');

  // Reversing mid-flight starts from the width currently on screen;
  // collapsing starts from the remembered natural width, expanding from 0.
  const running = runningWidthAnimations(label);
  let from: number | undefined;
  if (running.length > 0) {
    from = label.getBoundingClientRect().width;
    for (const animation of running) animation.cancel();
  } else if (expanding) {
    from = 0;
  } else {
    from = expandedMetrics.get(pill)?.width;
  }
  if (from === undefined) return;

  // Measure from steady layout: animation styles cleared, label natural.
  clearAnimationStyles(pill, label);

  let to: number;
  let toHeight = 0; // only read on the expand path, where it is assigned
  if (expanding) {
    // Read the label at its true final layout. The pill's padding transition
    // has not started yet (the toggle landed in this same task), so its
    // shrink-to-fit width still reflects the collapsed padding; hold the
    // transition, apply the remembered expanded padding, and width:auto
    // resolves exactly as it will after the animation — viewport clamping
    // and line wrapping included. Predicting this from container arithmetic
    // subtracts the expanded padding from a container sized with the
    // collapsed one, capping the target ~28px too narrow: the measured
    // height then wraps to two lines while the final layout fits one, and
    // both width and height snap back when the animation ends.
    const metrics = expandedMetrics.get(pill);
    if (metrics) {
      pill.style.transition = 'none';
      pill.style.paddingLeft = `${metrics.padLeft}px`;
      pill.style.paddingRight = `${metrics.padRight}px`;
    }
    to = label.offsetWidth;
    toHeight = label.offsetHeight;
    if (metrics) {
      pill.style.transition = '';
      pill.style.paddingLeft = '';
      pill.style.paddingRight = '';
      metrics.width = to;
      metrics.height = toHeight;
    }
  } else {
    to = 0;
  }
  if (Math.abs(to - from) < 1) return;

  // While animating, keep the label on one line and clip it at its own
  // edge, which sits left of the toggle button, so the text is uncovered
  // from the button outward instead of re-wrapping or sliding under the
  // button. While collapsing, keep it rendered so it fades out with the
  // shrinking pill instead of vanishing on the spot, and let the pill grow
  // with the label (its fixed compact height only suits the collapsed
  // state). Opacity rides in the same animation as the width on purpose: a
  // CSS-rule fade can be left stuck at 0 by transition edge cases, and a
  // stuck fade means invisible attribution.
  const fromOpacity = expanding ? 0 : Number(getComputedStyle(label).opacity) || 0;
  // Once MapLibre has hidden the label its wrapped height is unmeasurable,
  // so the collapse starts from the height remembered while expanded.
  const fromHeight = expanding ? 0 : (expandedMetrics.get(pill)?.height ?? 0);
  label.style.overflow = 'hidden';
  label.style.whiteSpace = 'nowrap';
  label.style.textAlign = 'right';
  if (!expanding) {
    label.style.display = 'block';
    pill.style.height = 'auto';
  }
  const lineHeight = label.offsetHeight; // one line, clipped to the animating width

  const keyframes = expanding
    ? [
        { width: `${from}px`, height: `${lineHeight}px`, opacity: fromOpacity },
        { width: `${to}px`, height: `${toHeight}px`, opacity: 1 }
      ]
    : [
        { width: `${from}px`, height: `${fromHeight}px`, opacity: 1 },
        { width: `${to}px`, height: `${lineHeight}px`, opacity: 0 }
      ];
  const animation = label.animate(keyframes, {
    duration: ANIM_MS,
    easing: ANIM_EASING,
    id: WIDTH_ANIM_ID
  });
  // A canceled animation is normally replaced synchronously by the next
  // toggle's animation; only restore steady styles if no replacement exists.
  animation.finished.then(
    () => clearAnimationStyles(pill, label),
    () => {
      if (runningWidthAnimations(label).length === 0) clearAnimationStyles(pill, label);
    }
  );
}

function handleMutations(mutations: MutationRecord[]): void {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes') {
      const pill = mutation.target;
      if (!(pill instanceof HTMLElement) || !pill.matches(PILL_SELECTOR)) continue;
      pinDetailsOpen(pill);
      // `open` changes (MapLibre's inverted expand branch and the summary's
      // default toggle) only need the pin above — the class change is what
      // drives the width animation.
      if (mutation.attributeName === 'open') continue;
      // A resize can switch the whole control between compact and expanded
      // mode (MapLibre adds/removes `maplibregl-compact` itself); only an
      // expand/collapse within compact mode gets the width animation.
      if (!(mutation.oldValue ?? '').includes('maplibregl-compact')) {
        // The pill just entered compact mode (first style load or a shrink
        // across MapLibre's 640px threshold), expanded. Remember its label
        // width now so the user's first collapse can animate from it.
        const label = pill.querySelector<HTMLElement>(INNER_SELECTOR);
        if (label) cacheExpandedMetrics(pill, label);
        continue;
      }
      if (!batchToggles.has(pill)) batchToggles.set(pill, mutation.oldValue ?? '');
      continue;
    }
    // childList: a pill being attached to a map, or its attribution text
    // changing, both change the width a later animation should start from.
    const target = mutation.target;
    if (!(target instanceof Element) || !target.closest('.maplibregl-map')) continue;
    const pill =
      target.closest<HTMLElement>(PILL_SELECTOR) ??
      target.querySelector<HTMLElement>(PILL_SELECTOR);
    if (!pill) continue;
    pinDetailsOpen(pill);
    const label = pill.querySelector<HTMLElement>(INNER_SELECTOR);
    if (label) cacheExpandedMetrics(pill, label);
  }
  for (const [pill, oldClass] of batchToggles) {
    batchToggles.delete(pill);
    // Class churn that undid itself within one batch never rendered.
    if (pill.className === oldClass) continue;
    startWidthAnimation(pill);
  }
}

function observeAttributions(): void {
  observer = new MutationObserver(handleMutations);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    // `open` must be watched alongside the classes: MapLibre's toggle dance
    // flips it in the click's default action, *after* the class change has
    // already been reacted to and the pin applied — without this the pin is
    // undone and the expanded pill's details ends up closed (no label).
    attributeFilter: ['class', 'open'],
    attributeOldValue: true
  });
}

if (browser) observeAttributions();
