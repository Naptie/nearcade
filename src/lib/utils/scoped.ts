import { resolve } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import { apiOrigin } from '$lib/api/origin';
import { getStoredTheme } from './theme';

export const fromPath = (path: string) => {
  path = ((p) => (p.startsWith('/') ? p : `/${p}`))(path.trim());
  return `${apiOrigin()}${path}`;
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
