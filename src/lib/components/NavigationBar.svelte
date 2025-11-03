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
  const maxRadius = 64;
  const iterations = 16;
  const blurLayers = Array.from({ length: iterations }, (_, i) => ({
    blur: maxRadius / (4 * maxRadius) ** (i / (iterations - 1)),
    maskStops: [
      Math.max(0, ((i - 2) * 100) / iterations),
      Math.max(0, ((i - 1) * 100) / iterations),
      (i * 100) / iterations,
      ((i + 1) * 100) / iterations
    ]
    // ... or reverse for the liquid glass effect
    // .toReversed()
    // .map((stop) => 100 - stop)
  }));

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
  class="navbar fixed top-0 z-999 w-full px-6 transition-colors duration-200 {textWhite} bg-linear-to-t from-transparent {isAtTop
    ? 'to-transparent'
    : 'to-base-100/50'}"
>
  <div class="pointer-events-none absolute inset-0 z-0">
    {#each blurLayers as layer, index (index)}
      <div
        class="absolute inset-0"
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
