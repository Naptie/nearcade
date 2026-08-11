import { resolve } from '$app/paths';
import { m } from '$lib/paraglide/messages';
import { toast } from '$lib/notifications/toast.svelte';

/**
 * Show a non-blocking "you need to bind a phone number" toast with an action
 * button that links to the phone settings page. Use this wherever a phone is
 * required for an action, instead of disabling the button or hiding the UI.
 */
export const phoneRequiredToast = (message: string = m.phone_binding_required()): void => {
  toast(message, {
    type: 'warning',
    icon: 'fa-mobile-screen',
    action: {
      label: m.phone_settings_bind(),
      href: resolve('/(main)/settings/phone')
    }
  });
};
