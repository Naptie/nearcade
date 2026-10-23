import { implement } from '@orpc/server';
import { geoContract, type MapLibreStyleDocument } from '../contracts/geo';
import type { ApiContext } from '../context';
import { apiError } from '../errors';
import mongo from '$lib/db/index.server';
import { lookupIpRegion } from '$lib/endpoints/ip-lookup.server';
import type { Region } from '$lib/regions/types';
import {
  resolveNearcadeRegion,
  type UnifiedGeoReverseResponse
} from '$lib/regions/unified-geo.server';
import { isAllowedCorsOrigin } from '$lib/utils/cors.server';
import { convertToMapProfile } from '$lib/utils/geo.server';
import { getClientIp } from '$lib/utils/ip.server';
import {
  requestUnifiedGeo,
  requestUnifiedGeoStyle,
  type UnifiedGeoCoordinate,
  type UnifiedGeoPlace
} from '$lib/utils/unified-geo.server';

const escapeRegex = (value: string) => value.replace(/[.*+?${}()|[\]\\]/g, '\\$&');

interface OriginRegion {
  id: string;
  level: Region['level'];
  coordinates: [number, number];
}

/**
 * Find a named region inside the resolved country carrying a usable center.
 * CN/HK/MO/TW IDs are `CN-44`, while overseas pipeline IDs are `AU:4411` —
 * match both separators so non-Chinese IPs resolve too.
 */
const findCoordinateRegion = async (
  countryPrefix: string | undefined,
  name: string | null,
  level: Region['level']
): Promise<OriginRegion | null> => {
  const trimmed = name?.trim();
  if (!trimmed || trimmed === '0') return null;
  const match = escapeRegex(trimmed);
  const region = await mongo
    .db()
    .collection<Region>('regions')
    .find({
      level,
      location: { $ne: null },
      ...(countryPrefix ? { id: { $regex: `^${escapeRegex(countryPrefix)}[-:]` } } : {}),
      $or: [{ 'name.en': { $regex: match, $options: 'i' } }, { 'name.zh': { $regex: match } }]
    })
    .limit(1)
    .next();
  if (!region?.location) return null;
  return {
    id: region.id,
    level: region.level,
    coordinates: region.location.coordinates
  };
};

interface CoordinateConversionResponse {
  success: true;
  coordinate: UnifiedGeoCoordinate;
}

interface MapProfileResponse {
  success: true;
  coordinateSystem: UnifiedGeoCoordinate['coordinateSystem'];
}

interface PlaceSearchResponse {
  success: true;
  results: UnifiedGeoPlace[];
}

/**
 * SvelteKit's `error()` throws an `HttpError`, which the oRPC layer would
 * flatten into a 500. The router-level `preserveHttpErrorStatus` middleware
 * re-throws those with their original status, so the unified-geo failures
 * keep answering 502/503.
 */
const impl = implement(geoContract).$context<ApiContext>();

export const geoImplementation = {
  me: impl.me.handler(async ({ context }) => {
    const { request, url } = context.event;
    if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
      apiError('FORBIDDEN', 'Cross-origin location lookup is not allowed.');
    }

    const ip = getClientIp(context.event);
    if (!ip) return { origin: null };

    const resolved = await lookupIpRegion(ip, request);
    if (!resolved) return { origin: null };

    const countryPrefix = resolved.countryCode ?? undefined;
    const origin =
      (await findCoordinateRegion(countryPrefix, resolved.city, 'city')) ??
      (await findCoordinateRegion(countryPrefix, resolved.regionName, 'province'));
    if (!origin) return { origin: null };

    const [lng, lat] = origin.coordinates;
    context.resHeaders?.set('Cache-Control', 'private, max-age=300');
    return { origin: { lat, lng, level: origin.level, source: 'ip-region' as const } };
  }),

  translate: impl.translate.handler(async ({ input, context }) => {
    const { request, url } = context.event;
    if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
      apiError('FORBIDDEN', 'Cross-origin coordinate translation is not allowed');
    }

    const lat = input.lat ?? 0;
    const lng = input.lng ?? 0;
    const from = input.from ?? 'WGS84';
    const coordinateSystem: UnifiedGeoCoordinate['coordinateSystem'] =
      from === 'gps' || from === 'WGS84' ? 'WGS84' : 'GCJ02';

    const normalized = await convertToMapProfile(lng, lat, coordinateSystem);
    if (!normalized) return { converted: false, lng, lat, coordinateSystem };
    const converted =
      normalized.longitude !== lng ||
      normalized.latitude !== lat ||
      normalized.coordinateSystem !== coordinateSystem;
    return {
      converted,
      lng: normalized.longitude,
      lat: normalized.latitude,
      coordinateSystem: normalized.coordinateSystem
    };
  }),

  style: impl.style.handler(async ({ input }) => {
    const { body, cacheControl } = await requestUnifiedGeoStyle(input);

    let style: MapLibreStyleDocument | string;
    try {
      style = JSON.parse(body) as MapLibreStyleDocument;
    } catch {
      // A provider that answers with something else is forwarded untouched.
      style = body;
    }

    return {
      status: 200 as const,
      headers: {
        'content-type': 'application/json' as const,
        ...(cacheControl ? { 'cache-control': cacheControl } : {})
      },
      body: style
    };
  }),

  pickerSearch: impl.pickerSearch.handler(async ({ input, context }) => {
    const { request, url } = context.event;
    if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
      apiError('FORBIDDEN', 'Cross-origin location search is not allowed.');
    }

    const { query, longitude, latitude, language } = input;
    // The search center arrives in the map surface's space (Bing CN is GCJ02 on
    // the mainland, WGS84 in Taiwan and overseas). Resolve the zone datum once
    // and search in it: result pins then align with the basemap and match the
    // stored shop datum without further conversion.
    const profile = await requestUnifiedGeo<MapProfileResponse>('/maps/profile', {
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

    return { places: response.results, coordinateSystem: profile.coordinateSystem };
  }),

  pickerConfirm: impl.pickerConfirm.handler(async ({ input, context }) => {
    const { request, url } = context.event;
    if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
      apiError('FORBIDDEN', 'Cross-origin location confirmation is not allowed.');
    }

    const { longitude, latitude, language, name, address } = input;
    let inputDatum = input.coordinateSystem;
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
    return {
      location: selectedCoordinate,
      serviceArea: reverse.serviceArea,
      zone: reverse.zone,
      provider: reverse.provider,
      name: name || result?.formattedAddress || address || '',
      address: result?.formattedAddress || address || '',
      city: result?.components.city ?? reverse.territory.city,
      ...region
    };
  })
};
