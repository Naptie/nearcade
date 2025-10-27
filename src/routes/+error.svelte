<script lang="ts">
  import { page } from '$app/state';
  import Error from '$lib/components/Error.svelte';
  import LocaleSwitch from '$lib/components/LocaleSwitch.svelte';

  let status = $derived(page.status);
  let errorMessage = $derived(page.error?.message || '');
</script>

<div
  class="from-base-200 via-base-100 to-base-200 flex min-h-screen items-center justify-center bg-linear-to-br p-4"
>
  <!-- Locale Switch in top-right corner -->
  <div class="absolute top-4 right-4 z-10">
    <LocaleSwitch />
  </div>
  <Error {status} {errorMessage} />
</div>
