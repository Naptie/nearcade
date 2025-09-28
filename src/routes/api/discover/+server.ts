import { loadShops } from '$lib/endpoints/discover.server';
import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const resp = await loadShops({ url });
    return json(resp);
  } catch (err) {
    console.error('Error getting shops:', err);
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    error(500, 'Failed to get nearby shops');
  }
};
