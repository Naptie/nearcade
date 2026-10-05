import { json } from '@sveltejs/kit';
import { loadGlobeMarkers } from '$lib/endpoints/globe.server';
import { readGlobeFilterState } from '$lib/utils/shops/filter';
import type { RequestHandler } from './$types';

const MAX_TITLE_IDS = 50;

export const GET: RequestHandler = async ({ url }) => {
  const titleIds = Array.from(
    new Set(
      (url.searchParams.get('titles') ?? '')
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter(Number.isInteger)
    )
  );
  // `region` is the globe's pre-filter parameter; it now arrives as a `regions`
  // slot in `f`, so old clients and shared links keep hitting the same query.
  const filter = readGlobeFilterState(url.searchParams);

  if (titleIds.length > MAX_TITLE_IDS) {
    return json({ message: `Too many game titles: maximum ${MAX_TITLE_IDS}` }, { status: 400 });
  }

  const shops = await loadGlobeMarkers({ titleIds, filter });
  return json(
    { shops },
    {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
      }
    }
  );
};
