<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { page } from '$app/state';
  import { authClient } from '$lib/auth/client';
  import { base } from '$app/paths';
  import { getProviders, pageTitle } from '$lib/utils';

  // Preserve the OAuth query string so that after sign-in the plugin
  // can continue the authorization flow automatically.
  const callbackURL = $derived(`/oauth/sign-in${page.url.search}`);
</script>

<svelte:head>
  <title>{pageTitle(m.sign_in(), m.profile())}</title>
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
            onclick={() => {
              authClient.signIn.oauth2({
                providerId: provider.id,
                callbackURL
              });
            }}
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
