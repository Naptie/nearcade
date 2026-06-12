<script>
  import { GITHUB_LINK } from '$lib';
  import { m } from '$lib/paraglide/messages';
  import SiteTitle from './SiteTitle.svelte';

  let { class: klass = '' } = $props();
</script>

<div class="text-center select-none {klass}">
  <div class="text-base-content flex items-center justify-center gap-1.25 sm:gap-2 md:gap-3">
    <SiteTitle class="text-sm opacity-40 transition-opacity hover:opacity-75" />
    <span class="bg-base-content h-0.75 w-0.75 rounded-full opacity-40"></span>
    <button
      class="cursor-pointer text-xs opacity-40 transition-opacity hover:opacity-70"
      onclick={() => window.dispatchEvent(new CustomEvent('nearcade-donate'))}
    >
      <i class="fa-solid fa-heart"></i>
      {m.donate()}
    </button>
    <span class="bg-base-content h-0.75 w-0.75 rounded-full opacity-40"></span>
    <a
      href={GITHUB_LINK}
      target="_blank"
      class="text-xs opacity-40 transition-opacity hover:opacity-70"
    >
      <i class="fa-brands fa-github"></i>
      GitHub
    </a>
  </div>
</div>
