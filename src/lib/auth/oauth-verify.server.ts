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
 * Decode a JWT payload without verifying the signature.
 * Used to read the `iss` claim before fetching the correct JWKS endpoint.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

/**
 * Verify an OAuth 2.1 access token (JWT) and optionally check scopes.
 *
 * The JWKS endpoint and issuer are derived from the `iss` claim inside the
 * token itself (Better Auth sets `iss` to `{origin}/api/auth`). The claimed
 * issuer is validated against ALLOWED_ORIGINS before trusting it, preventing
 * SSRF / forged-issuer attacks.
 *
 * @returns The decoded token payload, or `null` if no bearer token was present.
 * @throws 401 if the token is invalid or from an untrusted issuer; 403 if a required scope is missing.
 */
export async function verifyOAuthAccessToken(
  request: Request,
  requiredScopes?: OAuthScope[]
): Promise<OAuthTokenPayload | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  // Skip tokens that look like Nearcade API keys (nk_ prefix)
  if (token.startsWith('nk_')) return null;

  // Read the issuer from the unverified JWT payload.
  // Better Auth sets iss = "{origin}/api/auth".
  const unverified = decodeJwtPayload(token);
  const issuer = typeof unverified?.iss === 'string' ? unverified.iss : null;
  if (!unverified || !issuer) {
    error(401, 'Invalid token: missing issuer');
  }

  // Validate the issuer is one of our trusted origins to prevent SSRF.
  const trustedIssuers = [
    ...(env.ALLOWED_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? []),
    new URL(request.url).origin
  ].map((o) => `${o}/api/auth`);
  if (!trustedIssuers.includes(issuer)) {
    error(401, 'Untrusted token issuer');
  }

  // The JWKS endpoint is always at {iss}/jwks for Better Auth.
  const jwksUrl = `${issuer}/jwks`;

  // Better Auth sets `aud` to the OAuth client ID. Read it from the unverified
  // payload to satisfy the verifyOptions type (the signature check confirms it).
  const audience = unverified.aud as string | string[] | undefined;

  let payload: OAuthTokenPayload;
  try {
    const result = await verifyAccessToken(token, {
      jwksUrl,
      verifyOptions: {
        issuer,
        ...(audience !== undefined ? { audience } : {})
      } as Parameters<typeof verifyAccessToken>[1]['verifyOptions']
      // Scope checking is done manually below for clearer error messages.
    });
    payload = result as OAuthTokenPayload;
  } catch (e) {
    console.log(e);
    error(401, 'Invalid or expired OAuth access token');
  }

  // Check required scopes against the token's `scope` claim.
  if (requiredScopes && requiredScopes.length > 0) {
    const grantedScopes = new Set((payload.scope as string | undefined)?.split(' ') ?? []);
    const missing = requiredScopes.filter((s) => !grantedScopes.has(s));
    if (missing.length > 0) {
      error(403, `Insufficient scope. Required: ${missing.join(', ')}`);
    }
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
