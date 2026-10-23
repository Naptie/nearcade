/**
 * The mount paths of the two API surfaces, without `paths.base`.
 *
 * They live in their own module because they are needed in two very different
 * places: the SvelteKit handlers, which mount the oRPC routers under these
 * paths, and the route index, which matches a request path against the
 * contract. The route index is also loaded by the offline contract checks,
 * which run outside the Vite pipeline and therefore cannot resolve `$app/*`.
 */

/** The mount path of the REST surface, served by the OpenAPI handler. */
export const API_MOUNT = '/api';

/** The mount path of the typed RPC surface, served by the RPC handler. */
export const RPC_MOUNT = '/api/_rpc';

/**
 * The trailing path segment of the RPC mount, with its leading slash.
 *
 * Exists so the service worker's `/api/` cache rule can exclude the typed
 * surface by name instead of repeating the literal. A cached RPC call would be
 * replayed to the next caller, so the exclusion has to stay correct when the
 * mount moves.
 *
 * Derived from `RPC_MOUNT` rather than written out, so moving the mount cannot
 * leave the service worker's exclusion pointing at a stale segment.
 *
 * It lives here rather than next to `API_PREFIX` / `RPC_PREFIX` because those
 * fold in `paths.base` and therefore need `$app/paths` — which a service worker
 * cannot resolve. This module stays free of `$app/*` imports so both the
 * handlers, the offline contract checks, and `src/sw.ts` can read it.
 */
export const RPC_PATH_SEGMENT = RPC_MOUNT.slice(API_MOUNT.length);

/**
 * The path of the interactive API reference, relative to the API mount.
 *
 * It is served by the OpenAPI handler, and the service worker and the build
 * config both have to leave it alone — the reference is a multi-megabyte
 * developer tool that must never end up in a cache. The path lives here so
 * those places can name it instead of repeating the literal.
 */
export const API_DOCS_PATH = '/docs';
