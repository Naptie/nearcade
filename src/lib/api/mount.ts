import { base } from '$app/paths';
import { API_MOUNT, RPC_MOUNT } from './paths';

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
