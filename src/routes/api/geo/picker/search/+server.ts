import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { isAllowedCorsOrigin } from '$lib/utils/cors.server';
import { requestUnifiedGeo, type UnifiedGeoPlace } from '$lib/utils/unified-geo.server';
import type { RequestHandler } from './$types';

const searchSchema = z.object({
  query: z.string().trim().min(1).max(300),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  language: z.string().min(2).max(12)
});

interface PlaceSearchResponse {
  success: true;
  results: UnifiedGeoPlace[];
}

interface MapProfileResponse {
  success: true;
  coordinateSystem: 'WGS84' | 'GCJ02';
}

export const POST: RequestHandler = async ({ request, url }) => {
  if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
    error(403, 'Cross-origin location search is not allowed.');
  }

  const parsed = searchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, 'Invalid location search request.');

  const { query, longitude, latitude, language } = parsed.data;
  // The search center arrives in the map surface's space (Bing CN is GCJ02 on
  // the mainland, WGS84 in Taiwan and overseas). Resolve the zone datum once
  // and search in it: result pins then align with the basemap and match the
  // stored shop datum without further conversion.
  const profile = await requestUnifiedGeo<MapProfileResponse>('/maps/route', {
    coordinate: { longitude, latitude, coordinateSystem: 'WGS84' }
  });
  const response = await requestUnifiedGeo<PlaceSearchResponse>('/geo/search', {
    query,
    near: { longitude, latitude, coordinateSystem: profile.coordinateSystem },
    outputCoordinateSystem: profile.coordinateSystem,
    language,
    limit: 8,
    radiusMeters: 50_000
  });

  return json({ places: response.results, coordinateSystem: profile.coordinateSystem });
};
