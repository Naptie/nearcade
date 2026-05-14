import { sequence } from '@sveltejs/kit/hooks';
import {
  redirect,
  error,
  type Handle,
  type HandleServerError,
  type ServerInit
} from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { handleAMapRequest } from '$lib/endpoints/amap.server';
import { m } from '$lib/paraglide/messages';
import { base } from '$app/paths';
import { getAvailableOSS } from '$lib/oss';
import { decompressLocationData } from '$lib/utils/url';
import { parseLegacyShopParams } from '$lib/utils/shops/id';
import { building } from '$app/environment';
import { auth } from '$lib/auth/index.server';
import { verifyOAuthAccessToken } from '$lib/auth/oauth-verify.server';
import { resolveRequiredScopes } from '$lib/auth/oauth-scopes';

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
  event.locals.oauthToken = null;
  const session = await auth.api.getSession({ headers: event.request.headers }).catch(() => null);
  event.locals.session = session as App.Locals['session'];
  event.locals.user = (session?.user as App.Locals['user']) ?? null;
  return svelteKitHandler({ event, resolve, auth, building });
};

/**
 * OAuth 2.1 scope gating for API routes.
 *
 * If a request carries a Bearer token that is NOT a nearcade API key (nk_),
 * it is validated as an OAuth JWT access token. The required scope is derived
 * from the request path + method. Admin/internal endpoints are blocked entirely.
 *
 * Session-cookie requests and API-key requests pass through unchanged.
 */
const handleOAuthScopes: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  // Only gate /api/ routes (skip auth routes which are handled by the plugin)
  if (!pathname.startsWith(`${base}/api/`) || pathname.startsWith(`${base}/api/auth/`)) {
    return resolve(event);
  }

  const authHeader = event.request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return resolve(event);
  }

  const token = authHeader.slice(7);

  // Skip nearcade API keys — they use their own auth flow
  if (token.startsWith('nk_')) {
    return resolve(event);
  }

  // Strip base path prefix to get canonical API path
  const apiPath = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const method = event.request.method;

  // Resolve required scopes for this path
  const requiredScopes = resolveRequiredScopes(apiPath, method);

  if (requiredScopes === null) {
    // Path is blocked for OAuth tokens
    error(403, 'This endpoint is not available for OAuth access');
  }

  // Verify the token and check scopes
  const payload = await verifyOAuthAccessToken(event.request, requiredScopes);
  if (payload) {
    event.locals.oauthToken = payload;
  }

  return resolve(event);
};

export const handle: Handle = sequence(
  handleOptions,
  handleParaglide,
  handleAMap,
  handleDiscoverShortcut,
  handleUserShortcut,
  handleLegacyShopPaths,
  handleHeaders,
  handleAuth,
  handleOAuthScopes
);

export const handleError: HandleServerError = reportError;

export const init: ServerInit = async () => {
  if (!building) {
    const meili = await import('$lib/db/meili.server');
    await meili.init();
    const mongo = (await import('$lib/db/index.server')).default;
    const redis = (await import('$lib/db/redis.server')).default;
    const oss = getAvailableOSS();
    console.log(
      [
        '                                     _       ',
        '  _ __   ___  __ _ _ __ ___ __ _  __| | ___  ',
        " | '_ \\ / _ \\/ _` | '__/ __/ _` |/ _` |/ _ \\ ",
        ' | | | |  __/ (_| | | | (_| (_| | (_| |  __/ ',
        ' |_| |_|\\___|\\__,_|_|  \\___\\__,_|\\__,_|\\___| ',
        '                                             '
      ].join('\n')
    );
    console.log('=============================================\n|');
    console.log(
      '| Disk DB:',
      mongo.options.hosts.map((h) => `mongodb://${h.toString()}`).join(', ')
    );
    console.log('| RAM DB:', redis.options?.url || 'connected');
    console.log('| Search:', `Meilisearch @ ${meili.default.config.host}`);
    console.log(
      '| OSS:',
      oss ? `${oss.name || 'unknown'} @ ${oss.url || 'unknown'}` : 'Not connected'
    );
    console.log('|\n=============================================');
  }
};
