<script lang="ts">
  import LocaleSwitch from '$lib/components/LocaleSwitch.svelte';
  import SiteTitle from '$lib/components/SiteTitle.svelte';
  import { onMount, onDestroy } from 'svelte';

  let { children } = $props();
  let scrollY = $state(0);
  let isAtTop = $derived(scrollY <= 10);

  const handleScroll = () => {
    scrollY = window.scrollY;
  };

  onMount(() => {
    scrollY = window.scrollY;
    window.addEventListener('scroll', handleScroll, { passive: true });
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', handleScroll);
    }
  });
</script>

<nav
  class="navbar fixed top-0 z-[999] w-full px-6 backdrop-blur-xl transition-all duration-200 {isAtTop
    ? 'bg-transparent'
    : 'bg-base-100/50 shadow lg:shadow-md'}"
>
  <div class="flex-1">
    <SiteTitle class="text-3xl md:text-4xl" />
  </div>
  <div class="flex-none">
    <div class="flex items-center gap-1">
      <LocaleSwitch />
      <a class="btn btn-square btn-ghost" href="/" aria-label="Home">
        <i class="fa-solid fa-home"></i>
      </a>
    </div>
  </div>
</nav>
{@render children()}
