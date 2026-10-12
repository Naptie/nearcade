import { error, json } from '@sveltejs/kit';
import { isAllowedCorsOrigin } from '$lib/utils/cors.server';
import { convertToMapProfile } from '$lib/utils/geo.server';
import type { UnifiedGeoCoordinate } from '$lib/utils/unified-geo.server';
import type { RequestHandler } from './$types';

/**
 * Normalize a point to the coordinate system chosen for its territory.
 * `gps` is retained as an alias for WGS84; public coordinate systems remain
 * WGS84 and GCJ02.
 */
export const GET: RequestHandler = async ({ url, request }) => {
  if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
    error(403, 'Cross-origin coordinate translation is not allowed');
  }

  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
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

  const from = url.searchParams.get('from') ?? 'WGS84';
  let coordinateSystem: UnifiedGeoCoordinate['coordinateSystem'];
  if (from === 'gps' || from === 'WGS84') coordinateSystem = 'WGS84';
  else if (from === 'GCJ02') coordinateSystem = 'GCJ02';
  else error(400, 'Invalid coordinate system');

  const normalized = await convertToMapProfile(lng, lat, coordinateSystem);
  if (!normalized) return json({ converted: false, lng, lat, coordinateSystem });
  const converted =
    normalized.longitude !== lng ||
    normalized.latitude !== lat ||
    normalized.coordinateSystem !== coordinateSystem;
  return json({
    converted,
    lng: normalized.longitude,
    lat: normalized.latitude,
    coordinateSystem: normalized.coordinateSystem
  });
};
