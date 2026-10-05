<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  interface Props {
    label?: string;
  }
  let { label }: Props = $props();
</script>

<div class="py-12 text-center">
  <span class="loading loading-spinner loading-lg"></span>
  <p class="text-base-content/60 mt-2">{label ?? m.loading()}</p>
</div>
