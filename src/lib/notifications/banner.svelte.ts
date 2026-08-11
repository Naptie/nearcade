import { untrack } from 'svelte';
import type { ToastType } from './toast.svelte';

export interface BannerAction {
  /** Action button label (already localized). */
  label: string;
  /** Navigate to this route when the action is clicked. */
  href?: string;
  /** Run a callback instead of navigating when the action is clicked. */
  onClick?: () => void;
}

export interface BannerInput {
  /** Unique dedupe key. Re-showing the same id updates the existing banner. */
  id: string;
  /** Message text to display (already localized). */
  message: string;
  /** Optional bold heading shown above the message. */
  title?: string;
  /** Visual variant. Defaults to 'warning'. */
  type?: ToastType;
  /** Font Awesome icon class (without the 'fa-solid' prefix). */
  icon?: string;
  /** Optional action button rendered on the right side of the banner. */
  action?: BannerAction;
  /** Whether the banner has a close button. Defaults to true. */
  dismissible?: boolean;
  /** Invoked when the banner is dismissed (either via the close button or programmatically). */
  onDismiss?: () => void;
}

export interface BannerItem {
  id: string;
  message: string;
  title?: string;
  type: ToastType;
  icon?: string;
  action?: BannerAction;
  dismissible: boolean;
  onDismiss?: () => void;
}

class BannerStore {
  banners = $state<BannerItem[]>([]);

  /**
   * Show (or update) a persistent banner in the bottom region. Banners do not
   * auto-dismiss — they stay until manually closed, an action is taken, or the
   * owner calls `dismissBanner(id)`. Call this from an `$effect` so it follows
   * reactive conditions; make sure to `dismissBanner` in the effect teardown so
   * banners do not leak across page navigations.
   *
   * The internal array access is `untrack`ed so calling this from an `$effect`
   * does not register the store itself as an effect dependency (which would
   * otherwise cause an infinite update loop).
   */
  show({
    id,
    message,
    title,
    type = 'warning',
    icon,
    action,
    dismissible = true,
    onDismiss
  }: BannerInput): void {
    const banner: BannerItem = { id, message, title, type, icon, action, dismissible, onDismiss };
    untrack(() => {
      const index = this.banners.findIndex((b) => b.id === id);
      if (index !== -1) {
        this.banners[index] = banner;
      } else {
        this.banners.push(banner);
      }
    });
  }

  /**
   * Remove a banner. When `userInitiated` is true (close button / action click),
   * the banner's `onDismiss` callback fires — used by owners to persist
   * dismissal. Programmatic cleanup (e.g. layout effect teardown on navigation)
   * passes false so `onDismiss` is NOT called.
   */
  dismiss(id: string, userInitiated = false): void {
    untrack(() => {
      const index = this.banners.findIndex((b) => b.id === id);
      if (index !== -1) {
        const [banner] = this.banners.splice(index, 1);
        if (userInitiated) banner.onDismiss?.();
      }
    });
  }

  clear(): void {
    this.banners = [];
  }
}

/**
 * Shared client-side banner store. Import this anywhere and call `showBanner` /
 * `dismissBanner`. The store is reactive, so `BannerRegion` re-renders automatically.
 */
export const bannerStore = new BannerStore();

export const showBanner = (input: BannerInput) => bannerStore.show(input);
export const dismissBanner = (id: string) => bannerStore.dismiss(id);
