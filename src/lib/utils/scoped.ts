import { env } from '$env/dynamic/public';
import { resolve, base } from '$app/paths';
import { page } from '$app/state';
import { redirect } from '@sveltejs/kit';

export const fromPath = (path: string) => {
  path = ((p) => (p.startsWith('/') ? p : `/${p}`))(path.trim());
  return `${env.PUBLIC_API_BASE || `${page.url.origin}${base}`}${path}`;
};

export const loginRedirect = (url: URL) => {
  throw redirect(302, resolve('/') + `?login=1&redirect=${encodeURIComponent(url.toString())}`);
};
