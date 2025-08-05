<script lang="ts">
  import { page } from '$app/state';
  import Error from '$lib/components/Error.svelte';

  let status = $derived(page.status);
  let errorMessage = $derived(page.error?.message || '');
</script>

<div class="container mx-auto flex min-h-screen items-center justify-center py-20 sm:px-4">
  <Error {status} {errorMessage} />
</div>
