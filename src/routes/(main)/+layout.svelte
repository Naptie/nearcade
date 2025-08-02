<script lang="ts">
  import Footer from '$lib/components/Footer.svelte';
  import LocaleSwitch from '$lib/components/LocaleSwitch.svelte';
  import SiteTitle from '$lib/components/SiteTitle.svelte';
  import FancyButton from '$lib/components/FancyButton.svelte';
  import { m } from '$lib/paraglide/messages';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import AuthModal from '$lib/components/AuthModal.svelte';
  import { page } from '$app/state';

  let { children } = $props();
  let scrollY = $state(0);
  let isAtTop = $derived(scrollY <= 10);
  let orgHasCustomBackground = $state(false);
  let textWhite = $derived(
    isAtTop && page.url.pathname.match(/\/(universities|clubs)\/\S+/) && orgHasCustomBackground
      ? 'text-white'
      : ''
  );

  const handleScroll = () => {
    scrollY = window.scrollY;
  };

  onMount(() => {
    if (browser) {
      scrollY = window.scrollY;
      const orgBackgroundCallback = (event: Event) => {
        const customEvent = event as CustomEvent;
        orgHasCustomBackground = customEvent.detail.hasCustomBackground;
      };
      window.addEventListener('scroll', handleScroll, { passive: true });
      window.addEventListener('nearcade-org-background', orgBackgroundCallback);
      return () => {
        window.removeEventListener('scroll', handleScroll);
        window.removeEventListener('nearcade-org-background', orgBackgroundCallback);
      };
    }
  });
</script>

<nav
  class="navbar fixed top-0 z-[999] w-full px-6 backdrop-blur-xl transition-all duration-200 {textWhite} {isAtTop
    ? 'bg-transparent'
    : 'bg-base-100/50 shadow lg:shadow-md'}"
>
  <div class="flex-1">
    <SiteTitle class="text-3xl md:text-4xl" />
  </div>
  <div class="flex-none">
    <div class="flex items-center gap-0.5 md:gap-1 lg:gap-2">
      <LocaleSwitch class="text-shadow" />
      <FancyButton
        callback={() => {
          window.dispatchEvent(new CustomEvent('nearcade-donate'));
        }}
        class="fa-solid fa-heart fa-lg text-shadow"
        btnCls="not-sm:hidden"
        text={m.donate()}
      />
      <FancyButton
        href="{base}/rankings"
        class="fa-solid fa-trophy fa-lg text-shadow"
        text={m.campus_rankings()}
      />
      <FancyButton href="{base}/" class="fa-solid fa-home fa-lg text-shadow" text={m.home()} />
      <AuthModal size="lg" class="text-shadow shadow" />
    </div>
  </div>
</nav>

{@render children()}

<Footer />
