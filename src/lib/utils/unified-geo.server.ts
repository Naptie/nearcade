import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';

export interface UnifiedGeoCoordinate {
  longitude: number;
  latitude: number;
  coordinateSystem: 'WGS84' | 'GCJ02';
}

export interface UnifiedGeoPlace {
  id?: string;
  name: string;
  address: string;
  location: UnifiedGeoCoordinate;
  types: string[];
  distanceMeters?: number;
}

interface UnifiedGeoEnvelope {
  success: true;
}

const baseUrl = (env.UNIFIED_GEO_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');

/**
 * Minimal structural surface of the optional `unified-geo-client` Eden treaty
 * package. Only the POST routes nearcade calls are modeled; everything else
 * keeps using the hand-rolled fetch fallback below.
 */
interface UnifiedGeoClientSurface {
  geo: {
    convert: { post: (body: unknown) => Promise<unknown> };
    reverse: { post: (body: unknown) => Promise<unknown> };
    search: { post: (body: unknown) => Promise<unknown> };
    resolve: { post: (body: unknown) => Promise<unknown> };
    geocode: { post: (body: unknown) => Promise<unknown> };
    directions: { post: (body: unknown) => Promise<unknown> };
  };
  maps: {
    profile: { post: (body: unknown) => Promise<unknown> };
    links: { post: (body: unknown) => Promise<unknown> };
  };
}

type UnifiedGeoClientCall = (client: UnifiedGeoClientSurface, body: unknown) => Promise<unknown>;

const unifiedGeoClientRoutes: Record<string, UnifiedGeoClientCall> = {
  '/geo/convert': (client, body) => client.geo.convert.post(body),
  '/geo/reverse': (client, body) => client.geo.reverse.post(body),
  '/geo/search': (client, body) => client.geo.search.post(body),
  '/geo/resolve': (client, body) => client.geo.resolve.post(body),
  '/geo/geocode': (client, body) => client.geo.geocode.post(body),
  '/geo/directions': (client, body) => client.geo.directions.post(body),
  '/maps/profile': (client, body) => client.maps.profile.post(body),
  '/maps/links': (client, body) => client.maps.links.post(body)
};

// Cached typed client; `null` marks "package unavailable in this process" so a
// failed dynamic import is not retried on every request.
let typedClient: UnifiedGeoClientSurface | null | undefined;

async function getTypedUnifiedGeoClient(
  secret: string
): Promise<UnifiedGeoClientSurface | undefined> {
  if (typedClient !== undefined) return typedClient ?? undefined;
  try {
    // The specifier is kept in a variable on purpose: TypeScript must not
    // resolve the optional package statically (this file has to typecheck
    // without it installed) and Vite needs @vite-ignore to leave the import
    // to the runtime.
    const specifier = 'unified-geo-client';
    const mod = (await import(/* @vite-ignore */ specifier).catch(() => undefined)) as
      | {
          createClient?: (
            baseUrl: string,
            config?: { headers?: Record<string, string> }
          ) => unknown;
        }
      | undefined;
    const createClient = mod?.createClient;
    if (typeof createClient !== 'function') {
      typedClient = null;
      return undefined;
    }
    typedClient = createClient(baseUrl, {
      headers: { authorization: `Bearer ${secret}` }
    }) as UnifiedGeoClientSurface;
  } catch {
    typedClient = null;
  }
  return typedClient ?? undefined;
}

/** Eden treaty resolves `{ data, error }` (treaty 2) or `[data, error]` (treaty 1). */
function unwrapTreatyResult(result: unknown): unknown {
  if (Array.isArray(result)) return result[0];
  if (result && typeof result === 'object' && 'data' in result) {
    const envelope = result as { data?: unknown; error?: unknown };
    if (envelope.error) return undefined;
    return envelope.data;
  }
  return result;
}

/** Try the typed client for a POST endpoint; `undefined` means "fall back". */
async function requestViaTypedClient<T extends UnifiedGeoEnvelope>(
  endpoint: string,
  body: unknown,
  secret: string
): Promise<T | undefined> {
  const client = await getTypedUnifiedGeoClient(secret);
  const call = unifiedGeoClientRoutes[endpoint];
  if (!client || !call) return undefined;
  try {
    const payload = unwrapTreatyResult(await call(client, body));
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('success' in payload) ||
      payload.success !== true
    ) {
      return undefined;
    }
    return payload as T;
  } catch (cause) {
    console.warn('Unified geo typed client call failed; falling back to fetch:', endpoint, cause);
    return undefined;
  }
}

