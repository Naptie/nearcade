import { sequence } from '@sveltejs/kit/hooks';
import { redirect, type Handle, type HandleServerError, type ServerInit } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { handleAMapRequest } from '$lib/endpoints/amap.server';
import { m } from '$lib/paraglide/messages';
import { base } from '$app/paths';
import { isOSSAvailable } from '$lib/oss';
import { decompressLocationData } from '$lib/utils/url';
import { parseLegacyShopParams } from '$lib/utils/shops/id';
import { building } from '$app/environment';

const reportError: HandleServerError = ({ status, error }) => {
  if (status === 404) {
    return {
      message: '',
      code: ''
    };
  }
  console.error(error);
  return {
    message: m.unexpected_error(),
    code: 'INTERNAL_ERROR'
  };
};

const handleOptions: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  if (event.request.method === 'OPTIONS' && pathname.startsWith(`${base}/api/`)) {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': '*'
      }
    });
  }
  return resolve(event);
};

const handleParaglide: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;

    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
    });
  });

const handleHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  const { pathname } = event.url;
  if (pathname.startsWith(`${base}/api/`)) {
    try {
      response.headers.set('Access-Control-Allow-Origin', '*');
      response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', '*');
    } catch {
      // Intentionally ignore errors when setting headers
    }
  }
  return response;
};

const handleAMap: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  // Check if this is an AMap service request
  if (pathname.includes('/_AMapService/')) {
    return await handleAMapRequest(event);
  }

  // Otherwise, proceed with normal request handling
  return resolve(event);
};

const handleDiscoverShortcut: Handle = async ({ event, resolve }) => {
  const { pathname, search } = event.url; // `search` is the raw string, e.g., "?d=..."

  // We check for the root path '/' and a search query starting with '?d='
  if (pathname === '/' && search.startsWith('?d=')) {
    // Get the raw, non-decoded 'd' value
    const d = search.substring(3);
    let targetUrl: string | null = null;

    try {
      // Decompress the data
      const { latitude, longitude, radius, name } = decompressLocationData(d);

      // Build the target URL
      const targetParams = new URLSearchParams();
      targetParams.set('latitude', latitude.toString());
      targetParams.set('longitude', longitude.toString());
      targetParams.set('radius', radius.toString());
      targetParams.set('name', name);

      targetUrl = `/discover?${targetParams.toString()}`;
    } catch (error) {
      console.error('Failed to decompress shortcut URL:', error);
    }

    if (targetUrl) {
      // Redirect to the constructed discover URL
      redirect(308, targetUrl);
    }
  }

  // Otherwise, proceed with normal request handling
  return resolve(event);
};

const handleUserShortcut: Handle = async ({ event, resolve }) => {
  const { pathname, search } = event.url;

  // Check if this is a shortcut link to a user profile
  if (pathname.startsWith('/@')) {
    redirect(308, `/users/${pathname.slice(1)}${search}`);
  }

  // Otherwise, proceed with normal request handling
  return resolve(event);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const handleLegacyShopPaths: Handle = async ({ event, resolve }) => {
  const { pathname, search } = event.url;
  const escapedBase = escapeRegExp(base);

  // Match /shops/:source/:id
  const shopPathRegex = new RegExp(`^${escapedBase}/shops/([^/]+)/([^/]+)/?$`);
  const shopMatch = pathname.match(shopPathRegex);
  if (shopMatch) {
    const parsed = parseLegacyShopParams(shopMatch[1], shopMatch[2]);
    if (parsed) {
      redirect(308, `${base}/shops/${parsed.unifiedId}${search}`);
    }
  }

  // Match /api/shops/:source/:id/*
  const apiPathRegex = new RegExp(`^${escapedBase}/api/shops/([^/]+)/([^/]+)(/.*)?$`);
  const apiMatch = pathname.match(apiPathRegex);
  if (apiMatch) {
    const parsed = parseLegacyShopParams(apiMatch[1], apiMatch[2]);
    if (parsed) {
      const suffix = apiMatch[3] || '';
      redirect(308, `${base}/api/shops/${parsed.unifiedId}${suffix}${search}`);
    }
  }

  return resolve(event);
};

const handleAuth: Handle = async ({ event, resolve }) => {
  const { auth } = await import('$lib/auth/index.server');
  const session = await auth.api.getSession({ headers: event.request.headers }).catch(() => null);
  event.locals.session = session as App.Locals['session'];
  event.locals.user = (session?.user as App.Locals['user']) ?? null;
  return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = sequence(
  handleOptions,
  handleParaglide,
  handleAMap,
  handleDiscoverShortcut,
  handleUserShortcut,
  handleLegacyShopPaths,
  handleHeaders,
  handleAuth
);

export const handleError: HandleServerError = reportError;

export const init: ServerInit = async () => {
  if (!building) {
    await (await import('$lib/db/meili.server')).init();
    console.log(isOSSAvailable() ? 'OSS is available' : 'OSS is not available');
  }
};
