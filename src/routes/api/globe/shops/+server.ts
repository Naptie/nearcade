import { json, error } from '@sveltejs/kit';
import {
  loadGlobeShopsByIds,
  loadGlobeShopsByDistance,
  loadGlobeShopsByName
} from '$lib/endpoints/globe.server';
import type { RequestHandler } from './$types';

const MAX_IDS_PER_REQUEST = 200;
const MAX_TITLE_IDS = 50;

export const GET: RequestHandler = async ({ url }) => {
  const idsParam = url.searchParams.get('ids');
  const region = url.searchParams.get('region');
  const titleIds = Array.from(
    new Set(
      (url.searchParams.get('titles') ?? '')
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter(Number.isInteger)
    )
  );
  const latParam = url.searchParams.get('lat');
  const lngParam = url.searchParams.get('lng');
  const offset = Number(url.searchParams.get('offset') ?? '0');

  if (!Number.isInteger(offset) || offset < 0) {
    error(400, 'offset must be a non-negative integer');
  }

  if (titleIds.length > MAX_TITLE_IDS) {
    error(400, `Too many game titles: maximum ${MAX_TITLE_IDS}`);
  }

  if (latParam !== null || lngParam !== null) {
    const latitude = Number(latParam);
    const longitude = Number(lngParam);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      error(400, 'Both lat and lng must be finite numbers');
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      error(400, 'lat or lng is out of range');
    }
    return json(
      await loadGlobeShopsByDistance(longitude, latitude, offset, {
        regionId: region ?? undefined,
        titleIds
      }),
      {
        headers: CACHE_HEADERS
      }
    );
  }

  if (!idsParam) {
    return json(await loadGlobeShopsByName(offset, { regionId: region ?? undefined, titleIds }), {
      headers: CACHE_HEADERS
    });
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
  return json({ shops }, { headers: CACHE_HEADERS });
};

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=120, stale-while-revalidate=600'
};
