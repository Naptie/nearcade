import { sequence } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import { redirect, type Handle, type HandleServerError, type ServerInit } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { handle as handleAuth } from '$lib/auth/index.server';
import { env } from '$env/dynamic/public';
import redis from '$lib/db/redis.server';
import { handleAMapRequest } from '$lib/endpoints/amap.server';
import { m } from '$lib/paraglide/messages';
import { base } from '$app/paths';

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

let sentryHandle: Handle | undefined = undefined;
let sentryHandleError: HandleServerError | undefined = undefined;

if (env.PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: env.PUBLIC_SENTRY_DSN,
    tracesSampleRate: 1
  });

  sentryHandle = Sentry.sentryHandle();
  sentryHandleError = Sentry.handleErrorWithSentry(reportError);
}

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

const handleGoogleTag: Handle = ({ event, resolve }) => {
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%gtag.id%', env.PUBLIC_GOOGLE_TAG_ID ?? '')
  });
};

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

const handleUserShortcut: Handle = async ({ event, resolve }) => {
  const { pathname, search } = event.url;

  // Check if this is a shortcut link to a user profile
  if (pathname.startsWith('/@')) {
    redirect(308, `/users/${pathname.slice(1)}${search}`);
  }

  // Otherwise, proceed with normal request handling
  return resolve(event);
};

export const handle: Handle = sequence(
  handleOptions,
  ...(sentryHandle ? [sentryHandle] : []),
  handleParaglide,
  handleGoogleTag,
  handleAMap,
  handleUserShortcut,
  handleHeaders,
  handleAuth
);

export const handleError: HandleServerError = sentryHandleError ?? reportError;

export const init: ServerInit = async () => {
  if (!redis.isOpen) {
    await redis.connect();
  }
};
