<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { authClient } from '$lib/auth/client';
  import {
    hasBoundEmail,
    isPlaceholderEmail,
    stripEmailVerificationStatus,
    withEmailVerificationSuccessMarker
  } from '$lib/auth/email';
  import { m } from '$lib/paraglide/messages';
  import { pageTitle } from '$lib/utils';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let newEmail = $state('');
  let isSubmitting = $state(false);
  let isResending = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');

  const currentEmailIsBound = $derived.by(() => hasBoundEmail(data.user.email));
  const canResendVerification = $derived.by(
    () => currentEmailIsBound && data.user.emailVerified !== true
  );

  const getCallbackURL = () => {
    return withEmailVerificationSuccessMarker(new URL(page.url));
  };

  $effect(() => {
    if (data.verificationError) {
      errorMessage = m.email_settings_verification_error();
      successMessage = '';
    } else if (data.verificationSucceeded) {
      successMessage = m.email_settings_verification_success();
      errorMessage = '';
    }

    if (data.verificationSucceeded || data.verificationError) {
      history.replaceState(history.state, '', stripEmailVerificationStatus(new URL(page.url)));
    }
  });

  const handleChangeEmail = async () => {
    const trimmedEmail = newEmail.trim();
    if (!trimmedEmail) {
      errorMessage = m.validation_error();
      return;
    }

    isSubmitting = true;
    errorMessage = '';
    successMessage = '';

    try {
      await authClient.changeEmail({
        newEmail: trimmedEmail,
        callbackURL: getCallbackURL()
      });
      newEmail = '';
      successMessage = m.email_settings_change_success();
      await invalidateAll();
    } catch {
      errorMessage = m.email_settings_error();
    } finally {
      isSubmitting = false;
    }
  };

  const handleResendVerification = async () => {
    if (!data.user.email || isPlaceholderEmail(data.user.email)) {
      return;
    }

    isResending = true;
    errorMessage = '';
    successMessage = '';

    try {
      await authClient.sendVerificationEmail({
        email: data.user.email,
        callbackURL: getCallbackURL()
      });
      successMessage = m.email_settings_resend_success();
    } catch {
      errorMessage = m.email_settings_error();
    } finally {
      isResending = false;
    }
  };

  const handleContinue = async () => {
    location.href = data.redirectTo ?? resolve('/(main)');
  };
</script>

<svelte:head>
  <title>{pageTitle(m.email_settings())}</title>
</svelte:head>

<div class="space-y-6 md:space-y-8 md:p-5">
  <div class="space-y-2">
    <h1 class="text-2xl font-bold md:text-3xl">{m.email_settings()}</h1>
    <p class="text-base-content/70 text-sm md:text-base">
      {m.email_settings_description()}
    </p>
  </div>

  {#if data.prompt && data.needsEmailBinding}
    <div class="alert alert-warning">
      <i class="fa-solid fa-envelope-circle-check"></i>
      <span>{m.email_settings_post_login_notice()}</span>
    </div>
  {/if}

  {#if successMessage}
    <div class="alert alert-success">
      <i class="fa-solid fa-paper-plane"></i>
      <span>{successMessage}</span>
    </div>
  {/if}

  {#if errorMessage}
    <div class="alert alert-error">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span>{errorMessage}</span>
    </div>
  {/if}

  <section
    class="bg-base-100 grid gap-4 rounded-2xl border border-current/10 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:p-6"
  >
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-lg font-semibold">{m.email_settings_current()}</h2>
        {#if data.user.emailVerified}
          <span class="badge badge-success badge-outline">{m.email_settings_status_verified()}</span
          >
        {:else}
          <span class="badge badge-warning badge-outline">{m.pending_verification()}</span>
        {/if}
      </div>

      {#if currentEmailIsBound}
        <p class="text-base font-medium break-all">{data.user.email}</p>
      {:else}
        <p class="text-base-content/70">{m.email_settings_placeholder()}</p>
      {/if}

      {#if canResendVerification}
        <p class="text-base-content/70 text-sm">{m.email_settings_update_again_hint()}</p>
      {/if}
    </div>

    {#if canResendVerification}
      <button
        type="button"
        class="btn btn-outline btn-sm"
        onclick={handleResendVerification}
        disabled={isResending}
      >
        {#if isResending}
          <span class="loading loading-spinner loading-xs"></span>
        {/if}
        {m.email_settings_resend_submit()}
      </button>
    {/if}
  </section>

  <section class="bg-base-100 rounded-2xl border border-current/10 p-5 md:p-6">
    <div class="mb-4 space-y-2">
      <h2 class="text-lg font-semibold">{m.update_email_address()}</h2>
      <p class="text-base-content/70 text-sm">{m.email_settings_change_hint()}</p>
    </div>

    <label class="form-control w-full gap-2">
      <span class="label-text">{m.new_email_address()}</span>
      <input
        class="input input-bordered w-full"
        type="email"
        bind:value={newEmail}
        placeholder={m.email_settings_change_placeholder()}
        autocomplete="email"
      />
    </label>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="btn btn-primary"
        onclick={handleChangeEmail}
        disabled={isSubmitting}
      >
        {#if isSubmitting}
          <span class="loading loading-spinner loading-xs"></span>
        {/if}
        {m.email_settings_change_submit()}
      </button>

      {#if successMessage}
        <span class="text-base-content/70 text-sm">{m.email_settings_check_inbox()}</span>
      {/if}
    </div>
  </section>

  {#if data.prompt}
    <div class="flex justify-end">
      <button type="button" class="btn btn-ghost" onclick={handleContinue}>
        {m.email_settings_continue()}
      </button>
    </div>
  {/if}
</div>
