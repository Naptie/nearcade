<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { authClient } from '$lib/auth/client';
  import { getScopeLabel, getScopeIcon } from './scope-labels';

  let { data } = $props();

  let loading = $state(false);
  let errorMessage = $state('');

  async function handleConsent(accept: boolean) {
    loading = true;
    errorMessage = '';
    try {
      const { error } = await authClient.oauth2.consent({
        accept,
        scope: accept ? data.scopes.join(' ') : undefined
      });
      if (error) {
        errorMessage = error.message ?? m.oauth_consent_error();
      }
      // On success the plugin redirects automatically
    } catch {
      errorMessage = m.oauth_consent_error();
    } finally {
      loading = false;
    }
  }
</script>

<div class="flex min-h-screen items-center justify-center p-4">
  <div class="card bg-base-100 w-full max-w-lg shadow-xl">
    <div class="card-body">
      {#if data.error === 'missing_client_id'}
        <div class="alert alert-error">
          <i class="fa-solid fa-circle-exclamation"></i>
          <span>{m.oauth_consent_missing_client()}</span>
        </div>
      {:else if data.error === 'invalid_client'}
        <div class="alert alert-error">
          <i class="fa-solid fa-circle-exclamation"></i>
          <span>{m.oauth_consent_invalid_client()}</span>
        </div>
      {:else if data.client}
        {@const clientName = data.client.name}
        {@const clientIcon = data.client.icon}
        {@const clientUri = data.client.uri}
        <!-- Client info header -->
        <div class="flex flex-col items-center gap-3">
          {#if clientIcon}
            <img src={clientIcon} alt={clientName} class="h-16 w-16 rounded-xl" />
          {:else}
            <div class="bg-base-300 flex h-16 w-16 items-center justify-center rounded-xl">
              <i class="fa-solid fa-cube fa-2x text-base-content/40"></i>
            </div>
          {/if}

          <h2 class="text-center text-xl font-bold">
            {m.oauth_consent_title({ app: clientName })}
          </h2>

          {#if clientUri}
            <a
              href={clientUri}
              target="_blank"
              rel="noopener noreferrer"
              class="link link-primary text-sm"
            >
              {clientUri}
            </a>
          {/if}
        </div>

        <div class="divider"></div>

        <!-- Scope list -->
        <p class="text-base-content/70 mb-2 text-sm">
          {m.oauth_consent_description()}
        </p>

        <ul class="space-y-2">
          {#each data.scopes as scope (scope)}
            <li class="bg-base-200 flex items-center gap-3 rounded-lg px-4 py-3">
              <i class="fa-solid {getScopeIcon(scope)} text-primary w-5 text-center"></i>
              <span class="text-sm">{getScopeLabel(scope)}</span>
            </li>
          {/each}
        </ul>

        {#if errorMessage}
          <div class="alert alert-error mt-4">
            <i class="fa-solid fa-circle-exclamation"></i>
            <span>{errorMessage}</span>
          </div>
        {/if}

        <!-- Action buttons -->
        <div class="mt-6 flex gap-3">
          <button
            class="btn btn-outline flex-1"
            disabled={loading}
            onclick={() => handleConsent(false)}
          >
            {m.oauth_consent_deny()}
          </button>
          <button
            class="btn btn-primary flex-1"
            disabled={loading}
            onclick={() => handleConsent(true)}
          >
            {#if loading}
              <span class="loading loading-spinner loading-sm"></span>
            {/if}
            {m.oauth_consent_accept()}
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>
