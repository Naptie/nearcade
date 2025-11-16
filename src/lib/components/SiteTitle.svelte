<script lang="ts">
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';

  let { class: klass = '' } = $props();

  let appName = m.app_name();
  let midIndex = Math.ceil(appName.length / 2);
  let firstPart = appName.slice(0, midIndex);
  let secondPart = appName.slice(midIndex);
</script>

<a
  class="{getLocale() === 'zh'
    ? 'font-extrabold'
    : 'font-semibold'} tracking-tight select-none text-shadow-lg {klass}"
  href={resolve('/')}
>
  <span
    class="bg-linear-to-br from-sky-500 via-purple-500 to-rose-500 bg-clip-text pr-[0.03em] text-transparent"
  >
    {firstPart}
  </span><span>{secondPart}</span>
</a>
