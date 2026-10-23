import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
// Type-only import: the real Eden treaty types of the optional
// `unified-geo-client` package. The runtime import stays dynamic (see
// `getTypedUnifiedGeoClient`) so the app still runs when the package is not
// installed, but the contract is no longer mirrored by hand.
import type { Client as UnifiedGeoClient } from 'unified-geo-client';

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
 * The typed client is the `unified-geo-client` Eden treaty package. Only the
 * POST routes nearcade calls are used; everything else keeps using the
 * hand-rolled fetch fallback below.
 *
 * The body is `never` on purpose: the treaty types collapse the discriminated
 * coordinate unions to `never`, and the request bodies are assembled by the
 * callers. The response is validated at runtime by the `success` envelope
 * check in `requestViaTypedClient`.
 */
type UnifiedGeoClientCall = (client: UnifiedGeoClient, body: never) => Promise<unknown>;

const unifiedGeoClientRoutes: Record<string, UnifiedGeoClientCall> = {
  '/geo/convert': (client, body) => client.geo.convert.post(body),
  '/geo/reverse': (client, body) => client.geo.reverse.post(body),
  '/geo/search': (client, body) => client.geo.search.post(body),
  '/maps/profile': (client, body) => client.maps.profile.post(body)
};

// Cached typed client; `null` marks "package unavailable in this process" so a
// failed dynamic import is not retried on every request.
let typedClient: UnifiedGeoClient | null | undefined;

async function getTypedUnifiedGeoClient(secret: string): Promise<UnifiedGeoClient | undefined> {
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
    }) as UnifiedGeoClient;
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
    const payload = unwrapTreatyResult(await call(client, body as never));
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
  const viaClient = await requestViaTypedClient<T>(endpoint, body as never, secret);
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

/** Fetch a MapLibre style document served by unified-geo (GET /maps/styles). */
export async function requestUnifiedGeoStyle(params: {
  provider: 'bing-cn' | 'amap' | 'google';
  theme?: 'dark' | 'light';
  locale?: 'zh-CN' | 'en-US';
}): Promise<UnifiedGeoStyleResult> {
  const secret = env.UNIFIED_GEO_API_SECRET;
  if (!secret) error(503, 'The location service is not configured.');

  const query = new URLSearchParams({ provider: params.provider });
  if (params.theme) query.set('theme', params.theme);
  if (params.locale) query.set('locale', params.locale);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/maps/styles?${query.toString()}`, {
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
