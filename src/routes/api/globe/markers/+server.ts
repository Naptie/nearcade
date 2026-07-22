import { json } from '@sveltejs/kit';
import { loadGlobeMarkers } from '$lib/endpoints/globe.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const shops = await loadGlobeMarkers();
  return json(
    { shops },
    {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
      }
    }
  );
};
