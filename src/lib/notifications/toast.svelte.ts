import { untrack } from 'svelte';
import { browser } from '$app/environment';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  /** Action button label (already localized). */
  label: string;
  /** Navigate to this route when the action is clicked. */
  href?: string;
  /** Run a callback instead of navigating when the action is clicked. */
  onClick?: () => void;
}

export interface ToastInput {
  /** Message text to display (already localized). */
  message: string;
  /** Visual variant. Defaults to 'info'. */
  type?: ToastType;
  /** Time in ms before the toast auto-dismisses. Defaults to 4000 (6000 when an action is present). Pass 0 to keep it until manually closed. */
  duration?: number;
  /** Font Awesome icon class (without the 'fa-solid' prefix). */
  icon?: string;
  /** Optional action button rendered in the toast (e.g. "Bind phone"). */
  action?: ToastAction;
}

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
  icon?: string;
  action?: ToastAction;
}

let nextId = 1;

class ToastStore {
  toasts = $state<ToastItem[]>([]);

  /**
   * Push a transient toast onto the top-right stack. It auto-dismisses after
   * `duration` ms (default 4000) and slides out.
   *
   * The internal array access is `untrack`ed so calling this from an `$effect`
   * does not register the store itself as an effect dependency (which would
   * otherwise cause an infinite update loop).
   */
  show({ message, type = 'info', duration, icon, action }: ToastInput): number {
    const id = nextId++;
    const effectiveDuration = duration ?? (action ? 6000 : 4000);
    untrack(() => {
      this.toasts.push({ id, message, type, duration: effectiveDuration, icon, action });
    });
    if (browser && effectiveDuration > 0) {
      setTimeout(() => this.dismiss(id), effectiveDuration);
    }
    return id;
  }

  dismiss(id: number): void {
    untrack(() => {
      const index = this.toasts.findIndex((t) => t.id === id);
      if (index !== -1) this.toasts.splice(index, 1);
    });
  }

  clear(): void {
    this.toasts = [];
  }
}

/**
 * Shared client-side toast store. Import this anywhere and call `toast(...)`.
 * The store is reactive, so `ToastRegion` re-renders automatically.
 */
export const toastStore = new ToastStore();

export const toast = (message: string, options?: Omit<ToastInput, 'message'>) =>
  toastStore.show({ message, ...options });

export const toastSuccess = (message: string, options?: Omit<ToastInput, 'message' | 'type'>) =>
  toastStore.show({ message, type: 'success', ...options });

export const toastError = (message: string, options?: Omit<ToastInput, 'message' | 'type'>) =>
  toastStore.show({ message, type: 'error', ...options });

export const toastWarning = (message: string, options?: Omit<ToastInput, 'message' | 'type'>) =>
  toastStore.show({ message, type: 'warning', ...options });

export const toastInfo = (message: string, options?: Omit<ToastInput, 'message' | 'type'>) =>
  toastStore.show({ message, type: 'info', ...options });

export const dismissToast = (id: number) => toastStore.dismiss(id);
