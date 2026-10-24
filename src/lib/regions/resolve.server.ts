import {
  resolveNearcadeRegion,
  type NearcadeRegionResolution,
  type UnifiedGeoReverseResponse
} from '$lib/regions/unified-geo.server';
import { requestUnifiedGeo, type UnifiedGeoCoordinate } from '$lib/utils/unified-geo.server';

/**
 * Resolving a point: the one place that talks to the geo service about it.
 *
 * A reverse geocode answers three questions at once — where the point is, what
 * it is called, and which nearcade region it belongs to — and every one of
 * those questions costs money upstream. So the operation lives here, once:
 *
 * - the datum rule is decided once, rather than once per endpoint;
 * - the reverse-geocode call has one call site, so a caller cannot reach the
 *   provider by another route that bills differently;
 * - the cache is a property of the upstream call, not of an HTTP endpoint, so
 *   every caller of the operation shares it.
 *
 * The endpoints that expose it are projections of this one result — they
 * choose which parts to publish, never how the point is resolved.
 */

/** The datum a point is expressed in. */
export type PointDatum = UnifiedGeoCoordinate['coordinateSystem'];

/** The service area a point falls in. */
export type ServiceArea = 'china' | 'international';

/** The zone a point falls in. */
export type ServiceZone = 'CN_MAINLAND' | 'CN_HKMO' | 'CN_TW' | 'INTERNATIONAL' | 'UNKNOWN';

/** What a resolved point is called. */
export interface ResolvedPlace {
  /** The address the provider formatted for the point. */
  address: string;
  /** The city the point is in, when the provider named one. */
  city?: string;
}

/** A resolved point, in the datum its territory stores coordinates in. */
export interface ResolvedLocation {
  longitude: number;
  latitude: number;
  coordinateSystem: PointDatum;
}

/** Everything a point resolves to. */
export interface ResolvedPoint {
  /**
   * The point, in the datum its territory stores coordinates in.
   *
   * nearcade keeps a shop's coordinates in the datum its territory uses
   * (GCJ02 on the mainland and in the SARs, WGS84 in Taiwan and abroad), so
   * this is the datum a caller should store the point in.
   */
  location: ResolvedLocation;
  serviceArea: ServiceArea;
  zone?: ServiceZone;
  place: ResolvedPlace;
  region: NearcadeRegionResolution;
}

export interface ResolvePointInput {
  longitude: number;
  latitude: number;
  /**
   * The datum the incoming point is expressed in.
   *
   * Omitted means "the map surface's datum for this place" — the datum
   * nearcade stores and displays coordinates in there. A point that came from
   * somewhere else (a GPS fix, an imported dataset) declares its own datum
   * instead, because the two datums are close enough that no service can tell
   * them apart by looking at the coordinates alone.
   */
  coordinateSystem?: PointDatum;
  /** The address the caller already knows, used when the provider names none. */
  address?: string;
  /** The language the provider should answer in. */
  language?: string;
}

interface MapProfileResponse {
  success: true;
  coordinateSystem: PointDatum;
}

interface CoordinateConversionResponse {
  success: true;
  coordinate: UnifiedGeoCoordinate;
}

/**
 * How long a resolved point stays valid.
 *
 * A point does not move, and the region it belongs to does not change under
 * it; only the address the provider formats for it might. Ten minutes is
 * long enough to absorb a repeated lookup and short enough that an address
 * the provider sharpens is picked up in the same sitting.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** How many resolved points are kept. */
const CACHE_MAX_ENTRIES = 500;

const cache = new Map<string, { at: number; value: ResolvedPoint }>();

/**
 * The cache key.
 *
 * The datum is part of the key because the same longitude and latitude in two
 * datums are two different places, so they are two different questions. The
 * language is part of it because the provider formats the address in the
 * language it was asked in. The address hint is part of it because it is the
 * fallback for an answer the provider gave no address for.
 */
const cacheKey = (input: ResolvePointInput, datum: PointDatum): string =>
  [
    `${input.longitude.toFixed(5)},${input.latitude.toFixed(5)}`,
    datum,
    input.language ?? '',
    input.address ?? ''
  ].join(':');

const remember = (key: string, value: ResolvedPoint): void => {
  cache.set(key, { at: Date.now(), value });

  if (cache.size <= CACHE_MAX_ENTRIES) return;

  // The oldest entries go first.
  const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [stale] of oldest.slice(0, cache.size - CACHE_MAX_ENTRIES)) {
    cache.delete(stale);
  }
};

/**
 * The map surface's datum for a point.
 *
 * The provider knows which datum a territory uses; asking it is one cheap
 * routing call, and it is the only way to tell what a point that did not
 * declare its datum should be read as.
 */
const resolveSurfaceDatum = async (longitude: number, latitude: number): Promise<PointDatum> => {
  const profile = await requestUnifiedGeo<MapProfileResponse>('/maps/profile', {
    coordinate: { longitude, latitude, coordinateSystem: 'WGS84' }
  });

  return profile.coordinateSystem;
};

/**
 * Resolve a point into its place and its region.
 *
 * The one implementation of the operation. It answers with the point in the
 * datum its territory stores coordinates in, the place the provider calls it,
 * and the nearcade region chain it belongs to.
 */
export const resolvePoint = async (input: ResolvePointInput): Promise<ResolvedPoint> => {
  const datum =
    input.coordinateSystem ?? (await resolveSurfaceDatum(input.longitude, input.latitude));

  const key = cacheKey(input, datum);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const coordinate: UnifiedGeoCoordinate = {
    longitude: input.longitude,
    latitude: input.latitude,
    coordinateSystem: datum
  };

  const reverse = await requestUnifiedGeo<UnifiedGeoReverseResponse>('/geo/reverse', {
    coordinate,
    outputCoordinateSystem: 'WGS84',
    ...(input.language ? { language: input.language } : {})
  });

  const result = reverse.results[0];
  const region = await resolveNearcadeRegion(reverse, input.address);

  // The point is stored in its territory's datum, so a point that arrived in
  // another datum is converted once, here — and the answer always carries
  // the datum it is expressed in, so a caller never has to guess.
  let location: ResolvedLocation = {
    longitude: coordinate.longitude,
    latitude: coordinate.latitude,
    coordinateSystem: datum
  };

  if (reverse.territory.datum === 'GCJ02' && datum !== 'GCJ02') {
    const converted = await requestUnifiedGeo<CoordinateConversionResponse>('/geo/convert', {
      coordinate,
      targetCoordinateSystem: 'GCJ02'
    });

    location = {
      longitude: converted.coordinate.longitude,
      latitude: converted.coordinate.latitude,
      coordinateSystem: 'GCJ02'
    };
  }

  const city = result?.components.city ?? reverse.territory.city;

  const value: ResolvedPoint = {
    location,
    serviceArea: reverse.serviceArea,
    ...(reverse.zone ? { zone: reverse.zone } : {}),
    place: {
      address: result?.formattedAddress || input.address || '',
      ...(city ? { city } : {})
    },
    region
  };

  remember(key, value);

  return value;
};
