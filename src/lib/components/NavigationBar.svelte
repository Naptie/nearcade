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

  // Gradient blur configuration with exponential blur values
  // Each layer uses CSS mask to create smooth transitions and avoid edge artifacts
  const blurLayers = [
    { blur: 0.5, maskStops: [0, 12.5, 25, 37.5] },
    { blur: 1, maskStops: [12.5, 25, 37.5, 50] },
    { blur: 2, maskStops: [25, 37.5, 50, 62.5] },
    { blur: 4, maskStops: [37.5, 50, 62.5, 75] },
    { blur: 8, maskStops: [50, 62.5, 75, 87.5] },
    { blur: 16, maskStops: [62.5, 75, 87.5, 100] },
    { blur: 32, maskStops: [75, 87.5, 100, 100] },
    { blur: 64, maskStops: [87.5, 100, 100, 100] }
  ];

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
  class="navbar fixed top-0 z-[999] w-full px-6 transition-all duration-200 {textWhite} {isAtTop
    ? 'bg-transparent'
    : 'bg-base-100/50 shadow lg:shadow-md'}"
>
  <!-- Gradient blur layers with CSS masks to avoid edge artifacts -->
  <div class="pointer-events-none absolute inset-0 z-0">
    {#each blurLayers as layer, index (index)}
      <div
        class="absolute inset-0 transition-all duration-200"
        style="backdrop-filter: blur({layer.blur}px); mask-image: linear-gradient(to bottom, rgba(0,0,0,0) {layer
          .maskStops[0]}%, rgba(0,0,0,1) {layer.maskStops[1]}%, rgba(0,0,0,1) {layer
          .maskStops[2]}%, rgba(0,0,0,0) {layer
          .maskStops[3]}%); -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0) {layer
          .maskStops[0]}%, rgba(0,0,0,1) {layer.maskStops[1]}%, rgba(0,0,0,1) {layer
          .maskStops[2]}%, rgba(0,0,0,0) {layer.maskStops[3]}%);"
      ></div>
    {/each}
  </div>

  <div class="relative z-10 flex-1">
    <div class="absolute top-1/2 left-0 z-0 -translate-y-1/2">
      <SiteTitle class="xs:text-2xl ss:text-3xl text-lg md:text-4xl" />
    </div>
  </div>
  <div class="relative z-10 flex items-center gap-0.5 md:gap-1 lg:gap-2">
    <LocaleSwitch class="text-shadow-lg" />
    <FancyButton
      callback={() => {
        window.dispatchEvent(new CustomEvent('nearcade-donate'));
      }}
      class="fa-solid fa-heart fa-lg text-shadow-lg"
      btnCls="btn-ghost btn-sm lg:btn-md not-ss:hidden"
      text={m.donate()}
      stayExpandedOnWideScreens
    />
    <FancyButton
      href={resolve('/globe')}
      class="fa-solid fa-globe fa-lg text-shadow-lg"
      text={m.globe()}
      stayExpandedOnWideScreens
    />
    <FancyButton
      href={resolve('/(main)/rankings')}
      class="fa-solid fa-trophy fa-lg text-shadow-lg"
      text={m.campus_rankings()}
      stayExpandedOnWideScreens
    />
    <FancyButton
      href={resolve('/')}
      class="fa-solid fa-home fa-lg text-shadow-lg"
      btnCls="btn-ghost btn-sm lg:btn-md not-sm:hidden"
      text={m.home()}
      stayExpandedOnWideScreens
    />
    <AuthModal size="lg" class="shadow-lg" />
  </div>
</nav>
