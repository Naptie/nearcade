import { env } from '$env/dynamic/public';
import { resolve, base } from '$app/paths';
import { page } from '$app/state';
import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { getStoredTheme } from './theme';

export const fromPath = (path: string) => {
  path = ((p) => (p.startsWith('/') ? p : `/${p}`))(path.trim());
  return `${env.PUBLIC_API_BASE || (browser ? `${page.url.origin}${base}` : '')}${path}`;
};

export const loginRedirect = (url: URL) => {
  throw redirect(302, resolve('/') + `?login=1&redirect=${encodeURIComponent(url.toString())}`);
};

export const isDarkMode = (): boolean => {
  const theme = getStoredTheme();
  if (theme !== null) {
    return theme === 'dark';
  }
  const darkModeMediaQuery = window?.matchMedia('(prefers-color-scheme: dark)');
  return darkModeMediaQuery?.matches;
};