/** Make an authenticated server-to-server request to unified-geo. */
export async function requestUnifiedGeo<T extends UnifiedGeoEnvelope>(
  endpoint: string,
  body: unknown
): Promise<T> {
  const secret = env.UNIFIED_GEO_API_SECRET;
  if (!secret) error(503, 'The location service is not configured.');

  // Prefer the typed client when `unified-geo-client` is installed; any failure
  // (missing package, unexpected response shape, call error) falls back to the
  // hand-rolled fetch path below.
  const viaClient = await requestViaTypedClient<T>(endpoint, body, secret);
  if (viaClient) return viaClient;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    });
  } catch (cause) {
    console.error('Unified geo request failed:', endpoint, cause);
    error(502, 'The location service is unavailable.');
  }

  if (!response.ok) {
    console.error('Unified geo returned an error:', endpoint, response.status);
    error(502, 'The location service is unavailable.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    console.error('Unified geo returned an invalid response:', endpoint, cause);
    error(502, 'The location service returned an invalid response.');
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    !('success' in payload) ||
    payload.success !== true
  ) {
    console.error('Unified geo returned an unsuccessful response:', endpoint);
    error(502, 'The location service returned an invalid response.');
  }

  return payload as T;
}

export interface UnifiedGeoStyleResult {
  /** Raw MapLibre style JSON served by unified-geo (not an envelope). */
  body: string;
  /** Upstream Cache-Control header to pass through verbatim. */
  cacheControl: string | null;
}

/** Make an authenticated GET request to unified-geo (e.g. /capabilities). */
export async function requestUnifiedGeoGet<T extends UnifiedGeoEnvelope>(
  endpoint: string
): Promise<T> {
  const secret = env.UNIFIED_GEO_API_SECRET;
  if (!secret) error(503, 'The location service is not configured.');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000)
    });
  } catch (cause) {
    console.error('Unified geo request failed:', endpoint, cause);
    error(502, 'The location service is unavailable.');
  }

  if (!response.ok) {
    console.error('Unified geo returned an error:', endpoint, response.status);
    error(502, 'The location service is unavailable.');
  }

  const payload = (await response.json()) as unknown;
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('success' in payload) ||
    payload.success !== true
  ) {
    console.error('Unified geo returned an unsuccessful response:', endpoint);
    error(502, 'The location service returned an invalid response.');
  }

  return payload as T;
}

/** Fetch the map profile for a point (POST /maps/profile). */
export function requestUnifiedGeoProfile(body: {
  coordinate: { longitude: number; latitude: number; coordinateSystem: 'WGS84' | 'GCJ02' };
  scope?: 'regional' | 'global';
  style?: 'dark' | 'light';
  locale?: string;
}): Promise<UnifiedGeoEnvelope & Record<string, unknown>> {
  return requestUnifiedGeo('/maps/profile', body);
}

/**
 * Fetch the MapLibre style document the profile points at (its `styleUrl`,
 * served by unified-geo with the credentials baked in). The style body is
 * returned as-is — not wrapped in an envelope — with the upstream Cache-Control
 * header for pass-through.
 */
export async function fetchUnifiedGeoStyle(styleUrl: string): Promise<UnifiedGeoStyleResult> {
  const secret = env.UNIFIED_GEO_API_SECRET;
  if (!secret) error(503, 'The location service is not configured.');

  let url: URL;
  try {
    url = new URL(styleUrl, `${baseUrl}/`);
  } catch {
    error(502, 'The location service returned an invalid style URL.');
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000)
    });
  } catch (cause) {
    console.error('Unified geo style request failed:', cause);
    error(502, 'The location service is unavailable.');
  }

  if (!response.ok) {
    console.error('Unified geo returned an error for a map style:', response.status);
    error(502, 'The location service is unavailable.');
  }

  return { body: await response.text(), cacheControl: response.headers.get('cache-control') };
}
