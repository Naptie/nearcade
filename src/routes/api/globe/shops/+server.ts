import { json, error } from '@sveltejs/kit';
import { loadGlobeShopsByIds } from '$lib/endpoints/globe.server';
import type { RequestHandler } from './$types';

const MAX_IDS_PER_REQUEST = 50;

export const GET: RequestHandler = async ({ url }) => {
  const idsParam = url.searchParams.get('ids');
  if (!idsParam) {
    error(400, 'Missing required query parameter: ids');
  }

  const ids = idsParam
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));

  if (ids.length === 0) {
    error(400, 'No valid shop IDs provided');
  }

  if (ids.length > MAX_IDS_PER_REQUEST) {
    error(400, `Too many IDs: maximum ${MAX_IDS_PER_REQUEST} per request`);
  }

  const shops = await loadGlobeShopsByIds(ids);
  return json(
    { shops },
    {
      headers: {
        'Cache-Control': 'public, max-age=120, stale-while-revalidate=600'
      }
    }
  );
};
