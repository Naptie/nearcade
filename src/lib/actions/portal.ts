import { browser } from '$app/environment';
import type { Action } from 'svelte/action';

export const portal: Action<HTMLElement, HTMLElement | string | undefined> = (
  node,
  target = 'body'
) => {
  if (!browser) {
    return;
  }

  const resolveTarget = (value: HTMLElement | string | undefined) => {
    if (value instanceof HTMLElement) {
      return value;
    }

    if (typeof value === 'string') {
      return document.querySelector<HTMLElement>(value);
    }

    return document.body;
  };

  const mountTarget = resolveTarget(target) ?? document.body;
  mountTarget.appendChild(node);

  return {
    update(nextTarget) {
      const nextMountTarget = resolveTarget(nextTarget) ?? document.body;
      if (node.parentNode !== nextMountTarget) {
        nextMountTarget.appendChild(node);
      }
    }
  };
};
