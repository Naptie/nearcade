import { browser } from '$app/environment';

export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'nearcade-theme';

export const DAISYUI_THEMES = {
  light: 'emerald',
  dark: 'forest'
} as const;

/**
 * Apply theme by setting appropriate data attributes
 */
export const applyTheme = (mode: ThemeMode): void => {
  if (!browser) return;

  const root = document.documentElement;
  root.setAttribute('data-theme', DAISYUI_THEMES[mode]);

  const head = document.head;
  const existingColorMetas = head.querySelectorAll('meta[name="theme-color"]');
  existingColorMetas.forEach(meta => head.removeChild(meta));
  const themeColorMeta = document.createElement('meta');
  themeColorMeta.name = "theme-color";
  themeColorMeta.content = mode === 'dark' ? '#1a1717' : '#ffffff';
  head.appendChild(themeColorMeta);
};

/**
 * Get stored theme from localStorage
 */
export const getStoredTheme = () => {
  return localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
};

/**
 * Store theme in localStorage
 */
export const setStoredTheme = (mode: ThemeMode): void => {
  if (!browser) return;
  localStorage.setItem(THEME_STORAGE_KEY, mode);
};

/**
 * Initialize theme on page load
 */
export const initializeTheme = (): ThemeMode => {
  let mode = getStoredTheme();
  if (!mode) {
    mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  applyTheme(mode);
  return mode;
};

/**
 * Get the next theme in the cycle: system -> light -> dark -> system
 */
export const getNextTheme = (current: ThemeMode): ThemeMode => {
  const themeOrder: ThemeMode[] = ['light', 'dark'];
  const currentIndex = themeOrder.indexOf(current);
  return themeOrder[(currentIndex + 1) % themeOrder.length];
};
