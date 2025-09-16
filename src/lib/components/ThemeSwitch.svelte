<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { m } from '$lib/paraglide/messages';
  import FancyButton from './FancyButton.svelte';

  let { class: klass = '' } = $props();

  // Theme states
  const THEMES = {
    light: 'emerald',
    dark: 'forest'
  } as const;

  let currentTheme = $state<'light' | 'dark'>('light');
  let isInitialized = $state(false);

  // Initialize theme from localStorage or system preference
  const initializeTheme = () => {
    if (!browser) return;

    const stored = localStorage.getItem('nearcade-theme');
    if (stored === 'light' || stored === 'dark') {
      currentTheme = stored;
    } else {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      currentTheme = prefersDark ? 'dark' : 'light';
    }

    applyTheme(currentTheme);
    isInitialized = true;
  };

  // Apply theme to the document
  const applyTheme = (theme: 'light' | 'dark') => {
    if (!browser) return;

    const daisyTheme = THEMES[theme];
    document.documentElement.setAttribute('data-theme', daisyTheme);
  };

  // Toggle between light and dark themes
  const toggleTheme = () => {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    currentTheme = newTheme;
    
    applyTheme(newTheme);
    localStorage.setItem('nearcade-theme', newTheme);
  };

  onMount(() => {
    initializeTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      // Only apply system preference if user hasn't manually set a theme
      if (!localStorage.getItem('nearcade-theme')) {
        currentTheme = e.matches ? 'dark' : 'light';
        applyTheme(currentTheme);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  });
</script>

{#if isInitialized}
  {#snippet content()}
    <span>{currentTheme === 'light' ? m.theme_light() : m.theme_dark()}</span>
  {/snippet}
  
  <FancyButton
    class="fa-solid fa-{currentTheme === 'light' ? 'moon' : 'sun'} fa-lg {klass}"
    btnCls="btn-ghost btn-sm lg:btn-md"
    {content}
    callback={toggleTheme}
  />
{/if}
</script>