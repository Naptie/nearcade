import { error, json } from '@sveltejs/kit';
import { m } from '$lib/paraglide/messages';
import {
  resolveNearcadeRegion,
  type UnifiedGeoReverseResponse
} from '$lib/regions/unified-geo.server';
import { requestUnifiedGeo, type UnifiedGeoCoordinate } from '$lib/utils/unified-geo.server';
import type { RequestHandler } from './$types';

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<
  string,
  { at: number; value: Awaited<ReturnType<typeof resolveNearcadeRegion>> }
>();

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.session?.user) error(401, m.unauthorized());

  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const coordinateSystem = url.searchParams.get('coordinateSystem') ?? 'WGS84';
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    error(400, 'Invalid coordinates');
  }
  if (coordinateSystem !== 'WGS84' && coordinateSystem !== 'GCJ02') {
    error(400, 'Invalid coordinate system');
  }

  const coordinate: UnifiedGeoCoordinate = {
    longitude: lng,
    latitude: lat,
    coordinateSystem
  };
  const cacheKey = `${coordinateSystem}:${lng.toFixed(5)},${lat.toFixed(5)}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return json(hit.value);

  const reverse = await requestUnifiedGeo<UnifiedGeoReverseResponse>('/geo/reverse', {
    coordinate,
    outputCoordinateSystem: 'WGS84'
  });
  const result = await resolveNearcadeRegion(reverse, url.searchParams.get('address') ?? undefined);
  if (result.resolved && result.region?.length) {
    cache.set(cacheKey, { at: Date.now(), value: result });
    if (cache.size > 500) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
  }
  return json(result);
};
