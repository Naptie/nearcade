<script lang="ts">
  import LocaleSwitch from '$lib/components/LocaleSwitch.svelte';
  import SiteTitle from '$lib/components/SiteTitle.svelte';
  import FancyButton from '$lib/components/FancyButton.svelte';
  import { m } from '$lib/paraglide/messages';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import AuthModal from '$lib/components/AuthModal.svelte';
  import { beforeNavigate } from '$app/navigation';

  let scrollY = $state(0);
  let isAtTop = $derived(scrollY <= 10);
  let orgHasCustomBackground = $state<boolean | null>(null);
  let textWhite = $derived(
    isAtTop && orgHasCustomBackground !== null
      ? orgHasCustomBackground
        ? 'text-white'
        : 'dark:text-white'
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

  beforeNavigate(() => {
    orgHasCustomBackground = null;
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
      <LocaleSwitch class="text-shadow-lg" />
      <FancyButton
        callback={() => {
          window.dispatchEvent(new CustomEvent('nearcade-donate'));
        }}
        class="fa-solid fa-heart fa-lg text-shadow-lg"
        btnCls="btn-ghost btn-sm lg:btn-md not-ss:hidden"
        text={m.donate()}
      />
      <FancyButton
        href={resolve('/(main)/rankings')}
        class="fa-solid fa-trophy fa-lg text-shadow-lg"
        text={m.campus_rankings()}
      />
      <FancyButton
        href={resolve('/')}
        class="fa-solid fa-home fa-lg text-shadow-lg"
        btnCls="btn-ghost btn-sm lg:btn-md not-sm:hidden"
        text={m.home()}
      />
      <AuthModal size="lg" class="shadow-lg" />
    </div>
  </div>
</nav>
