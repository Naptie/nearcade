import { sequence } from '@sveltejs/kit/hooks';
import {
  redirect,
  error,
  type RequestEvent,
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
import {
  EMAIL_SETTINGS_ROUTE,
  POST_LOGIN_EMAIL_PROMPT_QUERY_PARAM,
  requiresEmailBinding,
  stripPostLoginMarker
} from '$lib/auth/email';
import { resolveOAuthAccessTokenSession } from '$lib/auth/oauth/verify.server';
import { resolveRequiredScopes } from '$lib/auth/oauth/scopes';

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

const resolveOAuthScopeRequirement = (event: RequestEvent) => {
  const { pathname } = event.url;
  const authHeader = event.request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return undefined;
  }

  const token = authHeader.slice(7);
  if (token.startsWith('nk_')) {
    return undefined;
  }

  if (!pathname.startsWith(`${base}/api/`) || pathname.startsWith(`${base}/api/auth/`)) {
    return undefined;
  }

  const apiPath = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return resolveRequiredScopes(apiPath, event.request.method);
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

const sanitizeConnectionUrl = (value?: string) => {
  if (!value) {
    return 'connected';
  }

  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value.replace(/^(\w+:\/\/)(?:[^@/]+@)/, '$1');
  }
};

const handleLegacyShopPaths: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const escapedBase = escapeRegExp(base);

  // Match /shops/:source/:id — rewrite to unified shop path
  const shopPathRegex = new RegExp(`^${escapedBase}/shops/([^/]*)/([^/]+)/?$`);
  const shopMatch = pathname.match(shopPathRegex);
  if (shopMatch) {
    const parsed = parseLegacyShopParams(shopMatch[1], shopMatch[2]);
    if (parsed) {
      event.url.pathname = `${base}/shops/${parsed.unifiedId}`;
      event.url.searchParams.set('legacy', '1');
    }
  }

  // Match /api/shops/:source/:id/* — rewrite to unified API path
  const apiPathRegex = new RegExp(`^${escapedBase}/api/shops/([^/]*)/([^/]+)(/.*)?$`);
  const apiMatch = pathname.match(apiPathRegex);
  if (apiMatch) {
    const parsed = parseLegacyShopParams(apiMatch[1], apiMatch[2]);
    if (parsed) {
      const suffix = apiMatch[3] || '';
      event.url.pathname = `${base}/api/shops/${parsed.unifiedId}${suffix}`;
      event.url.searchParams.set('legacy', '1');
    }
  }

  // When handling a request with the legacy marker, adjust attendance payload
  if (event.url.searchParams.get('legacy') === '1') {
    const attendancePathRegex = new RegExp(`^${escapedBase}/api/shops/([^/]+)/attendance(/.*)?$`);
    const attendanceMatch = event.url.pathname.match(attendancePathRegex);
    const shopId = attendanceMatch ? attendanceMatch[1] : null;
    if (shopId) {
      try {
        const body = await event.request.json();
        if (body && typeof body === 'object' && body.games && Array.isArray(body.games)) {
          body.games = body.games.map((game: unknown) => {
            if (game && typeof game === 'object' && 'id' in game && typeof game.id === 'number') {
              const shopIdNum = parseInt(shopId);
              return {
                ...game,
                id: Math.floor(game.id / 1000) === shopIdNum ? game.id : shopIdNum * 1000
              };
            }
            return game;
          });
          event.request = new Request(event.request, { body: JSON.stringify(body) });
        }
      } catch {
        // proceed without modification if parsing fails
      }
    }
  }

  return resolve(event);
};

const handleAuth: Handle = async ({ event, resolve }) => {
  const oauthScopeRequirement = resolveOAuthScopeRequirement(event);

  if (oauthScopeRequirement === null) {
    error(403, m.access_denied());
  }

  const session =
    oauthScopeRequirement !== undefined
      ? await resolveOAuthAccessTokenSession(event, oauthScopeRequirement)
      : await auth.api.getSession({ headers: event.request.headers }).catch(() => null);

  event.locals.session = session as App.Locals['session'];
  event.locals.user = (session?.user as App.Locals['user']) ?? null;

  const shouldPromptForEmail =
    event.request.method === 'GET' &&
    event.request.headers.get('accept')?.includes('text/html') &&
    event.url.searchParams.get(POST_LOGIN_EMAIL_PROMPT_QUERY_PARAM) === '1' &&
    requiresEmailBinding(session?.user);

  if (shouldPromptForEmail) {
    const emailSettingsPath = `${base}${EMAIL_SETTINGS_ROUTE}`;

    if (event.url.pathname !== emailSettingsPath) {
      const redirectTarget = stripPostLoginMarker(event.url);
      const promptUrl = new URL(event.url);
      promptUrl.pathname = emailSettingsPath;
      promptUrl.search = '';
      promptUrl.searchParams.set('prompt', '1');
      promptUrl.searchParams.set('continue', redirectTarget);
      redirect(303, `${promptUrl.pathname}?${promptUrl.searchParams.toString()}`);
    }
  }

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
      '| Persistent Store:',
      mongo.options.hosts.map((h) => `mongodb://${h.toString()}`).join(', ')
    );
    console.log('| Cache Store:', sanitizeConnectionUrl(redis.options?.url));
    console.log('| Search:', `Meilisearch @ ${meili.default.config.host}`);
    console.log(
      '| OSS:',
      oss ? `${oss.name || 'unknown'} @ ${oss.url || 'unknown'}` : 'Not connected'
    );
    console.log('|\n=============================================');
  }
};
