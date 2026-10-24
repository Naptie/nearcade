import { SSC_SECRET } from '$env/static/private';
import { m } from '$lib/paraglide/messages';
import { getApiMeta } from '$lib/api/contract';
import { API_TOKEN_PREFIX } from '$lib/api-tokens';
import { forbidden } from '../errors';
import type { AnyMiddleware } from './types';

/**
 * Credentials that bypass the OAuth scope matrix entirely.
 *
 * API tokens and the shared `SSC_SECRET` are service-to-service credentials.
 * They have always skipped scope enforcement, and they must keep doing so —
 * tightening it would break API-key and automation consumers.
 */
const bypassesScopeMatrix = (authorization: string | null): boolean => {
  if (!authorization) return false;
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : authorization;
  return token.startsWith(API_TOKEN_PREFIX) || token === SSC_SECRET;
};

/**
 * Enforce the per-procedure OAuth scope.
 *
 * The scope a procedure requires is declared on its contract, so this
 * middleware never has to know anything about URL paths. It reproduces the
 * outcome of the legacy pathname table:
 *
 * - no `Authorization` header → first-party session cookie → allowed.
 * - an API token or `SSC_SECRET` → allowed (bypass preserved).
 * - OAuth access token → the token must hold the procedure's scope.
 *
 * The procedure's scope is one of three things, and the difference between
 * them is the whole point:
 *
 * - `'open'`  — the procedure is reachable by anyone, so no scope is demanded
 *   of a token. Presenting a token must never *reduce* access, or a credential
 *   would be worse than no credential at all.
 * - `null`    — no OAuth client may call the procedure.
 * - a scope   — the token must hold it.
 */
export const enforceOAuthScope: AnyMiddleware = async ({ context, procedure, next }) => {
  const authorization = context.event.request.headers.get('Authorization');

  // No bearer credential: this is a first-party session (or anonymous) call.
  if (!authorization?.startsWith('Bearer ')) {
    return next({ context });
  }

  // Service credentials bypass the scope matrix.
  if (bypassesScopeMatrix(authorization)) {
    return next({ context });
  }

  // `context.oauthScopes` is `null` when the request did not resolve to an
  // OAuth token. `hooks.server.ts` rejects invalid bearer tokens before the
  // router is reached, so there is nothing left to check here.
  const granted = context.oauthScopes;
  if (!granted) {
    return next({ context });
  }

  const { scope } = getApiMeta(procedure);

  // Closed to OAuth clients entirely.
  if (scope === null) {
    forbidden(m.access_denied());
  }

  // Reachable by anyone: no scope is demanded of the token.
  if (scope === 'open') {
    return next({ context });
  }

  if (!granted.includes(scope)) {
    forbidden(m.access_denied());
  }

  return next({ context });
};
