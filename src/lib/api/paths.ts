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
 * The service worker's `/api/` cache rule excludes the typed surface by name,
 * so the exclusion stays correct when the mount moves. It lives here because
 * this module carries no `$app/*` import, which a service worker cannot
 * resolve.
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
