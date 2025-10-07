<script lang="ts">
  import { onMount } from 'svelte';
  import { m } from '$lib/paraglide/messages';
  import FancyButton from './FancyButton.svelte';
  import {
    type ThemeMode,
    applyTheme,
    setStoredTheme,
    getNextTheme,
    initializeTheme
  } from '$lib/utils/theme';

  let { class: klass = '' } = $props();

  let currentTheme = $state<ThemeMode>('light');
  let isInitialized = $state(false);

  // Cycle through themes and save to storage
  const toggleTheme = () => {
    const nextTheme = getNextTheme(currentTheme);
    currentTheme = nextTheme;
    applyTheme(nextTheme);
    setStoredTheme(nextTheme);
  };

  onMount(() => {
    currentTheme = initializeTheme();
    isInitialized = true;
  });

  // Get display icon based on current theme mode
  let themeIcon = $derived.by(() => {
    switch (currentTheme) {
      case 'light':
        return 'sun';
      case 'dark':
        return 'moon';
      default:
        return 'circle-half-stroke';
    }
  });

  // Get display text for current theme mode
  let themeText = $derived.by(() => {
    switch (currentTheme) {
      case 'light':
        return m.theme_light();
      case 'dark':
        return m.theme_dark();
      default:
        return m.theme_system();
    }
  });
</script>

{#if isInitialized}
  {#snippet content()}
    <span class="flex items-center gap-2">
      <span>{m.switch_theme()}</span>
      <span class="text-xs opacity-70">({themeText})</span>
    </span>
  {/snippet}

  <FancyButton
    class="fa-solid fa-{themeIcon} fa-lg {klass}"
    btnCls="btn-ghost btn-sm lg:btn-md"
    {content}
    callback={toggleTheme}
    stayExpandedOnWideScreens
  />
{/if}
