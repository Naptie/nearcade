import type { Handle, HandleServerError } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';

const handleParaglide: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;

    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
    });
  });

export const handle: Handle = handleParaglide;

export const handleError: HandleServerError = ({ error, event, status }) => {
  if (status === 404) {
    return {
      message: '',
      code: ''
    };
  }

  console.error('Server error:', error);
  console.error('Request URL:', event.url.toString());
  console.error('Request method:', event.request.method);

  return {
    message: 'An unexpected error occurred. Please try again later.',
    code: 'INTERNAL_ERROR'
  };
};
