<script lang="ts">
  import { resolve } from '$app/paths';
  import { getVerifiedContactStatus } from '$lib/auth/verified-contact';
  import type { User } from '$lib/auth/types';
  import { m } from '$lib/paraglide/messages';

  interface Props {
    user?: User | null;
    loginMessage?: string;
    icon?: string;
    compact?: boolean;
    class?: string;
  }

  let {
    user = null,
    loginMessage = m.sign_in(),
    icon = 'fa-comment',
    compact = false,
    class: klass = ''
  }: Props = $props();

  const status = $derived(getVerifiedContactStatus(user));
  const message = $derived.by(() => {
    if (!user) {
      return loginMessage;
    }

    if (!status.hasVerifiedEmail && !status.hasPhone) {
      return m.verified_contact_required_for_contribution();
    }

    if (!status.hasVerifiedEmail) {
      return m.verified_email_required_for_contribution();
    }

    return m.phone_binding_required_for_contribution();
  });
</script>

<div
  class="bg-base-200 flex flex-col items-center rounded-xl text-center {compact
    ? 'gap-2 p-6'
    : 'gap-3 p-8'} {klass}"
>
  <div class="flex items-center gap-2">
    <i
      class="fa-solid {user ? 'fa-triangle-exclamation' : `${icon} text-base-content/40`} {compact
        ? 'text-lg'
        : 'text-xl'}"
    ></i>
    <h3 class={compact ? 'text-base font-semibold' : 'text-lg font-semibold'}>
      {m.action_required()}
    </h3>
  </div>

  {#if !user}
    <button
      class="text-base-content/60 hover:link-accent cursor-pointer text-sm transition-colors"
      onclick={() => {
        window.dispatchEvent(new CustomEvent('nearcade-login'));
      }}
    >
      {message}
    </button>
  {:else}
    <p class="text-base-content/70 max-w-xl text-sm">{message}</p>
    <div class="flex flex-wrap justify-center gap-2">
      {#if !status.hasVerifiedEmail}
        <a href={resolve('/(main)/settings/email')} class="btn btn-primary btn-soft btn-sm">
          <i class="fa-solid fa-envelope"></i>
          {m.email_settings()}
        </a>
      {/if}
      {#if !status.hasPhone}
        <a href={resolve('/(main)/settings/phone')} class="btn btn-primary btn-soft btn-sm">
          <i class="fa-solid fa-mobile-screen"></i>
          {m.phone_settings()}
        </a>
      {/if}
    </div>
  {/if}
</div>
