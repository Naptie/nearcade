import { error, json, type RequestHandler } from '@sveltejs/kit';
import { SSC_SECRET } from '$env/static/private';
import { m } from '$lib/paraglide/messages';
import { init } from '$lib/db/meili.server';

export const POST: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== SSC_SECRET) {
    error(401, m.unauthorized());
  }

  await init();

  return json({ success: true });
};
