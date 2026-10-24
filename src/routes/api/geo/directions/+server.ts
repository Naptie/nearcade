import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import redis from '$lib/db/redis.server';
import { isAllowedCorsOrigin } from '$lib/utils/cors.server';
import { requestUnifiedGeo, type UnifiedGeoCoordinate } from '$lib/utils/unified-geo.server';
import type { RequestHandler } from './$types';

const directionsSchema = z.object({
  origin: z.object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
    coordinateSystem: z.enum(['WGS84', 'GCJ02'])
  }),
  destination: z.object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
    coordinateSystem: z.enum(['WGS84', 'GCJ02'])
  }),
  mode: z.enum(['driving', 'walking', 'cycling', 'transit']),
  language: z.string().min(2).max(12).optional()
});

interface DirectionsRoute {
  mode: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: [number, number][];
  steps: {
    instruction?: string;
    distanceMeters?: number;
    durationSeconds?: number;
    geometry: [number, number][];
  }[];
  coordinateSystem: 'WGS84' | 'GCJ02';
}

interface DirectionsResponse {
  success: true;
  routes: DirectionsRoute[];
}

const CACHE_TTL_SECONDS = 30 * 60;
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

function cacheKey(
  origin: UnifiedGeoCoordinate,
  destination: UnifiedGeoCoordinate,
  mode: string,
  language: string | undefined
): string {
  // ~11 m rounding keeps identical doors on the same cache entry while
  // bounding key cardinality.
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
}

/**
 * Proxy unified-geo routing (POST /geo/directions) with a Redis cache.
 * Responses are provider-free: only the routes and their datum are forwarded.
 */
export const POST: RequestHandler = async ({ request, url }) => {
  if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
    error(403, 'Cross-origin routing requests are not allowed.');
  }

  const parsed = directionsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, 'Invalid routing request.');

  const { origin, destination, mode, language } = parsed.data;
  const key = cacheKey(origin, destination, mode, language);

  try {
    const cached = await redis.get(key);
    if (cached) {
      return json(JSON.parse(cached) as DirectionsResponse);
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
    await redis.setEx(key, CACHE_TTL_SECONDS, JSON.stringify(payload));
  } catch {
    // Cache write failures are non-fatal.
  }

  return json(payload);
};
