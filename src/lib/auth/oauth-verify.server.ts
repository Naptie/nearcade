/**
 * OAuth 2.1 access-token verification helpers for API route handlers.
 *
 * Provides a unified way to authenticate requests that may come from:
 * 1. Session cookies (first-party, existing behaviour — no scope checks)
 * 2. Bearer OAuth access tokens (third-party, scope-gated)
 * 3. Bearer API keys (existing behaviour, unchanged)
 *
 * Access token types (Better Auth + @better-auth/oauth-provider):
 *
 *   • Opaque (default): issued when the client omits the `resource` parameter.
 *     Verified by looking up the SHA-256-hashed token via the official Better
 *     Auth adapter (ctx.adapter.findOne), which respects schema/model mapping.
 *
 *   • JWT: issued when the client includes a `resource` parameter.
 *     Verified via JWKS using the official `oauthProviderResourceClient` plugin
 *     from @better-auth/oauth-provider/resource-client, which derives endpoints
 *     directly from the auth instance. The JWKS URL is passed explicitly because
 *     our baseURL is configured as a dynamic object, not a static string.
 *
 * Official docs reference: https://better-auth.com/docs/plugins/oauth-provider
 */

import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import { createHash } from 'node:crypto';
import { error, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { auth } from '$lib/auth/index.server';
import type { OAuthScope } from './oauth-scopes';

// Instantiate the official resource-client plugin backed by the same auth
// instance. We call getActions() directly to avoid browser-oriented
// createAuthClient() initialisation (baseURL inference from window.location).
// Cast to `any`: pnpm may resolve @better-auth/oauth-provider to a different
// copy of better-auth types, making them nominally incompatible despite being
// structurally identical.
const { verifyAccessToken: resourceClientVerify } = oauthProviderResourceClient(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  auth as any
).getActions();

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
 * Returns true if the token looks like a JWT (three base64url parts).
 * Better Auth issues opaque access tokens (random alphanumeric strings) and
 * JWT id_tokens — only the latter matches this pattern.
 */
function isJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p));
}

/**
 * Verify an OAuth 2.1 access token and optionally check scopes.
 *
 * Token format detection:
 *  - JWT (3 base64url parts)  → verified via JWKS using the official
 *    oauthProviderResourceClient. Issued when the client sends a `resource`
 *    parameter in the authorization request.
 *  - Opaque (random string)   → verified via the Better Auth adapter
 *    (ctx.adapter.findOne), which mirrors the internal validateOpaqueAccessToken
 *    logic without bypassing the schema/model layer.
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

  const trustedOrigins = [
    ...(env.ALLOWED_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? []),
    new URL(request.url).origin
  ];

  let payload: OAuthTokenPayload;

  if (isJwt(token)) {
    // ── JWT access token ─────────────────────────────────────────────────────
    // Issued when the client provides a `resource` parameter in the auth
    // request. The `iss` is validated against trusted origins to prevent SSRF
    // before we fetch the JWKS.
    const unverified = decodeJwtPayload(token);
    const issuer = typeof unverified?.iss === 'string' ? unverified.iss : null;
    if (!unverified || !issuer) {
      error(401, 'Invalid token: missing issuer');
    }

    // Better Auth sets iss = jwtPlugin.issuer ?? ctx.context.baseURL
    // which includes the basePath, e.g. https://example.com/api/auth.
    const trustedIssuers = trustedOrigins.map((o) => `${o}/api/auth`);
    if (!trustedIssuers.includes(issuer)) {
      error(401, 'Untrusted token issuer');
    }

    try {
      // resourceClientVerify wraps verifyAccessToken from better-auth/oauth2.
      // We pass jwksUrl explicitly because our baseURL is a dynamic object
      // (not a static string), so the plugin cannot derive it automatically.
      const result = await resourceClientVerify(token, {
        jwksUrl: `${issuer}/jwks`,
        verifyOptions: {
          issuer,
          // `aud` is the `resource` parameter from the authorization request.
          // Falls back to the issuer (ctx.context.baseURL) when absent.
          audience: (unverified.aud as string | string[] | undefined) ?? issuer
        }
      });
      payload = result as OAuthTokenPayload;
    } catch (e) {
      console.error('[OAuth] JWT verification failed:', e);
      error(401, 'Invalid or expired OAuth access token');
    }
  } else {
    // ── Opaque access token ──────────────────────────────────────────────────
    // Issued by default (when no `resource` parameter is provided).
    // @better-auth/oauth-provider hashes tokens with SHA-256 (base64url, no
    // padding) before storage — replicate the same transform for the lookup.
    // We use auth.$context.adapter.findOne instead of a driver-specific query
    // so the schema/model-name overrides in betterAuth({ ... }) are respected.
    const hashedToken = createHash('sha256').update(token).digest('base64url');

    const authCtx = await auth.$context;
    const record = (await authCtx.adapter.findOne({
      model: 'oauthAccessToken',
      where: [{ field: 'token', value: hashedToken }]
    })) as Record<string, unknown> | null;

    if (!record) {
      error(401, 'Invalid OAuth access token');
    }
    const expiresAt =
      record.expiresAt instanceof Date
        ? record.expiresAt
        : record.expiresAt
          ? new Date(record.expiresAt as string)
          : null;
    const createdAt =
      record.createdAt instanceof Date
        ? record.createdAt
        : record.createdAt
          ? new Date(record.createdAt as string)
          : null;
    if (expiresAt && expiresAt < new Date()) {
      error(401, 'OAuth access token has expired');
    }
    if (!record.userId) {
      error(401, 'OAuth access token has no associated user');
    }
    const scopes = Array.isArray(record.scopes) ? (record.scopes as string[]) : [];

    payload = {
      sub: String(record.userId),
      scope: scopes.join(' ') || undefined,
      iss: trustedOrigins[0] ? `${trustedOrigins[0]}/api/auth` : undefined,
      aud: record.clientId as string | undefined,
      exp: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : undefined,
      iat: createdAt ? Math.floor(createdAt.getTime() / 1000) : undefined
    };
  }

  // Check required scopes against the token's granted scopes.
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
