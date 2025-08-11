<script>
  import { m } from '$lib/paraglide/messages';

  let { class: klass = 'tooltip-right' } = $props();
</script>

<div class="tooltip {klass}" data-tip={m.verified()}>
  <span class="text-success relative">
    <i class="fa-solid fa-certificate fa-lg"></i>
    <span class="absolute inset-x-0 text-center">
      <i class="text-base-200 fa-solid fa-check fa-xs"></i>
    </span>
  </span>
</div>
