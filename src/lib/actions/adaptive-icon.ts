import { browser } from '$app/environment';
import type { Action } from 'svelte/action';

/**
 * Count how many visual line boxes the contents of `row` occupy.
 *
 * A `Range` over the element's contents reports one client rect per laid-out
 * line box (rects split at inline-element boundaries, but those share the same
 * `top`). Distinct lines are exactly a line-height apart, so rects are clustered
 * by `top` with a tolerance below half a line-height — large enough to absorb
 * sub-pixel rounding and same-line rects from slightly different font sizes,
 * small enough that adjacent lines never merge.
 */
const countLines = (row: HTMLElement): number => {
  const lineHeight = parseFloat(getComputedStyle(row).lineHeight);
  const tolerance = Number.isFinite(lineHeight) ? Math.max(lineHeight / 2 - 0.5, 1) : 2;

  const range = document.createRange();
  range.selectNodeContents(row);

  const tops: number[] = [];
  for (const rect of range.getClientRects()) {
    if (rect.height <= 0) continue;
    if (!tops.some((top) => Math.abs(top - rect.top) <= tolerance)) {
      tops.push(rect.top);
    }
  }

  return Math.max(tops.length, 1);
};

/**
 * `use:adaptiveIcon` — attach to an icon + text row (a flex container whose
 * first child is an `<i>` icon) to make the icon alignment adapt to wrapping:
 * single line → vertically centered (`items-center`), multiple lines → pinned
 * to the top with a small padding (`items-start` + `mt-1` on the icon).
 *
 * The line count is measured from real layout rects and kept up to date with a
 * `ResizeObserver`, so it stays correct across fonts, line heights, viewport
 * resizes, and late-loading content. Give the row `items-center` as its static
 * class so the pre-hydration state is already correct for one-liners.
 *
 * ```svelte
 * <div class="flex items-center gap-2" use:adaptiveIcon>
 *   <i class="fa-solid fa-coins"></i>
 *   {@html costs[game.gameId]}
 * </div>
 * ```
 */
export const adaptiveIcon: Action<HTMLElement> = (node) => {
  if (!browser) return;

  const measure = () => {
    const multiline = countLines(node) > 1;
    node.classList.toggle('items-start', multiline);
    node.classList.toggle('items-center', !multiline);
    node.querySelector<HTMLElement>(':scope > i')?.classList.toggle('mt-1', multiline);
  };

  measure();

  const observer = new ResizeObserver(measure);
  observer.observe(node);

  return {
    destroy: () => observer.disconnect()
  };
};
