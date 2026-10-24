import { contractRouter } from './contracts';
import { API_MOUNT } from './paths';
import type { ApiScope } from './contract';
import type { OAuthScope } from '$lib/auth/oauth/scopes';

/**
 * The route index of the nearcade API, derived from the contract.
 *
 * The contract already declares, for every procedure, the HTTP method, the
 * path it is served on and the OAuth scope it requires. This module turns that
 * declaration into a lookup so a request can be matched to its procedure
 * without a second, hand-maintained table of URL prefixes.
 *
 * The scope a procedure requires therefore has exactly one home: the `scope`
 * on its contract route.
 */

/** One procedure of the contract, reduced to what a request can be matched on. */
type RouteEntry = {
  method: string;
  /** The path the procedure is served on, with `{param}` placeholders. */
  path: string;
  /** The matcher for that path. */
  matcher: RegExp;
  /** The stable identity of the procedure, as published in the OpenAPI document. */
  operationId: string;
  /** The OAuth policy the procedure declares. */
  scope: ApiScope;
};

/** How many path parameters a contract path has. */
const parameterCount = (path: string): number => (path.match(/\{[^/{}]+\}/g) ?? []).length;

/**
 * Turn a contract path into a matcher.
 *
 * `{id}` matches a single path segment. A trailing slash is tolerated on a
 * route whose last segment is literal — the router serves `/shops` and
 * `/shops/` alike — but not on a route that ends in a parameter, which the
 * router does not match with a trailing slash.
 *
 * A splat parameter (`{+ids}`) spans several path segments, and the router
 * serves it that way: oRPC turns it into a wildcard route, so
 * `GET /api/regions/123/456` reaches the same procedure as
 * `GET /api/regions/123`. The matcher has to agree, or the route index would
 * answer "this path is not served" for a request the router happily serves —
 * and an OAuth token would be refused while an anonymous caller was let in.
 */
const toMatcher = (path: string): RegExp => {
  const endsWithParameter = parameterCount(path) > 0 && /\{[^/{}]+\}$/.test(path);
  const source = path.replace(/\{(\+[^/{}]*)\}/g, '.+').replace(/\{[^/{}]+\}/g, '[^/]+');
  return new RegExp(`^${source}${endsWithParameter ? '' : '/?'}$`);
};

const collectRoutes = (node: unknown, out: RouteEntry[] = []): RouteEntry[] => {
  if (!node || typeof node !== 'object') return out;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '~orpc') continue;

    const bag = (
      value as {
        '~orpc'?: {
          meta?: { scope?: ApiScope };
          route?: { method?: string; path?: string; operationId?: string };
        };
      }
    )['~orpc'];

    if (bag?.meta && bag.route?.path) {
      out.push({
        method: (bag.route.method ?? 'GET').toUpperCase(),
        path: bag.route.path,
        matcher: toMatcher(bag.route.path),
        operationId: bag.route.operationId ?? '',
        scope: bag.meta.scope ?? null
      });
      continue;
    }

    collectRoutes(value, out);
  }

  return out;
};

/**
 * Every procedure of the contract, with the path it is mounted on.
 *
 * The contract declares the paths without the `/api` mount, so it is added
 * here — the same prefix the REST handler serves on.
 *
 * The routes are ordered so that a literal path is matched before a
 * parameterized one: `/shops/delete-requests` is its own procedure, and must
 * not be swallowed by `/shops/{id}`.
 */
const routes: RouteEntry[] = collectRoutes(contractRouter)
  .map((route) => ({
    ...route,
    path: `${API_MOUNT}${route.path}`,
    matcher: toMatcher(`${API_MOUNT}${route.path}`)
  }))
  .sort((a, b) => parameterCount(a.path) - parameterCount(b.path));

/** The procedure a request addresses, if the contract serves one. */
const findRoute = (pathname: string, method: string): RouteEntry | undefined => {
  const upper = method.toUpperCase();
  return routes.find((route) => route.method === upper && route.matcher.test(pathname));
};

/**
 * The operation a request addresses, if the contract serves one.
 *
 * The route index is the one place that knows which procedure a path belongs
 * to, so anything that has to reason about a request path — the contract check,
 * for one — reads it from here rather than matching paths a second time.
 */
export const matchContractRoute = (
  pathname: string,
  method: string
): ContractOperationId | undefined => findRoute(pathname, method)?.operationId;

/**
 * The OAuth policy a request's path carries.
 *
 * - `closed` — no OAuth client may call this. That covers the procedures the
 *   contract declares closed (`scope: null`) and any path the contract does
 *   not serve at all.
 * - `open`   — anyone may call this, with or without a token. No scope is
 *   demanded, so there is nothing for the scope matrix to decide.
 * - `scoped` — an OAuth client must hold the named scope.
 */
export type ContractScope =
  { kind: 'closed' } | { kind: 'open' } | { kind: 'scoped'; scope: OAuthScope };

/**
 * The OAuth policy a request needs.
 *
 * A path the contract does not serve is closed rather than passed through: an
 * unknown path is not a permission question, and closing it is what the
 * previous implementation did for every path it did not know either.
 */
export const resolveContractScope = (pathname: string, method: string): ContractScope => {
  const route = findRoute(pathname, method);
  if (!route) return { kind: 'closed' };
  if (route.scope === null) return { kind: 'closed' };
  if (route.scope === 'open') return { kind: 'open' };
  return { kind: 'scoped', scope: route.scope };
};

/**
 * The published `operationId` of every procedure of the contract.
 *
 * Read from the contract itself, so a procedure that is renamed cannot be
 * addressed by its old name: the URL builders below take the id of a procedure
 * that exists, and `scripts/check-api-contract.ts` fails the build when a call
 * site names one that does not.
 */
export type ContractOperationId = string;

/** The routes of the contract, by their published operation id. */
const routesByOperationId = new Map(routes.map((route) => [route.operationId, route]));

/**
 * The path of a procedure, relative to the site root.
 *
 * @param operationId — the procedure's published `operationId`.
 * @param params — the values for the procedure's path parameters.
 */
export const procedurePath = (
  operationId: ContractOperationId,
  params: Record<string, string | number> = {}
): string => {
  const route = routesByOperationId.get(operationId);
  if (!route) {
    throw new Error(`Unknown API operation "${operationId}".`);
  }

  return route.path.replace(/\{([^/{}]+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing path parameter "${key}" for API operation "${operationId}".`);
    }
    return encodeURIComponent(String(value));
  });
};
