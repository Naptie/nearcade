import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  resolveNearcadeRegion,
  type UnifiedGeoReverseResponse
} from '$lib/regions/unified-geo.server';
import { isAllowedCorsOrigin } from '$lib/utils/cors.server';
import { requestUnifiedGeo, type UnifiedGeoCoordinate } from '$lib/utils/unified-geo.server';
import type { RequestHandler } from './$types';

const confirmSchema = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  language: z.string().min(2).max(12),
  name: z.string().max(300).optional(),
  address: z.string().max(1000).optional(),
  // Datum of the incoming point when the client knows it (search results and
  // geolocation do). Map clicks omit it: the values are already in the map
  // surface's space, and the server resolves which datum that is per point.
  coordinateSystem: z.enum(['WGS84', 'GCJ02']).optional()
});

interface CoordinateConversionResponse {
  success: true;
  coordinate: UnifiedGeoCoordinate;
}

interface MapProfileResponse {
  success: true;
  coordinateSystem: 'WGS84' | 'GCJ02';
}

export const POST: RequestHandler = async ({ request, url }) => {
  if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
    error(403, 'Cross-origin location confirmation is not allowed.');
  }

  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, 'Invalid location selection.');

  const { longitude, latitude, language, name, address } = parsed.data;
  let inputDatum = parsed.data.coordinateSystem;
  if (!inputDatum) {
    // Resolve the datum the map surface implies for this point (zone-based).
    const profile = await requestUnifiedGeo<MapProfileResponse>('/maps/profile', {
      coordinate: { longitude, latitude, coordinateSystem: 'WGS84' }
    });
    inputDatum = profile.coordinateSystem;
  }
  const coordinate: UnifiedGeoCoordinate = { longitude, latitude, coordinateSystem: inputDatum };
  const reverse = await requestUnifiedGeo<UnifiedGeoReverseResponse>('/geo/reverse', {
    coordinate,
    outputCoordinateSystem: 'WGS84',
    language
  });
  let selectedCoordinate = coordinate;

  // Nearcade stores shop locations for China-provider regions in GCJ02 — the
  // datum unified-geo assigns to CN_MAINLAND and CN_HKMO — while Taiwan
  // (CN_TW) and everything else stay WGS84. Branch on the territory datum,
  // never on serviceArea ('china' now includes TW but remains WGS84 there).
  if (reverse.territory.datum === 'GCJ02' && inputDatum !== 'GCJ02') {
    const converted = await requestUnifiedGeo<CoordinateConversionResponse>('/geo/convert', {
      coordinate,
      targetCoordinateSystem: 'GCJ02'
    });
    selectedCoordinate = converted.coordinate;
  }

  const result = reverse.results[0];
  const region = await resolveNearcadeRegion(reverse, result?.formattedAddress || address);
  return json({
    location: selectedCoordinate,
    serviceArea: reverse.serviceArea,
    zone: reverse.zone,
    provider: reverse.provider,
    name: name || result?.formattedAddress || address || '',
    address: result?.formattedAddress || address || '',
    city: result?.components.city ?? reverse.territory.city,
    ...region
  });
};
