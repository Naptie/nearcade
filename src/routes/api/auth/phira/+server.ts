import type { RequestHandler } from '@sveltejs/kit';

const REMOTE_URL = 'https://phira.moe/oauth';

export const GET: RequestHandler = async ({ url }) => {
  const params = url.searchParams;
  const client_id = params.get('client_id');
  const redirect_uri = params.get('redirect_uri');

  if (!client_id || !redirect_uri) {
    return new Response('Missing required parameters', { status: 400 });
  }

  // Build new query params
  const newParams = new URLSearchParams();
  newParams.set('clientID', client_id);
  newParams.set('redirectURI', redirect_uri);

  // Add the rest of the params
  for (const [key, value] of params.entries()) {
    if (key !== 'client_id' && key !== 'redirect_uri') {
      newParams.set(key, value);
    }
  }

  const redirectUrl = `${REMOTE_URL}?${newParams.toString()}`;

  return Response.redirect(redirectUrl, 302);
};
