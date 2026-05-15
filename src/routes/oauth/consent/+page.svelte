<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { authClient } from '$lib/auth/client';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import { getScopeLabel, getScopeIcon } from './scope-labels';
  import { getDisplayName, pageTitle } from '$lib/utils';

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

<svelte:head>
  <title
    >{data.client?.name
      ? pageTitle(data.client.name, m.oauth_consent())
      : pageTitle(m.oauth_consent())}</title
  >
</svelte:head>

<div class="flex min-h-svh items-center justify-center p-4">
  <div class="card bg-base-100 w-full max-w-md shadow-xl">
    <div class="card-body gap-4 p-6 sm:p-8">
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
        {@const clientCreator = data.client.creator}

        <!-- Client info header -->
        <div class="flex flex-col items-center gap-3 text-center">
          {#if clientIcon}
            <img src={clientIcon} alt={clientName} class="h-16 w-16 rounded-xl object-cover" />
          {:else}
            <div class="bg-base-300 flex h-16 w-16 items-center justify-center rounded-xl">
              <i class="fa-solid fa-cube fa-2x text-base-content/40"></i>
            </div>
          {/if}

          <div>
            <h2 class="text-lg font-bold sm:text-xl">
              {m.oauth_consent_title({ app: clientName })}
            </h2>
            {#if clientUri}
              <a
                href={clientUri}
                target="_blank"
                rel="noopener noreferrer"
                class="text-base-content/90 mt-1 block text-xs underline decoration-transparent decoration-1 underline-offset-3 transition-colors hover:text-white hover:decoration-white"
              >
                {clientUri}
              </a>
            {/if}
            {#if clientCreator}
              <p class="text-base-content/60 mt-2 text-xs">
                {m.oauth_consent_created_by({
                  name: getDisplayName(clientCreator)
                })}
              </p>
            {/if}
          </div>
        </div>

        <!-- Signed in as -->
        <div class="bg-base-200 flex items-center gap-3 rounded-xl px-4 py-3">
          <UserAvatar user={data.user} size="sm" target={null} />
          <span class="text-base-content/70 truncate text-sm">
            {m.oauth_consent_signed_in_as({ name: data.user.displayName ?? data.user.name })}
          </span>
        </div>

        <div class="divider my-0"></div>

        <!-- Scope list -->
        <div>
          <p class="text-base-content/60 mb-3 text-xs font-medium tracking-wide uppercase">
            {m.oauth_consent_description()}
          </p>
          <ul class="space-y-2">
            {#each data.scopes as scope (scope)}
              <li class="bg-base-200 flex items-center gap-3 rounded-lg px-4 py-3">
                <i class="fa-solid {getScopeIcon(scope)} text-primary w-4 text-center text-sm"></i>
                <span class="text-sm">{getScopeLabel(scope)}</span>
              </li>
            {/each}
          </ul>
        </div>

        {#if errorMessage}
          <div class="alert alert-error">
            <i class="fa-solid fa-circle-exclamation"></i>
            <span class="text-sm">{errorMessage}</span>
          </div>
        {/if}

        <!-- Action buttons -->
        <div class="flex flex-col gap-2 sm:flex-row sm:gap-3">
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
