import { loadShops } from '$lib/endpoints/discover.server';
import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const resp = await loadShops({ url });
    return json(resp);
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error getting shops:', err);
    error(500, m.failed_to_get_nearby_shops());
  }
};
