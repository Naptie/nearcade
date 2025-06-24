<script>
  import { GITHUB_LINK } from '$lib';
  import SiteTitle from './SiteTitle.svelte';

  let { class: klass = 'my-6' } = $props();
</script>

<div class="text-center {klass}">
  <div class="text-base-content/40 flex items-center justify-center gap-2">
    <SiteTitle class="text-sm opacity-40 transition hover:opacity-75" />
    <span class="text-xs">•</span>
    <a
      href={GITHUB_LINK}
      target="_blank"
      class="hover:text-base-content/60 text-xs transition-colors"
    >
      <i class="fab fa-github"></i>
      GitHub
    </a>
  </div>
</div>
