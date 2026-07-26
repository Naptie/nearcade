import { json } from '@sveltejs/kit';
import { loadGlobeMarkers } from '$lib/endpoints/globe.server';
import type { RequestHandler } from './$types';

const MAX_TITLE_IDS = 50;

export const GET: RequestHandler = async ({ url }) => {
  const regionId = url.searchParams.get('region') || undefined;
  const titleIds = Array.from(
    new Set(
      (url.searchParams.get('titles') ?? '')
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter(Number.isInteger)
    )
  );

  if (titleIds.length > MAX_TITLE_IDS) {
    return json({ message: `Too many game titles: maximum ${MAX_TITLE_IDS}` }, { status: 400 });
  }

  const shops = await loadGlobeMarkers({ regionId, titleIds });
  return json(
    { shops },
    {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
      }
    }
  );
};
