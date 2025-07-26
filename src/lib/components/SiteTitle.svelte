<script lang="ts">
  import { base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';

  let { class: klass = '' } = $props();

  let appName = m.app_name();
  let midIndex = Math.floor(appName.length / 2);
  let firstPart = appName.slice(0, midIndex);
  let secondPart = appName.slice(midIndex);
</script>

<a class="font-semibold tracking-tight select-none text-shadow-lg {klass}" href="{base}/">
  <span
    class="bg-gradient-to-br from-sky-500 via-purple-500 to-rose-500 bg-clip-text pr-[0.03em] text-transparent"
  >
    {firstPart}
  </span><span class="text-base-content">{secondPart}</span>
</a>
