/**
 * OAuth 2.1 scope definitions for the nearcade API.
 *
 * Scopes follow the pattern `action:resource` where:
 * - action: "read" (GET endpoints) or "write" (mutating endpoints)
 * - resource: the capability the endpoint belongs to
 *
 * Standard OIDC scopes (openid, profile, email, offline_access) are also supported.
 *
 * ## What a scope does and does not mean here
 *
 * A scope answers exactly one question: **what may a third-party OAuth client do
 * with the identity it was granted?** It never answers "who may call this
 * endpoint" — that is the `guard` (see `src/lib/api/contract.ts`). The two are
 * different axes and the scope is the one that only applies to OAuth clients.
 *
 * That separation has a consequence worth stating plainly: **a route that is
 * open to anonymous callers carries no scope at all.** A scope on such a route
 * could only ever *remove* access from a token holder, never grant any, and a
 * credential that reduces your access is worse than no credential at all. So
 * the read scopes below are the ones that actually gate something — reading
 * another user's data — and every openly-readable endpoint is scope-free.
 *
 * This list is the catalog the OAuth provider advertises. Which scope a
 * *specific endpoint* requires is not declared here — it is declared on the
 * endpoint's contract route and resolved from the contract by
 * `$lib/api/routes`, so the two can never drift apart.
 */

/**
 * The OpenID Connect scopes the provider supports.
 *
 * These are identity scopes, not API capabilities: they say what the client
 * may learn about the user at the identity layer. No endpoint in the contract
 * demands one, so they are exempt from the "every scope is claimed by a
 * procedure" rule.
 */
export const OIDC_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;

/** All custom API scopes supported by the OAuth provider. */
export const OAUTH_SCOPES = [
  ...OIDC_SCOPES,

  // Reading other people's data
  'read:account',
  'read:notifications',

  // Your own account
  'write:account',
  'write:notifications',

  // Expressive UGC
  'write:posts',
  'write:comments',
  'write:images',

  // Organisation administration
  'write:clubs',
  'write:universities',
  'write:shops',

  // Presence and live venue data
  'write:attendance',
  'write:reports',

  // Community moderation
  'write:moderation'
] as const;

export type OAuthScope = (typeof OAUTH_SCOPES)[number];
