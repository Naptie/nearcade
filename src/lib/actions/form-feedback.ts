import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { m } from '$lib/paraglide/messages';
import { toast } from '$lib/notifications/toast.svelte';
import { resolveFormMessage } from '$lib/notifications/messages';
import type { ActionResult } from '@sveltejs/kit';

/** Success/failure action results that carry a `data` payload. */
export type FeedbackResult = Extract<ActionResult, { data?: unknown }>;

export interface FeedbackOptions {
  /**
   * Message to show as a success toast, or a resolver that reads it from the
   * action result (e.g. `result.data?.message`). Omit to show no success toast.
   */
  successMessage?: string | ((result: FeedbackResult) => string | null | undefined);
  /**
   * Message to show as an error toast, or a resolver. Falls back to the action
   * result's `message`/`error` payload. Omit to show no error toast.
   */
  errorMessage?: string | ((result: FeedbackResult) => string | null | undefined);
  /** Call `invalidateAll()` after a successful submit instead of `update()`. */
  invalidate?: boolean;
  /** Called when the submit starts (e.g. to set `isSubmitting = true`). */
  onPending?: () => void;
  /** Called after the result is handled, success or failure (e.g. to reset `isSubmitting`). */
  onComplete?: () => void;
  /** Called after a successful submit, before the default `update()`/`invalidateAll()`. */
  onSuccess?: () => void | Promise<void>;
  /** Called after a failed submit, before the default `update()`. */
  onFailure?: () => void | Promise<void>;
}

const resolve = (
  msg: FeedbackOptions['successMessage'] | undefined,
  result: FeedbackResult
): string | null => {
  if (typeof msg === 'function') return msg(result) ?? null;
  if (typeof msg === 'string') return msg;
  return null;
};

/**
 * Drop-in replacement for `use:enhance` that also surfaces form results as
 * toasts. Keeps enhance's default behaviour (`update()` on success/failure,
 * redirects applied automatically) while removing the per-page
 * `showSuccess`/`setTimeout`/inline-alert boilerplate.
 *
 * ```svelte
 * <form method="POST" use:feedback={{
 *   successMessage: (r) => resolveStatusMessage(r.data?.message),
 *   errorMessage: (r) => resolveStatusMessage(r.data?.message),
 *   invalidate: true,
 *   onPending: () => (isSubmitting = true),
 *   onComplete: () => (isSubmitting = false)
 * }}>
 * ```
 */
export function feedback(form: HTMLFormElement, options: FeedbackOptions = {}) {
  return enhance(form, () => {
    options.onPending?.();
    return async ({ result, update }) => {
      try {
        if (result.type === 'success') {
          const message = resolve(options.successMessage, result);
          if (message) toast(message, { type: 'success' });
          await options.onSuccess?.();
          if (options.invalidate) {
            await invalidateAll();
          } else {
            await update();
          }
        } else if (result.type === 'redirect') {
          // enhance applies the redirect itself; nothing else to do.
          await options.onSuccess?.();
        } else if (result.type === 'failure') {
          const message =
            resolve(options.errorMessage, result) ??
            resolveFormMessage(result.data, m.validation_error());
          if (message) toast(message, { type: 'error' });
          await options.onFailure?.();
          await update();
        } else if (result.type === 'error') {
          const message =
            typeof options.errorMessage === 'string'
              ? options.errorMessage
              : result.error instanceof Error
                ? result.error.message
                : m.validation_error();
          if (message) toast(message, { type: 'error' });
          await options.onFailure?.();
        }
      } finally {
        options.onComplete?.();
      }
    };
  });
}
