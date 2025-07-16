import { sequence } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { PUBLIC_SENTRY_DSN } from '$env/static/public';

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
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET');
  return response;
};

export const handle: Handle = sequence(Sentry.sentryHandle(), handleParaglide, handleHeaders);

export const handleError: HandleServerError = Sentry.handleErrorWithSentry(({ status }) => {
  if (status === 404) {
    return {
      message: '',
      code: ''
    };
  }
  return {
    message: 'An unexpected error occurred. Please try again later.',
    code: 'INTERNAL_ERROR'
  };
});
