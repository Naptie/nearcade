import { error, json } from '@sveltejs/kit';
import { isAllowedCorsOrigin } from '$lib/utils/cors.server';
import { translateToGcj02, type CoordSource } from '$lib/utils/geo.server';
import type { RequestHandler } from './$types';

/**
 * Translate a coordinate into GCJ-02 ("Mars coordinates") for client code.
 *
 * GET /api/geo/translate?lat=..&lng=..&from=gps
 *
 * The provider chain (Tencent coord translate, SK-signed server-side → AMap
 * fallback) never runs locally, and results are memoized server-side so
 * repeated picks/idle events don't burn the Tencent daily quota. This endpoint
 * is quota-bearing, so cross-origin reads are restricted: only same-origin and
 * `CORS_ALLOWED_ORIGINS` clients get responses (everyone else gets 403 before
 * any provider is called).
 */
const SOURCES: readonly CoordSource[] = ['gps', 'baidu', 'mapbar'];

export const GET: RequestHandler = async ({ url, request }) => {
  const origin = request.headers.get('origin');
  if (!isAllowedCorsOrigin(origin, url.origin)) {
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
  const fromParam = url.searchParams.get('from') ?? 'gps';
  if (!(SOURCES as readonly string[]).includes(fromParam)) {
    error(400, 'Invalid source coordinate system');
  }
  const from = fromParam as CoordSource;

  const converted = await translateToGcj02(lng, lat, from, url.origin);
  if (!converted) {
    // Both providers unavailable — hand back the original coordinates so
    // callers degrade gracefully instead of failing.
    return json({ converted: false, lng, lat });
  }
  return json({ converted: true, lng: converted[0], lat: converted[1] });
};
