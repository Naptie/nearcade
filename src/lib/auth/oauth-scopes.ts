/**
 * OAuth 2.1 scope definitions for the Nearcade API.
 *
 * Scopes follow the pattern `action:resource` where:
 * - action: "read" (GET endpoints) or "write" (POST/PUT/PATCH/DELETE)
 * - resource: the API resource group
 *
 * Standard OIDC scopes (openid, profile, email, offline_access) are also supported.
 */

/** All custom API scopes supported by the OAuth provider. */
export const OAUTH_SCOPES = [
  // OIDC standard
  'openid',
  'profile',
  'email',
  'offline_access',

  // Shops / Arcades
  'read:shops',
  'write:shops',

  // Universities
  'read:universities',
  'write:universities',

  // Clubs
  'read:clubs',
  'write:clubs',

  // Posts
  'read:posts',
  'write:posts',

  // Comments
  'read:comments',
  'write:comments',

  // Users
  'read:users',
  'write:users',

  // Images
  'read:images',
  'write:images',

  // Notifications
  'read:notifications',
  'write:notifications'
] as const;

export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/**
 * Mapping from scope to the API tags/resources it covers.
 * Used for documentation and scope validation in route handlers.
 */
export const SCOPE_RESOURCE_MAP: Record<string, string[]> = {
  'read:shops': ['shops'],
  'write:shops': ['shops'],
  'read:universities': ['universities'],
  'write:universities': ['universities'],
  'read:clubs': ['clubs'],
  'write:clubs': ['clubs'],
  'read:posts': ['posts'],
  'write:posts': ['posts'],
  'read:comments': ['comments'],
  'write:comments': ['comments'],
  'read:users': ['users'],
  'write:users': ['users'],
  'read:images': ['images'],
  'write:images': ['images'],
  'read:notifications': ['notifications'],
  'write:notifications': ['notifications']
};

/**
 * Given an API tag and HTTP method, returns the required scope.
 */
export function getScopeForEndpoint(tag: string, method: string): OAuthScope | null {
  const action = method.toUpperCase() === 'GET' ? 'read' : 'write';
  const scope = `${action}:${tag}` as OAuthScope;
  return OAUTH_SCOPES.includes(scope) ? scope : null;
}

/**
 * Route prefixes that map to a resource category.
 * Order matters — more specific prefixes first.
 *
 * Paths not listed here (admin, auth, redirect, geo, meilisearch, wechat,
 * machines, invites, rankings, discover) are either internal/admin-only
 * and will be BLOCKED for OAuth tokens, or are public read-only.
 */
const PATH_RESOURCE_RULES: {
  prefix: string;
  resource: string;
  /** Override the scope required for GET requests instead of auto-deriving `read:{resource}`. */
  readScope?: OAuthScope;
  /** Override the scope required for non-GET requests instead of auto-deriving `write:{resource}`. */
  writeScope?: OAuthScope;
}[] = [
  // Comments (standalone endpoint before shops/posts sub-routes)
  { prefix: '/api/comments/', resource: 'comments' },

  // Posts (including sub-routes like /posts/:id/comments, /posts/:id/vote)
  { prefix: '/api/posts/', resource: 'posts' },

  // Shops (including sub-routes like attendance, changelog, photos, queues, etc.)
  { prefix: '/api/shops/', resource: 'shops' },

  // Universities
  { prefix: '/api/universities/', resource: 'universities' },

  // Clubs
  { prefix: '/api/clubs/', resource: 'clubs' },

  // Profile — uses OIDC "profile" scope (no read:/write: prefix)
  { prefix: '/api/me/', resource: 'profile', readScope: 'profile', writeScope: 'write:users' },

  // Users
  { prefix: '/api/users/', resource: 'users' },

  // Images
  { prefix: '/api/images/', resource: 'images' },

  // Notifications
  { prefix: '/api/notifications/', resource: 'notifications' },

  // Discover (read-only public data — allow with read:shops)
  { prefix: '/api/discover', resource: 'shops' },

  // Rankings (read-only public data — allow with read:universities)
  { prefix: '/api/rankings', resource: 'universities' }
];

/** Paths that are completely blocked from OAuth access (admin, internal). */
const BLOCKED_PREFIXES = [
  '/api/admin/',
  '/api/meilisearch/',
  '/api/wechat/',
  '/api/machines/',
  '/api/invites/',
  '/api/geo/',
  '/api/redirect'
];

/**
 * Resolve the required OAuth scope(s) for an API request path + method.
 *
 * @returns An array of required scopes, or `null` if the path is **blocked**
 *          for OAuth tokens entirely (admin/internal endpoints).
 *          An empty array means "any valid token is accepted" (no specific scope needed).
 */
export function resolveRequiredScopes(pathname: string, method: string): OAuthScope[] | null {
  // Block admin / internal endpoints for OAuth tokens
  for (const prefix of BLOCKED_PREFIXES) {
    if (pathname.startsWith(prefix)) return null;
  }

  // Find the resource category
  for (const rule of PATH_RESOURCE_RULES) {
    if (pathname.startsWith(rule.prefix) || pathname === rule.prefix.replace(/\/$/, '')) {
      const isRead = method.toUpperCase() === 'GET';
      const explicitScope = isRead ? rule.readScope : rule.writeScope;
      if (explicitScope !== undefined) {
        return [explicitScope];
      }
      const action = isRead ? 'read' : 'write';
      const scope = `${action}:${rule.resource}` as OAuthScope;
      return [scope];
    }
  }

  // Unknown path — block by default for safety
  return null;
}
