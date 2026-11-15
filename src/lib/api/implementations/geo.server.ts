import { implement } from '@orpc/server';
import { error } from '@sveltejs/kit';
import { geoContract, type RouteResultPayload } from '../contracts/geo';
import type { ApiContext } from '../context';
import { apiError } from '../errors';
import { attributionUrlTemplate } from '../mount';
import mongo from '$lib/db/index.server';
import redis from '$lib/db/redis.server';
import { lookupIpRegion } from '$lib/endpoints/ip-lookup.server';
import type { Region } from '$lib/regions/types';
import { isAllowedCorsOrigin } from '$lib/utils/cors.server';
import { convertToMapProfile, resolveTerritoryDatum } from '$lib/utils/geo.server';
import { getClientIp } from '$lib/utils/ip.server';
import {
  fetchUnifiedGeoStyle,
  requestUnifiedGeo,
  requestUnifiedGeoAttribution,
  requestUnifiedGeoGet,
  requestUnifiedGeoProfile,
  type UnifiedGeoCoordinate,
  type UnifiedGeoPlace
} from '$lib/utils/unified-geo.server';
import { getRegionById, parseRegionChainFromText } from '$lib/regions/utils.server';
import { getLocale } from '$lib/paraglide/runtime';

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

interface PlaceSearchResponse {
  success: true;
  results: UnifiedGeoPlace[];
}

interface GeocodeResponse {
  success: true;
  provider: string;
  routingPolicy?: string;
  results: Array<{
    formattedAddress: string;
    location: UnifiedGeoCoordinate;
    accuracy?: string;
    placeId?: string;
  }>;
}

interface MapLinksResponse {
  success: true;
  universal: string;
  android?: string;
  ios?: string;
  web?: string;
}

interface DirectionsResponse {
  success: true;
  routes: RouteResultPayload[];
}

const DIRECTIONS_CACHE_TTL_SECONDS = 30 * 60;
// Bound upstream fan-out: discover computes travel times for every rendered
// shop across four modes; without a limiter a cold viewport would hit the
// location service with dozens of simultaneous requests.
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_QUEUED_REQUESTS = 64;

let activeRequests = 0;
const waitQueue: (() => void)[] = [];

async function withRequestSlot<T>(run: () => Promise<T>): Promise<T> {
  while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    if (waitQueue.length >= MAX_QUEUED_REQUESTS) {
      error(429, 'Too many routing requests; try again shortly.');
    }
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }
  activeRequests++;
  try {
    return await run();
  } finally {
    activeRequests--;
    waitQueue.shift()?.();
  }
}

/**
 * The cache key of a route: ~11 m rounding keeps identical doors on the same
 * entry while bounding key cardinality.
 */
