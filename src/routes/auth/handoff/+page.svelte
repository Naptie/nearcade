<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { pageTitle } from '$lib/utils';
  import CopyField from '$lib/components/CopyField.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  $effect(() => {
    if (data.authenticated) {
      const storedMarker = sessionStorage.getItem('nearcade-browser-marker');
      const urlMarker = page.url.searchParams.get('marker');
      if (storedMarker && urlMarker && storedMarker === urlMarker) {
        // Same browser — just forward to home.
        goto('/', { replaceState: true });
      }
      // Different browser — stay on this page and show the one-time code.
    }
  });
</script>

<svelte:head>
  <title>{pageTitle(m.auth_handoff_title())}</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center p-4">
  <div class="card bg-base-100 w-full max-w-md shadow-xl">
    <div class="card-body items-center text-center">
      {#if !data.authenticated}
        <i class="fa-solid fa-triangle-exclamation text-warning mb-4 text-5xl"></i>
        <h2 class="card-title text-xl font-bold">{m.error_occurred()}</h2>
        <p class="text-base-content/70 mb-4 text-sm">
          {m.auth_handoff_error()}
        </p>
        <a href="/" class="btn btn-primary">{m.go_home()}</a>
      {:else}
        <i class="fa-solid fa-check-circle text-success mb-4 text-5xl"></i>
        <h2 class="card-title text-xl font-bold">{m.auth_handoff_success()}</h2>
        <p class="text-base-content/70 mb-4 text-sm">
          {m.auth_handoff_success_description()}
        </p>

        <div class="rounded-box bg-base-200 w-full space-y-3 p-4 text-left">
          <p class="text-sm font-medium">{m.sessions_code_label()}</p>
          <CopyField value={data.token} display="input" size="sm" />
          <p class="text-base-content/65 text-sm">
            {m.auth_handoff_instructions()}
          </p>
        </div>
      {/if}
    </div>
  </div>
</div>
