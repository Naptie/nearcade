import { sequence } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { handle as handleAuth } from '$lib/auth/index.server';
import { env } from '$env/dynamic/public';
import redis from '$lib/db/redis.server';

const reportError: HandleServerError = ({ status, error }) => {
  if (status === 404) {
    return {
      message: '',
      code: ''
    };
  }
  console.error(error);
  return {
    message: 'An unexpected error occurred. Please try again later.',
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

const handleParaglide: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;

    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
    });
  });

const handleHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  try {
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET');
  } catch {
    // Intentionally ignore errors when setting headers
  }
  return response;
};

export const handle: Handle = sequence(
  ...(sentryHandle ? [sentryHandle] : []),
  handleParaglide,
  handleHeaders,
  handleAuth
);

export const handleError: HandleServerError = sentryHandleError ?? reportError;

export const init: ServerInit = async () => {
  if (!redis.isOpen) {
    await redis.connect();
  }
};
