import { error, json } from '@sveltejs/kit';
import {
  getAllSupportedDatasets,
  datasetRequiresParentAdcode,
  getGlobeGeoJson
} from '$lib/utils/globe/geojson.server';
import type { GlobeDataset } from '$lib/utils/globe/geojson';
import type { RequestHandler } from './$types';

// Valid datasets: 'world' plus everything declared in SUPPORTED_COUNTRIES.
const VALID_DATASETS = new Set<string>(['world', ...getAllSupportedDatasets()]);

export const GET: RequestHandler = ({ url }) => {
  const dataset = url.searchParams.get('name') ?? '';
  const parentAdcode = url.searchParams.get('parentAdcode')?.trim() || undefined;

  if (!dataset || !VALID_DATASETS.has(dataset)) {
    error(400, 'Invalid globe dataset');
  }

  if (datasetRequiresParentAdcode(dataset) && !parentAdcode) {
    error(400, 'A parentAdcode is required for this dataset');
  }

  const response = getGlobeGeoJson(dataset as GlobeDataset, parentAdcode);

  // Leaf-level datasets (those requiring a parentAdcode) are smaller subsets;
  // give them shorter max-age so the browser refreshes them occasionally.
  const isLeaf = datasetRequiresParentAdcode(dataset);

  return json(response, {
    headers: {
      'Cache-Control': isLeaf
        ? 'public, max-age=3600, stale-while-revalidate=86400'
        : 'public, max-age=86400, stale-while-revalidate=604800'
    }
  });
};
