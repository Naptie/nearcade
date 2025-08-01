import { sequence } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { PUBLIC_SENTRY_DSN } from '$env/static/public';
import { handle as handleAuth } from '$lib/auth.server';

Sentry.init({
  dsn: PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1
});

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
  Sentry.sentryHandle(),
  handleParaglide,
  handleHeaders,
  handleAuth
);

export const handleError: HandleServerError = Sentry.handleErrorWithSentry(({ status, error }) => {
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
});
