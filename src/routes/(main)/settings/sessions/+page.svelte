<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';
  import { formatDistanceToNow, format } from 'date-fns';
  import { getLocale } from '$lib/paraglide/runtime';
  import { getFnsLocale } from '$lib/utils';
  import { pageTitle } from '$lib/utils';
  import ConfirmationModal from '$lib/components/ConfirmationModal.svelte';
  import { getScopeLabel, getScopeIcon } from '$lib/auth/oauth/scope-labels';
  import type { PageData, ActionData } from './$types';

  type SessionItem = PageData['sessions'][number];
  type OAuthTokenItem = PageData['oauthTokens'][number];

  let { data, form }: { data: PageData; form: ActionData | null } = $props();

  const locale = getLocale();
  const dateLocale = getFnsLocale(locale);

  // ── Revoke confirmation state ────────────────────────────────────────────
  let showRevokeSessionConfirm = $state(false);
  let showRevokeOthersConfirm = $state(false);
  let showRevokeOAuthConfirm = $state(false);
  let targetSession = $state<SessionItem | null>(null);
  let targetOAuthToken = $state<OAuthTokenItem | null>(null);
  let isRevoking = $state(false);

  // ── QR state ─────────────────────────────────────────────────────────────
  let showQrModal = $state(false);
  let qrSvg = $state<string | null>(null);
  let qrExpiresAt = $state<Date | null>(null);
  let qrSecondsLeft = $state(0);
  let qrExpired = $state(false);
  let isGeneratingQr = $state(false);
  let qrTimerInterval: ReturnType<typeof setInterval> | null = null;
  let generateQrFormEl = $state<HTMLFormElement | null>(null);

  function openQrModal() {
    showQrModal = true;
    // Auto-generate immediately when the modal opens
    if (!qrSvg && !isGeneratingQr) {
      // requestSubmit after microtask so the form is guaranteed to be mounted
      Promise.resolve().then(() => generateQrFormEl?.requestSubmit());
    }
  }

  // ── Success / error message ───────────────────────────────────────────────
  let showSuccess = $state(false);
  let successTimeout: ReturnType<typeof setTimeout> | null = null;

  const getStatusMessage = (key: string | undefined): string => {
    switch (key) {
      case 'sessions_revoked':
        return m.sessions_revoked();
      case 'sessions_all_others_revoked':
        return m.sessions_all_others_revoked();
      case 'sessions_oauth_revoked':
        return m.sessions_oauth_revoked();
      case 'sessions_error_revoking':
        return m.sessions_error_revoking();
      case 'unauthorized':
        return m.unauthorized();
      default:
        return key ?? '';
    }
  };

  $effect(() => {
    if (form?.success) {
      showSuccess = true;
      showRevokeSessionConfirm = false;
      showRevokeOthersConfirm = false;
      showRevokeOAuthConfirm = false;
      if (successTimeout) clearTimeout(successTimeout);
      successTimeout = setTimeout(() => (showSuccess = false), 4000);
      invalidateAll();
    }
  });

  // ── QR timer ─────────────────────────────────────────────────────────────
  function startQrTimer(expiresAt: Date) {
    if (qrTimerInterval) clearInterval(qrTimerInterval);
    qrExpired = false;

    const tick = () => {
      const diff = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      qrSecondsLeft = diff;
      if (diff === 0) {
        qrExpired = true;
        if (qrTimerInterval) clearInterval(qrTimerInterval);
      }
    };
    tick();
    qrTimerInterval = setInterval(tick, 1000);
  }

  function closeQrModal() {
    showQrModal = false;
    qrSvg = null;
    qrExpiresAt = null;
    qrExpired = false;
    if (qrTimerInterval) {
      clearInterval(qrTimerInterval);
      qrTimerInterval = null;
    }
  }

  // Clean up timer on destroy
  $effect(() => {
    return () => {
      if (qrTimerInterval) clearInterval(qrTimerInterval);
      if (successTimeout) clearTimeout(successTimeout);
    };
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const relativeDate = (d: Date | string) =>
    formatDistanceToNow(new Date(d), { addSuffix: true, locale: dateLocale });

  const absoluteDate = (d: Date | string) => format(new Date(d), 'PPpp', { locale: dateLocale });
</script>

<svelte:head>
  <title>{pageTitle(m.sessions())}</title>
</svelte:head>

<div class="space-y-6 md:space-y-10 md:p-5">
  <!-- Header -->
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold md:text-3xl">{m.sessions()}</h1>
      <p class="text-base-content/70 mt-1">{m.sessions_description()}</p>
    </div>
    <button class="btn btn-primary btn-soft" onclick={openQrModal}>
      <i class="fa-solid fa-qrcode"></i>
      {m.sessions_add_session()}
    </button>
  </div>

  <!-- Success / error alert -->
  {#if showSuccess && form?.success}
    <div class="alert alert-success">
      <i class="fa-solid fa-check-circle"></i>
      <span>{getStatusMessage(form.message as string | undefined)}</span>
    </div>
  {:else if form && !form.success && form.message}
    <div class="alert alert-error">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span>{getStatusMessage(form.message as string | undefined)}</span>
    </div>
  {/if}

  <!-- ══ Cookie-based sessions ══════════════════════════════════════════════ -->
  <section class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-xl font-semibold">{m.sessions_cookie_sessions()}</h2>
        <p class="text-base-content/60 text-sm">{m.sessions_cookie_sessions_description()}</p>
      </div>
      {#if data.sessions.filter((s) => !s.isCurrent).length > 0}
        <form
          method="POST"
          action="?/revokeOtherSessions"
          use:enhance={() => {
            isRevoking = true;
            return async ({ update }) => {
              isRevoking = false;
              update();
            };
          }}
        >
          <button
            type="button"
            class="btn btn-sm btn-soft btn-warning"
            class:btn-disabled={isRevoking}
            onclick={() => (showRevokeOthersConfirm = true)}
          >
            <i class="fa-solid fa-right-from-bracket"></i>
            {m.sessions_revoke_all_others()}
          </button>
        </form>
      {/if}
    </div>

    {#if data.sessions.length === 0}
      <div class="py-6 text-center">
        <i class="fa-solid fa-laptop text-base-content/30 mb-3 text-4xl"></i>
        <p class="text-base-content/60">{m.sessions_no_sessions()}</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each data.sessions as session (session.id)}
          <div class="bg-base-100 flex flex-wrap items-center justify-between gap-4 rounded-lg p-4">
            <div class="flex min-w-0 flex-1 items-start gap-3">
              <div
                class="text-base-content/50 mt-0.5 text-xl"
                title={session.userAgent ?? undefined}
              >
                {#if /mobile|android|iphone|ipad/i.test(session.userAgent ?? '')}
                  <i class="fa-solid fa-mobile-screen"></i>
                {:else}
                  <i class="fa-solid fa-desktop"></i>
                {/if}
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium">{session.userAgentLabel}</span>
                  {#if session.isCurrent}
                    <span class="badge badge-primary badge-soft text-xs"
                      >{m.sessions_current()}</span
                    >
                  {/if}
                </div>
                <div class="text-base-content/55 mt-1 space-y-0.5 text-xs">
                  {#if session.ipAddress}
                    <p class="flex items-start gap-2">
                      <i class="fa-solid fa-network-wired mt-0.5 w-3.5 text-center"></i>
                      <span>
                        {session.ipAddress}
                      </span>
                    </p>
                  {/if}
                  {#if session.ipRegion}
                    <p class="flex items-start gap-2">
                      <i class="fa-solid fa-location-dot mt-0.5 w-3.5 text-center"></i>
                      <span>{session.ipRegion}</span>
                    </p>
                  {/if}
                  <p class="flex items-start gap-2" title={absoluteDate(session.createdAt)}>
                    <i class="fa-solid fa-calendar-day mt-0.5 w-3.5 text-center"></i>
                    <span>{relativeDate(session.createdAt)}</span>
                  </p>
                </div>
              </div>
            </div>

            {#if !session.isCurrent}
              <form
                method="POST"
                action="?/revokeSession"
                use:enhance={() => {
                  isRevoking = true;
                  return async ({ update }) => {
                    isRevoking = false;
                    update();
                  };
                }}
              >
                <input type="hidden" name="token" value={session.token} />
                <button
                  type="button"
                  class="btn btn-sm btn-soft btn-error"
                  class:btn-disabled={isRevoking}
                  onclick={() => {
                    targetSession = session;
                    showRevokeSessionConfirm = true;
                  }}
                >
                  <i class="fa-solid fa-ban"></i>
                  {m.sessions_revoke()}
                </button>
              </form>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ══ OAuth access tokens ════════════════════════════════════════════════ -->
  <section class="space-y-4">
    <div>
      <h2 class="text-xl font-semibold">{m.sessions_oauth_tokens()}</h2>
      <p class="text-base-content/60 text-sm">{m.sessions_oauth_tokens_description()}</p>
    </div>

    {#if data.oauthTokens.length === 0}
      <div class="py-6 text-center">
        <i class="fa-solid fa-plug text-base-content/30 mb-3 text-4xl"></i>
        <p class="text-base-content/60">{m.sessions_no_oauth_tokens()}</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each data.oauthTokens as token (token.id)}
          <div class="bg-base-100 flex flex-wrap items-center justify-between gap-4 rounded-lg p-4">
            <div class="flex min-w-0 flex-1 items-start gap-3">
              {#if token.clientIcon}
                <img
                  src={token.clientIcon}
                  alt={token.clientName}
                  class="mt-0.5 h-7 w-7 rounded-lg object-cover"
                />
              {:else}
                <div class="bg-base-300 mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg">
                  <i class="fa-solid fa-cube text-base-content/40 text-xs"></i>
                </div>
              {/if}
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium">{token.clientName}</span>
                  {#if token.clientUri}
                    <a
                      href={token.clientUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={token.clientUri}
                      class="text-base-content/40 hover:text-base-content/70 transition-colors"
                    >
                      <i class="fa-solid fa-arrow-up-right-from-square fa-xs"></i>
                    </a>
                  {/if}
                </div>
                <div class="text-base-content/55 mt-1 space-y-0.5 text-xs">
                  {#if token.scopes.length > 0}
                    <div class="flex flex-wrap items-center gap-0.5">
                      {#each token.scopes as scope (scope)}
                        <div class="badge badge-soft badge-sm flex items-center gap-1.5">
                          <i class="fa-solid {getScopeIcon(scope)} text-center"></i>
                          <span>{getScopeLabel(scope)}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                  <p class="flex items-center gap-2" title={absoluteDate(token.createdAt)}>
                    <i class="fa-solid fa-calendar-day w-3.5 text-center"></i>
                    <span>{m.created()}: {relativeDate(token.createdAt)}</span>
                  </p>
                  {#if token.updatedAt}
                    <p class="flex items-center gap-2" title={absoluteDate(token.updatedAt)}>
                      <i class="fa-solid fa-rotate w-3.5 text-center"></i>
                      <span>{m.sessions_last_active()}: {relativeDate(token.updatedAt)}</span>
                    </p>
                  {/if}
                </div>
              </div>
            </div>

            <form
              method="POST"
              action="?/revokeOAuthToken"
              use:enhance={() => {
                isRevoking = true;
                return async ({ update }) => {
                  isRevoking = false;
                  update();
                };
              }}
            >
              <input type="hidden" name="tokenId" value={token.id} />
              <button
                type="button"
                class="btn btn-sm btn-soft btn-error"
                class:btn-disabled={isRevoking}
                onclick={() => {
                  targetOAuthToken = token;
                  showRevokeOAuthConfirm = true;
                }}
              >
                <i class="fa-solid fa-ban"></i>
                {m.sessions_revoke()}
              </button>
            </form>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<!-- ══ Revoke session confirmation ══════════════════════════════════════════ -->
<ConfirmationModal
  isOpen={showRevokeSessionConfirm}
  title={m.sessions_revoke()}
  message={m.sessions_revoke_confirm()}
  confirmButtonClass="btn-error"
  onConfirm={() => {
    if (!targetSession) return;
    const form = document.querySelector<HTMLFormElement>(
      `form[data-session-token="${targetSession.token}"]`
    );
    form?.requestSubmit();
    showRevokeSessionConfirm = false;
  }}
  onCancel={() => {
    showRevokeSessionConfirm = false;
    targetSession = null;
  }}
/>

<!-- ══ Revoke other sessions confirmation ═══════════════════════════════════ -->
<ConfirmationModal
  isOpen={showRevokeOthersConfirm}
  title={m.sessions_revoke_all_others()}
  message={m.sessions_revoke_all_others_confirm()}
  confirmButtonClass="btn-warning"
  onConfirm={() => {
    showRevokeOthersConfirm = false;
    const form = document.querySelector<HTMLFormElement>('form[data-revoke-others]');
    form?.requestSubmit();
  }}
  onCancel={() => (showRevokeOthersConfirm = false)}
/>

<!-- ══ Revoke OAuth token confirmation ══════════════════════════════════════ -->
<ConfirmationModal
  isOpen={showRevokeOAuthConfirm}
  title={m.sessions_revoke()}
  message={m.sessions_revoke_oauth_confirm({
    name: targetOAuthToken?.clientName ?? m.sessions_unknown_client()
  })}
  confirmButtonClass="btn-error"
  onConfirm={() => {
    if (!targetOAuthToken) return;
    const form = document.querySelector<HTMLFormElement>(
      `form[data-oauth-token-id="${targetOAuthToken.id}"]`
    );
    form?.requestSubmit();
    showRevokeOAuthConfirm = false;
  }}
  onCancel={() => {
    showRevokeOAuthConfirm = false;
    targetOAuthToken = null;
  }}
/>

<!-- ══ QR code modal ════════════════════════════════════════════════════════ -->
<!-- Hidden generate form — always mounted so bind:this and requestSubmit() work reliably -->
<form
  bind:this={generateQrFormEl}
  method="POST"
  action="?/generateQr"
  style="display:none"
  use:enhance={() => {
    isGeneratingQr = true;
    qrSvg = null;
    if (qrTimerInterval) clearInterval(qrTimerInterval);
    return async ({ result }) => {
      isGeneratingQr = false;
      if (result.type === 'success' && result.data?.qr) {
        const qr = result.data.qr as { svg: string; expiresAt: string };
        qrSvg = qr.svg;
        qrExpiresAt = new Date(qr.expiresAt);
        qrExpired = false;
        startQrTimer(qrExpiresAt);
      }
    };
  }}
></form>

<div class="modal" class:modal-open={showQrModal}>
  <div class="modal-box w-11/12 max-w-sm">
    <button
      class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2"
      onclick={closeQrModal}
      aria-label={m.cancel()}
    >
      <i class="fa-solid fa-xmark"></i>
    </button>

    <h3 class="mb-1 text-lg font-bold">{m.sessions_qr_title()}</h3>

    {#if isGeneratingQr}
      <div class="flex justify-center py-8">
        <span class="loading loading-spinner loading-lg text-primary"></span>
      </div>
    {:else if qrSvg}
      <p class="text-base-content/70 mb-3 text-sm">
        {m.sessions_qr_description({ seconds: qrSecondsLeft })}
      </p>

      {#if qrExpired}
        <div class="alert alert-warning mb-3">
          <i class="fa-solid fa-clock"></i>
          <span>{m.sessions_qr_expired()}</span>
        </div>
      {/if}

      <!-- QR code display -->
      <div
        class="relative mx-auto w-fit rounded-xl border p-3"
        class:opacity-30={qrExpired}
        class:blur-sm={qrExpired}
      >
        {@html qrSvg}
      </div>

      <!-- Countdown bar -->
      {#if !qrExpired && qrExpiresAt}
        <div class="mt-3">
          <progress class="progress progress-primary w-full" value={qrSecondsLeft} max={data.qrTtl}
          ></progress>
          <p class="text-base-content/60 mt-1 text-center text-xs">
            {qrSecondsLeft}s
          </p>
        </div>
      {/if}

      <div class="modal-action mt-4">
        <button type="button" class="btn btn-ghost" onclick={closeQrModal}>{m.cancel()}</button>
        <button
          type="button"
          class="btn btn-primary btn-soft"
          onclick={() => generateQrFormEl?.requestSubmit()}
        >
          <i class="fa-solid fa-arrows-rotate"></i>
          {m.sessions_qr_refresh()}
        </button>
      </div>
    {/if}
  </div>
  <div class="modal-backdrop" onclick={closeQrModal} role="none"></div>
</div>

<!-- Hidden forms for confirmation-modal-triggered submits -->
{#each data.sessions.filter((s) => !s.isCurrent) as session (session.id)}
  <form
    method="POST"
    action="?/revokeSession"
    data-session-token={session.token}
    style="display:none"
    use:enhance={() => {
      isRevoking = true;
      return async ({ update }) => {
        isRevoking = false;
        update();
      };
    }}
  >
    <input type="hidden" name="token" value={session.token} />
  </form>
{/each}

<form
  method="POST"
  action="?/revokeOtherSessions"
  data-revoke-others
  style="display:none"
  use:enhance={() => {
    isRevoking = true;
    return async ({ update }) => {
      isRevoking = false;
      update();
    };
  }}
></form>

{#each data.oauthTokens as token (token.id)}
  <form
    method="POST"
    action="?/revokeOAuthToken"
    data-oauth-token-id={token.id}
    style="display:none"
    use:enhance={() => {
      isRevoking = true;
      return async ({ update }) => {
        isRevoking = false;
        update();
      };
    }}
  >
    <input type="hidden" name="tokenId" value={token.id} />
  </form>
{/each}
