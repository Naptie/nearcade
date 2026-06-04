<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { m } from '$lib/paraglide/messages';
  import type { ActionData, PageData } from './$types';
  import NavigationBar from '$lib/components/NavigationBar.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import { formatDateTime, pageTitle } from '$lib/utils';
  import { resolve } from '$app/paths';

  const STUDENT_EMAIL_VERIFICATION_SUCCESS_QUERY_PARAM = 'studentEmailVerified';
  const STUDENT_EMAIL_VERIFICATION_ERROR_QUERY_PARAM = 'studentEmailError';

  let { data, form }: { data: PageData; form: ActionData | null } = $props();
  let isSubmitting = $state(false);

  const inputEmail = $derived.by(() => {
    if (form && 'email' in form && typeof form.email === 'string') {
      return form.email;
    }

    return data.pendingVerification?.email ?? '';
  });

  const pendingEmail = $derived.by(() => {
    if (
      form &&
      'success' in form &&
      form.success &&
      'email' in form &&
      typeof form.email === 'string'
    ) {
      return form.email;
    }

    return data.pendingVerification?.email ?? null;
  });

  const pendingExpiresAt = $derived.by(() =>
    data.pendingVerification?.expiresAt ? new Date(data.pendingVerification.expiresAt) : null
  );

  const formMessage = $derived.by(() => {
    if (form && 'message' in form && typeof form.message === 'string') {
      return form.message;
    }

    return null;
  });

  const formSucceeded = $derived.by(() => Boolean(form && 'success' in form && form.success));

  const getVerificationErrorMessage = (errorCode: PageData['verificationError']) => {
    switch (errorCode) {
      case 'already_verified':
        return m.already_verified_description();
      case 'domain_mismatch':
        return m.domain_mismatch_description();
      case 'underconfigured_university':
        return m.underconfigured_university_description();
      case 'invalid_or_expired':
      default:
        return m.student_email_verification_error_invalid_or_expired();
    }
  };

  const stripVerificationStatus = (url: URL) => {
    const nextUrl = new URL(url);
    nextUrl.searchParams.delete('token');
    nextUrl.searchParams.delete(STUDENT_EMAIL_VERIFICATION_SUCCESS_QUERY_PARAM);
    nextUrl.searchParams.delete(STUDENT_EMAIL_VERIFICATION_ERROR_QUERY_PARAM);
    return nextUrl;
  };

  $effect(() => {
    if (data.verificationSucceeded || data.verificationError) {
      history.replaceState(history.state, '', stripVerificationStatus(new URL(page.url)));
    }
  });
</script>

<svelte:head>
  <title
    >{pageTitle(
      data.userPermissions.canJoin === 2 ? m.verify_and_join() : m.verify(),
      data.university.name
    )}</title
  >
</svelte:head>

<NavigationBar />

<div
  class="mx-auto flex min-h-screen flex-col items-center justify-center gap-6 py-20 sm:container sm:px-4"
>
  <div class="flex flex-col items-center gap-2 text-center">
    <h1 class="text-4xl font-bold">
      {@html m.verify_title({
        university: `<a href="${resolve('/(main)/universities/[id]', { id: data.university.slug || data.university.id })}" class="hover:text-accent transition-colors">${data.university.name}</a>`
      })}
    </h1>
    {#if data.expectedEmailDomain}
      <p class="text-base-content/80 max-w-2xl">
        {@html m.student_email_verification_description({
          suffix: `<span class="text-success font-semibold">${data.expectedEmailDomain}</span>`
        })}
      </p>
    {:else}
      <p class="text-base-content/80 max-w-2xl">{m.underconfigured_university_description()}</p>
    {/if}
  </div>
  <div class="flex w-full max-w-2xl flex-col gap-4">
    {#if data.verificationSucceeded}
      <div class="alert alert-success">
        <i class="fa-solid fa-circle-check"></i>
        <span>{m.student_email_verification_success()}</span>
      </div>
    {/if}

    {#if data.verificationError}
      <div class="alert alert-error">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>{getVerificationErrorMessage(data.verificationError)}</span>
      </div>
    {/if}

    {#if formMessage}
      <div class={formSucceeded ? 'alert alert-success' : 'alert alert-error'}>
        <i class={formSucceeded ? 'fa-solid fa-paper-plane' : 'fa-solid fa-triangle-exclamation'}
        ></i>
        <span>{formMessage}</span>
      </div>
    {/if}

    {#if data.verificationEmail}
      <section class="bg-base-100 rounded-2xl border border-current/10 p-5 md:p-6">
        <div class="flex flex-col items-center gap-2 text-center">
          <span class="text-base-content/60 text-xs font-semibold tracking-[0.18em] uppercase">
            {m.verified()}
          </span>
          <span>{m.student_status_verified()}</span>
          <span class="text-success text-2xl font-semibold break-all">{data.verificationEmail}</span
          >
          {#if data.verifiedAt}
            <span class="text-base-content/70 text-sm"
              >{m.verified_at()}: {formatDateTime(data.verifiedAt)}</span
            >
          {/if}
        </div>
      </section>
    {:else}
      {#if pendingEmail && pendingExpiresAt}
        <section class="bg-base-100 rounded-2xl border border-current/10 p-5 md:p-6">
          <div class="flex items-start gap-3">
            <div
              class="bg-success/12 text-success flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            >
              <i class="fa-solid fa-envelope-circle-check"></i>
            </div>
            <div class="space-y-1">
              <h2 class="text-lg font-semibold">{m.student_email_verification_pending()}</h2>
              <p class="text-base-content/70 text-sm md:text-base">
                {m.student_email_verification_pending_description({
                  email: pendingEmail,
                  expires: formatDateTime(pendingExpiresAt)
                })}
              </p>
            </div>
          </div>
        </section>
      {/if}

      <section class="bg-base-100 rounded-2xl border border-current/10 p-5 md:p-6">
        {#if data.expectedEmailDomain}
          <form
            method="POST"
            action="?/sendVerificationEmail"
            use:enhance={() => {
              isSubmitting = true;

              return async ({ update }) => {
                isSubmitting = false;
                await update();
                await invalidateAll();
              };
            }}
          >
            <label class="form-control w-full gap-2">
              <span class="label-text">{m.student_email_verification_email_label()}</span>
              <input
                class="input input-bordered w-full"
                type="email"
                name="email"
                placeholder={m.student_email_verification_email_placeholder({
                  suffix: data.expectedEmailDomain
                })}
                value={inputEmail}
                autocomplete="email"
                disabled={isSubmitting}
              />
            </label>

            <div class="mt-4 flex flex-col flex-wrap items-center justify-center gap-3">
              <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
                {#if isSubmitting}
                  <span class="loading loading-spinner loading-xs"></span>
                {/if}
                {pendingEmail
                  ? m.student_email_verification_resend_submit()
                  : m.student_email_verification_send_submit()}
              </button>
            </div>
          </form>
        {:else}
          <div class="alert alert-error">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>{m.underconfigured_university_description()}</span>
          </div>
        {/if}
      </section>
    {/if}
  </div>
  <Footer />
</div>
