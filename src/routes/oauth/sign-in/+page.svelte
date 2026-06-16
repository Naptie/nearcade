<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { page } from '$app/state';
  import { authClient } from '$lib/auth/client';
  import { withPostLoginMarker } from '$lib/auth/email';
  import { base, resolve } from '$app/paths';
  import { getProviders, pageTitle } from '$lib/utils';

  // Preserve the OAuth query string so that after sign-in the plugin
  // can continue the authorization flow automatically.
  const callbackURL = $derived(withPostLoginMarker(page.url));

  let handoffCode = $state('');
  let redeemError = $state<string | null>(null);
  let isRedeemingCode = $state(false);

  const handleProviderSignIn = (providerId: string) => {
    if (providerId === 'qq') {
      const marker = crypto.randomUUID();
      sessionStorage.setItem('nearcade-browser-marker', marker);
      authClient.signIn.oauth2({
        providerId: 'qq',
        callbackURL: `${resolve('/auth/handoff')}?marker=${marker}`
      });
    } else {
      authClient.signIn.oauth2({
        providerId,
        callbackURL
      });
    }
  };

  const redeemOneTimeCode = async () => {
    const token = handoffCode.trim();
    if (!token) {
      redeemError = m.sessions_code_required();
      return;
    }

    isRedeemingCode = true;
    redeemError = null;

    try {
      await authClient.oneTimeToken.verify({ token });
      handoffCode = '';
      window.location.reload();
    } catch (err) {
      console.error('Failed to redeem one-time code:', err);
      redeemError = m.sessions_code_invalid();
    } finally {
      isRedeemingCode = false;
    }
  };
</script>

<svelte:head>
  <title>{pageTitle(m.sign_in())}</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center p-4">
  <div class="card bg-base-100 w-full max-w-md shadow-xl">
    <div class="card-body">
      <h2 class="card-title justify-center text-xl font-bold">{m.sign_in()}</h2>
      <p class="text-base-content/60 mb-4 text-center text-sm">
        {m.oauth_sign_in_prompt()}
      </p>

      <div class="flex flex-col gap-3">
        {#each getProviders() as provider (provider.id)}
          <button
            type="button"
            onclick={() => handleProviderSignIn(provider.id)}
            class="btn btn-outline btn-t w-full items-center gap-2 py-5 {provider.class}"
          >
            {#if provider.icon.startsWith('fa-')}
              <i class="fa-brands fa-lg {provider.icon}"></i>
            {:else}
              <img
                src="{base}/{provider.icon}"
                alt="{provider.name} {m.provider_logo()}"
                class="h-5 w-5 rounded-full"
              />
            {/if}
            <span>{m.sign_in_with({ provider: provider.name })}</span>
          </button>
        {/each}
      </div>

      <div class="divider my-2">OR</div>

      <div class="space-y-3 text-left">
        <div class="flex items-center gap-2">
          <input
            id="handoff-code-input"
            class="input input-bordered w-full font-mono"
            bind:value={handoffCode}
            placeholder={m.sessions_code_label()}
            autocomplete="one-time-code"
            spellcheck="false"
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                redeemOneTimeCode();
              }
            }}
          />
          <button
            type="button"
            class="btn btn-primary btn-soft btn-circle"
            onclick={redeemOneTimeCode}
            disabled={isRedeemingCode}
            title={m.sessions_code_submit()}
          >
            <i class="fa-solid fa-arrow-right-to-bracket"></i>
          </button>
        </div>
        {#if redeemError}
          <div class="alert alert-error py-2 text-sm">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>{redeemError}</span>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .btn-t {
    transition-property:
      color, background-color, border-color, box-shadow, --tw-gradient-from, --tw-gradient-via,
      --tw-gradient-to;
    transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
    transition-duration: 300ms;
  }
</style>
