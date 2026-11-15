import { base } from '$app/paths';
import { env } from '$env/dynamic/public';
import { API_MOUNT, RPC_MOUNT } from './paths';
import { procedurePath } from './routes';

/**
 * URL prefixes the two oRPC handlers are mounted on.
 *
 * `base` is SvelteKit's `paths.base` (`PATH_BASE`). It has to be part of the
 * prefix: SvelteKit strips the base from the *route resolution* path but not
 * from `request.url.pathname`, and oRPC matches the prefix against the latter.
 */
const withBase = (suffix: string): `/${string}` => `${base}${suffix}` as `/${string}`;

export const API_PREFIX = withBase(API_MOUNT);

/**
 * Prefix of the typed RPC surface. It lives under `/api/` so the existing
 * CORS handling in `hooks.server.ts` keeps applying, and it is excluded from
 * the service worker's `/api/` cache rule.
 */
export const RPC_PREFIX = withBase(RPC_MOUNT);

/**
 * The URL the browser uses to refresh a map's attribution for a viewport.
 *
 * It points at this app's own route, never at a provider's: the client must
 * not learn a provider URL, and the route is the one that proxies unified-geo
 * server-side. The placeholders are filled in by the unified-geo-client
 * adapter.
 *
 * The prefix is the one the API is mounted on, so a deployment under a base
 * path keeps working. A deployment that serves the front end and the API from
 * different hosts points `PUBLIC_API_BASE` at the API host instead.
 */
export const attributionUrlTemplate = (): string =>
  `${env.PUBLIC_API_BASE ?? base}${procedurePath('getGeoAttribution')}` +
  '?zoom={z}&north={north}&south={south}&east={east}&west={west}';
