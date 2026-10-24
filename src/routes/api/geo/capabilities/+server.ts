import { json } from '@sveltejs/kit';
import { requestUnifiedGeoGet } from '$lib/utils/unified-geo.server';
import type { RequestHandler } from './$types';

/**
 * Proxy unified-geo's capability matrix (GET /capabilities): which features are
 * available per zone, so the UI can hide unavailable affordances (e.g. transit
 * routing) without knowing anything about the underlying map sources.
 */
export const GET: RequestHandler = async () => {
  const response = await requestUnifiedGeoGet<{ success: true } & Record<string, unknown>>(
    '/capabilities'
  );
  return json(response, {
    headers: { 'cache-control': 'public, max-age=600' }
  });
};
