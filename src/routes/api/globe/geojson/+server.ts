import { error, json } from '@sveltejs/kit';
import { getGlobeGeoJson } from '$lib/utils/globe/geojson.server';
import type { GlobeDataset } from '$lib/utils/globe/geojson';
import type { RequestHandler } from './$types';

const DATASETS = new Set<GlobeDataset>([
  'world',
  'china-provinces',
  'china-cities',
  'china-counties'
]);

export const GET: RequestHandler = ({ url }) => {
  const dataset = url.searchParams.get('dataset');
  const parentAdcode = url.searchParams.get('parentAdcode')?.trim() || undefined;

  if (!dataset || !DATASETS.has(dataset as GlobeDataset)) {
    error(400, 'Invalid globe dataset');
  }

  if (dataset === 'china-counties' && !parentAdcode) {
    error(400, 'A parentAdcode is required for county subsets');
  }

  const response = getGlobeGeoJson(dataset as GlobeDataset, parentAdcode);

  return json(response, {
    headers: {
      'Cache-Control':
        dataset === 'china-counties'
          ? 'public, max-age=3600, stale-while-revalidate=86400'
          : 'public, max-age=86400, stale-while-revalidate=604800'
    }
  });
};
