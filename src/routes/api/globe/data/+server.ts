import { json } from '@sveltejs/kit';
import { loadGlobeDataResponse } from '$lib/endpoints/globe.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  return json(await loadGlobeDataResponse(), {
    headers: {
      'Cache-Control': 'no-store'
    }
  });
};
