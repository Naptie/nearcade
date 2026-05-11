/**
 * OAuth 2.1 access-token verification helpers for API route handlers.
 *
 * Provides a unified way to authenticate requests that may come from:
 * 1. Session cookies (first-party, existing behaviour — no scope checks)
 * 2. Bearer OAuth access tokens (third-party, scope-gated)
 * 3. Bearer API keys (existing behaviour, unchanged)
 */

import { verifyAccessToken } from 'better-auth/oauth2';
import { error, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { OAuthScope } from './oauth-scopes';

export interface OAuthTokenPayload {
  /** Subject (user ID) */
  sub: string;
  /** Space-separated granted scopes */
  scope?: string;
  /** Issuer */
  iss?: string;
  /** Audience */
  aud?: string | string[];
  /** Expiration (seconds since epoch) */
  exp?: number;
  /** Issued at (seconds since epoch) */
  iat?: number;
  [key: string]: unknown;
}

/**
 * Extract a Bearer token from the Authorization header, if present.
 */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

/**
 * Verify an OAuth 2.1 access token (JWT) and optionally check scopes.
 *
 * @returns The decoded token payload, or `null` if no bearer token was present.
 * @throws 401 if the token is invalid; 403 if a required scope is missing.
 */
export async function verifyOAuthAccessToken(
  request: Request,
  requiredScopes?: OAuthScope[]
): Promise<OAuthTokenPayload | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  // Skip tokens that look like Nearcade API keys (nk_ prefix)
  if (token.startsWith('nk_')) return null;

  // Derive the issuer from ALLOWED_ORIGINS (first origin) or the request URL
  const baseOrigin =
    env.ALLOWED_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean)[0] ?? new URL(request.url).origin;
  const issuer = `${baseOrigin}/api/auth`;
  const jwksUrl = `${issuer}/jwks`;

  let payload: OAuthTokenPayload;
  try {
    const result = await verifyAccessToken(token, {
      jwksUrl,
      verifyOptions: {
        issuer,
        audience: baseOrigin
      },
      scopes: requiredScopes
    });
    payload = result as OAuthTokenPayload;
  } catch (e) {
    // Distinguish scope errors from token validation errors
    const msg = e instanceof Error ? e.message : '';
    if (msg.toLowerCase().includes('scope')) {
      error(403, `Insufficient scope. ${msg}`);
    }
    error(401, 'Invalid or expired OAuth access token');
  }

  return payload;
}

/**
 * Authenticate a request from any supported method.
 *
 * Checks in order:
 * 1. Session cookie (first-party) → returns user from `locals.session`
 * 2. OAuth Bearer token → verifies JWT + checks required scopes
 *
 * API-key auth is intentionally NOT handled here because it uses its own
 * verification flow (via `auth.api.verifyApiKey`).
 *
 * @returns `{ user, session?, oauthToken? }` for the authenticated entity.
 * @throws 401 if no valid authentication is found.
 */
export async function requireAuth(event: RequestEvent, options?: { scopes?: OAuthScope[] }) {
  // 1. Session cookie — first-party, always allowed
  const session = event.locals.session;
  if (session) {
    return { user: session.user, session, oauthToken: null };
  }

  // 2. OAuth Bearer token
  const oauthToken = await verifyOAuthAccessToken(event.request, options?.scopes);
  if (oauthToken) {
    return { user: null, session: null, oauthToken };
  }

  // No valid auth found
  error(401, 'Authentication required');
}
