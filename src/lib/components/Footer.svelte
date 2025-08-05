<script>
  import { GITHUB_LINK } from '$lib';
  import SiteTitle from './SiteTitle.svelte';

  let { class: klass = 'my-6' } = $props();
</script>

<div class="text-center select-none {klass}">
  <div class="text-base-content flex items-center justify-center gap-2">
    <SiteTitle class="text-sm opacity-40 transition-opacity hover:opacity-75" />
    <span class="bg-base-content h-0.75 w-0.75 rounded-full opacity-40"></span>
    <a
      href={GITHUB_LINK}
      target="_blank"
      class="text-xs opacity-40 transition-opacity hover:opacity-70"
    >
      <i class="fab fa-github"></i>
      GitHub
    </a>
  </div>
</div>
