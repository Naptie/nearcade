<script lang="ts">
  import { base } from '$app/paths';

  let { class: klass = '' } = $props();
</script>

<a class="font-bold tracking-tight select-none {klass}" href="{base}/">
  <span
    class="from-primary dark:via-secondary to-secondary dark:to-accent bg-gradient-to-br bg-clip-text pr-[0.03em] text-transparent"
  >
    near
  </span><span class="text-base-content">cade</span>
</a>
