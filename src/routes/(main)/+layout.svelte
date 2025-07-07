<script lang="ts">
  import Footer from '$lib/components/Footer.svelte';
  import LocaleSwitch from '$lib/components/LocaleSwitch.svelte';
  import SiteTitle from '$lib/components/SiteTitle.svelte';
  import FancyButton from '$lib/components/FancyButton.svelte';
  import { m } from '$lib/paraglide/messages';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  let { children } = $props();
  let scrollY = $state(0);
  let isAtTop = $derived(scrollY <= 10);

  const handleScroll = () => {
    scrollY = window.scrollY;
  };

  onMount(() => {
    if (browser) {
      scrollY = window.scrollY;
      window.addEventListener('scroll', handleScroll, { passive: true });
      return () => {
        window.removeEventListener('scroll', handleScroll);
      };
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
    <div class="flex items-center gap-0.5 md:gap-1 lg:gap-2">
      <LocaleSwitch />
      <FancyButton
        callback={() => {
          window.dispatchEvent(new CustomEvent('nearcade-donate'));
        }}
        class="fa-solid fa-heart fa-lg"
        btnCls="not-sm:hidden"
        text={m.donate()}
      />
      <FancyButton href="/rankings" class="fa-solid fa-trophy fa-lg" text={m.campus_rankings()} />
      <FancyButton href="/" class="fa-solid fa-home fa-lg" text={m.home()} />
    </div>
  </div>
</nav>

{@render children()}

<Footer />
