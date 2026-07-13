import { sequence } from '@sveltejs/kit/hooks';
import pc from 'picocolors';
import {
  redirect,
  error,
  isHttpError,
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
import { SSC_SECRET } from '$env/static/private';
import { lookupIpRegion } from '$lib/endpoints/ip-lookup.server';

const reportError: HandleServerError = ({ status, error }) => {
  if (isHttpError(error)) {
    const body = error.body;
    const message = typeof body === 'string' ? body : body?.message;
    return {
      message: status === 404 ? '' : message || m.unexpected_error(),
      code: String(status)
    };
  }

  console.error(error);
  return {
    message: m.unexpected_error(),
    code: '500'
  };
};

const resolveOAuthScopeRequirement = (event: RequestEvent) => {
  const { pathname } = event.url;
  const authHeader = event.request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return undefined;
  }

  const token = authHeader.slice(7);
  if (token.startsWith('nk_') || token === SSC_SECRET) {
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

const stripBase = (pathname: string) => {
  if (!base) return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
};

const handleLegacyShopPaths: Handle = async ({ event, resolve }) => {
  const { pathname, search } = event.url;
  const pathWithoutBase = stripBase(pathname);

  const legacyShopMatch = pathWithoutBase.match(/^\/shops\/([^/]*)\/([^/]+)\/?$/);
  if (legacyShopMatch) {
    const parsed = parseLegacyShopParams(legacyShopMatch[1], legacyShopMatch[2]);

    if (parsed) {
      redirect(
        308,
        `${base}/shops/${parsed.unifiedId}${search ? `${search}&legacy=1` : '?legacy=1'}`
      );
    }
  }

  const legacyAttendanceMatch = pathWithoutBase.match(
    /^\/api\/shops\/([^/]*)\/([^/]+)(\/attendance(?:\/.*)?)$/
  );

  if (legacyAttendanceMatch) {
    const parsed = parseLegacyShopParams(legacyAttendanceMatch[1], legacyAttendanceMatch[2]);
    const shopIdNum = parsed?.unifiedId;

    if (shopIdNum !== undefined) {
      try {
        const body = await event.request.json();
        if (body && typeof body === 'object' && body.games && Array.isArray(body.games)) {
          body.games = body.games.map((game: unknown) => {
            if (game && typeof game === 'object' && 'id' in game && typeof game.id === 'number') {
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

const handleRequestLogging: Handle = async ({ event, resolve }) => {
  const cfIp = event.request.headers.get('cf-connecting-ip');
  const aliIp = event.request.headers.get('ali-cdn-real-ip');
  const xff = event.request.headers.get('x-forwarded-for');
  const userAgent = event.request.headers.get('user-agent');

  const detectedIp = cfIp || aliIp || xff?.split(',')[0]?.trim() || null;
  const region = detectedIp ? await lookupIpRegion(detectedIp, event.request) : null;
  const user = event.locals.user;

  const method = pc.bold(pc.cyan(event.request.method));

  const path = event.url.pathname;

  const userName = user?.name ?? user?.email ?? 'Anonymous';
  const userDisplay = pc.green(userName);

  const ip = detectedIp ? pc.yellow(detectedIp) : pc.gray('direct');
  const regionDisplay = region?.display ?? 'unknown';

  const uaDisplay = pc.dim(pc.gray(userAgent || '-'));

  const sep = pc.dim(pc.gray(' | '));
  const arrow = pc.dim(pc.gray(' → '));

  console.log(
    `${method} ${path}${sep}${userDisplay}${sep}${ip}${arrow}${regionDisplay}${sep}${uaDisplay}`
  );

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
  handleRequestLogging
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
