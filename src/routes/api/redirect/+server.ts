import { env } from '$env/dynamic/private';
import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const uriParam = url.searchParams.get('uri')?.trim();
  if (!uriParam) {
    return error(400, 'Missing uri parameter');
  }

  const allowedOrigins = env.ALLOWED_ORIGINS?.split(',').map((u) => u.trim()) || [];
  if (
    !allowedOrigins.some((allowed) => uriParam.toLowerCase().startsWith(allowed.toLowerCase()))
  ) {
    return error(400, 'Invalid redirect URI');
  }

  const searchParams = new URLSearchParams(url.searchParams);
  searchParams.delete('uri');
  const uri = new URL(uriParam + '?' + searchParams.toString());

  redirect(302, uri);
};