const directionsCacheKey = (
  origin: UnifiedGeoCoordinate,
  destination: UnifiedGeoCoordinate,
  mode: string,
  language: string | undefined
): string => {
  const round = (value: number) => value.toFixed(4);
  return [
    'ug:directions',
    mode,
    round(origin.longitude),
    round(origin.latitude),
    origin.coordinateSystem,
    round(destination.longitude),
    round(destination.latitude),
    destination.coordinateSystem,
    language ?? 'default'
  ].join(':');
};

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

  pickerSearch: impl.pickerSearch.handler(async ({ input, context }) => {
    const { request, url } = context.event;
    if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
      apiError('FORBIDDEN', 'Cross-origin location search is not allowed.');
    }

    const { query, longitude, latitude, language } = input;
    // The search center arrives in the map surface's space (GCJ02 on the
    // mainland and in the SARs, WGS84 in Taiwan and overseas). Resolve the
    // zone datum once and search in it: result pins then align with the
    // basemap and match the stored shop datum without further conversion.
    const coordinateSystem = await resolveTerritoryDatum(longitude, latitude);
    const response = await requestUnifiedGeo<PlaceSearchResponse>('/geo/search', {
      query,
      near: { longitude, latitude, coordinateSystem },
      outputCoordinateSystem: coordinateSystem,
      language,
      limit: 8,
      radiusMeters: 50_000
    });

    return { places: response.results, coordinateSystem };
  }),

  geocode: impl.geocode.handler(async ({ input, context }) => {
    const { request, url } = context.event;
    if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
      apiError('FORBIDDEN', 'Cross-origin address geocoding is not allowed.');
    }

    const { address, name, near, radius } = input;
    // The result language follows the request's resolved locale — the same
    // inference every other localizing API response uses (signed-in user's
    // stored locale, else the cookie, else the Accept-Language header), so a
    // caller that wants a specific language sends Accept-Language like it
    // would for any other endpoint.
    const language = getLocale();

    // The text to resolve: the place name when given, else the address.
    const query = name || address;

    // The bias point: the caller's wins. Without one, the deepest
    // administrative region the ADDRESS names provides it — even when a place
    // name is being resolved, the address is the bias's source. Region centres
    // are stored in the map surface's datum (the same assumption /geo/me's
    // origin makes), so the point is passed through unchanged and its datum is
    // re-derived from the profile lookup below instead of named here.
    let bias: UnifiedGeoCoordinate | null = near ? { ...near } : null;
    let countryCode: string | undefined;
    if (!bias) {
      const parsed = parseRegionChainFromText(address);
      if (parsed) {
        for (const id of [...parsed.chain].reverse()) {
          const chainRegion = await getRegionById(id);
          if (chainRegion?.location) {
            const [longitude, latitude] = chainRegion.location.coordinates;
            bias = { longitude, latitude, coordinateSystem: 'WGS84' };
            countryCode = id.split(/[-:]/)[0] || undefined;
            break;
          }
        }
      }
    }

    let coordinateSystem: UnifiedGeoCoordinate['coordinateSystem'] = 'WGS84';
    if (bias) {
      if (near) {
        // A caller-supplied bias carries a trusted declaration, so it is
        // normalized into the territory's datum (profile + convert, the same
        // routing the discover endpoint applies to its origin).
        const normalized = await convertToMapProfile(
          bias.longitude,
          bias.latitude,
          bias.coordinateSystem
        );
        if (normalized) bias = normalized;
      } else {
        // A derived centre only needs its datum named: territory
        // classification is insensitive to the datum offset at
        // administrative-centre scale, exactly like pickerSearch's centre.
        const datum = await resolveTerritoryDatum(bias.longitude, bias.latitude);
        bias = {
          longitude: bias.longitude,
          latitude: bias.latitude,
          coordinateSystem: datum
        };
      }
      coordinateSystem = bias.coordinateSystem;
    }

    const response = await requestUnifiedGeo<GeocodeResponse>('/geo/geocode', {
      address: query,
      ...(bias ? { near: bias } : {}),
      ...(countryCode ? { countryCode } : {}),
      outputCoordinateSystem: coordinateSystem,
      ...(radius !== undefined && bias ? { radiusMeters: radius } : {}),
      ...(language ? { language } : {})
    });

    return {
      provider: response.provider,
      routingPolicy: response.routingPolicy ?? null,
      coordinateSystem,
      results: response.results.map((result) => ({
        formattedAddress: result.formattedAddress,
        location: result.location,
        ...(result.accuracy ? { accuracy: result.accuracy } : {}),
        ...(result.placeId ? { placeId: result.placeId } : {})
      }))
    };
  }),

  mapStyle: impl.mapStyle.handler(async ({ input, context }) => {
    const { longitude, latitude, theme, locale, scope } = input;
    const profile = await requestUnifiedGeoProfile({
      coordinate: { longitude, latitude, coordinateSystem: 'WGS84' },
      ...(scope ? { scope } : {}),
      ...(theme ? { style: theme } : {}),
      ...(locale ? { locale } : {})
    });

    const styleUrl = profile['styleUrl'];
    if (typeof styleUrl !== 'string') {
      error(503, 'The location service has no map source configured for this point.');
    }

    const { body, cacheControl } = await fetchUnifiedGeoStyle(styleUrl);
    let style: Record<string, unknown>;
    try {
      style = JSON.parse(body) as Record<string, unknown>;
    } catch {
      error(502, 'The location service returned an invalid style document.');
    }

    // The attribution refresh happens in the browser, so the URL it is handed
    // has to be this app's own route: never a provider's, and never the
    // location service's internal one. Only a relative template is rewritten —
    // the Bing CN flavor's, whose upstream authorizes only Bing's own page
    // origin. The Google flavor points at Google's public viewport endpoint,
    // the same host and session the style's tile templates already carry, so
    // it passes through untouched and keeps answering Google's own copyright.
    // A profile without a template (AMap) has nothing to rewrite.
    const template = profile['attributionUrlTemplate'];
    if (typeof template === 'string') {
      let isAbsolute = false;
      try {
        new URL(template);
        isAbsolute = true;
      } catch {
        // Relative is exactly the case this rewrite exists for.
      }
      if (!isAbsolute) {
        profile['attributionUrlTemplate'] = attributionUrlTemplate();
      }
    }

    context.resHeaders?.set('Cache-Control', cacheControl ?? 'private, max-age=300');
    return { profile, style };
  }),

  attribution: impl.attribution.handler(async ({ input, context }) => {
    const { copyright } = await requestUnifiedGeoAttribution(input);
    context.resHeaders?.set('Cache-Control', 'private, max-age=300');
    return { copyright };
  }),

  links: impl.links.handler(async ({ input, context }) => {
    const { request, url } = context.event;
    if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
      apiError('FORBIDDEN', 'Cross-origin map link requests are not allowed.');
    }

    const { longitude, latitude, name, mode, travelMode, coordinateSystem } = input;
    const response = await requestUnifiedGeo<MapLinksResponse>('/maps/links', {
      coordinate: { longitude, latitude, coordinateSystem: coordinateSystem ?? 'WGS84' },
      ...(name ? { name } : {}),
      ...(mode ? { mode } : {}),
      ...(travelMode ? { travelMode } : {})
    });

    context.resHeaders?.set('Cache-Control', 'public, max-age=300');
    return {
      success: true as const,
      universal: response.universal,
      ...(response.android ? { android: response.android } : {}),
      ...(response.ios ? { ios: response.ios } : {}),
      ...(response.web ? { web: response.web } : {})
    };
  }),

  capabilities: impl.capabilities.handler(async ({ context }) => {
    const response = await requestUnifiedGeoGet<{ success: true } & Record<string, unknown>>(
      '/capabilities'
    );
    context.resHeaders?.set('Cache-Control', 'public, max-age=600');
    return response;
  }),

  directions: impl.directions.handler(async ({ input, context }) => {
    const { request, url } = context.event;
    if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
      apiError('FORBIDDEN', 'Cross-origin routing requests are not allowed.');
    }

    const { origin, destination, mode, language } = input;
    const key = directionsCacheKey(origin, destination, mode, language);

    try {
      const cached = await redis.get(key);
      if (cached) {
        const hit = JSON.parse(cached) as DirectionsResponse;
        // Entries cached before the leg model (flat steps) are treated as misses.
        if (hit.routes?.every((route) => Array.isArray(route.legs))) return hit;
      }
    } catch {
      // Cache failures degrade to direct requests.
    }

    const response = await withRequestSlot(() =>
      requestUnifiedGeo<DirectionsResponse>('/geo/directions', {
        origin,
        destination,
        mode,
        outputCoordinateSystem: origin.coordinateSystem,
        ...(language ? { language } : {})
      })
    );

    // The upstream envelope carries internal routing metadata; forward only what
    // the client renders.
    const payload: DirectionsResponse = { success: true, routes: response.routes };
    try {
      await redis.setEx(key, DIRECTIONS_CACHE_TTL_SECONDS, JSON.stringify(payload));
    } catch {
      // Cache write failures are non-fatal.
    }

    return payload;
  })
};
