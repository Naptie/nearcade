import { m } from '$lib/paraglide/messages';
import { showBanner, dismissBanner } from '$lib/notifications/banner.svelte';

export interface UnsavedChangesOptions {
  /** Banner dedupe id — unique per form/page. */
  id: string;
  /** Override the banner title. */
  title?: string;
  /** Override the banner message. */
  message?: string;
  /** Override the action button label. */
  actionLabel?: string;
  /** Custom save trigger; defaults to submitting the form via requestSubmit(). */
  onSubmit?: () => void;
}

/**
 * Programmatically mark a form as having unsaved changes and show the warning
 * banner. Use this for edits that update form state directly instead of firing
 * DOM `input`/`change` events (e.g. social links edited through a modal).
 */
export const markUnsavedChanges = (
  node: HTMLFormElement | null | undefined,
  options: UnsavedChangesOptions
): void => {
  if (!node || !options.id || node.dataset.dirty === '1') return;
  node.dataset.dirty = '1';
  showBanner({
    id: options.id,
    title: options.title ?? m.unsaved_changes_title(),
    message: options.message ?? m.unsaved_changes_message(),
    type: 'warning',
    icon: 'fa-pen-to-square',
    action: {
      label: options.actionLabel ?? m.save_changes(),
      onClick: options.onSubmit ?? (() => node.requestSubmit())
    }
  });
};

/**
 * `use:unsavedChanges` — attaches the "you have unsaved changes" warning banner
 * to a form. The banner appears once the user starts editing (any `input` /
 * `change` event) and offers an action button that submits the form. It is
 * dismissed automatically when the form (and thus the page section) is removed
 * or when the caller resets `node.dataset.dirty`.
 *
 * For edits that do not fire DOM events (e.g. modal-driven state changes), call
 * `markUnsavedChanges(node, options)` explicitly.
 *
 * ```svelte
 * <form method="POST" use:enhance={...} use:unsavedChanges={{ id: 'shop-edit-unsaved' }}>
 * ```
 */
export function unsavedChanges(
  node: HTMLFormElement,
  options?: UnsavedChangesOptions
): { destroy(): void } {
  if (!options?.id) {
    return { destroy() {} };
  }

  const markDirty = () => markUnsavedChanges(node, options);

  node.addEventListener('input', markDirty);
  node.addEventListener('change', markDirty);

  return {
    destroy() {
      node.removeEventListener('input', markDirty);
      node.removeEventListener('change', markDirty);
      dismissBanner(options.id);
    }
  };
}
