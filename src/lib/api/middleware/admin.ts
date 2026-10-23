import { SSC_SECRET } from '$env/static/private';
import { m } from '$lib/paraglide/messages';
import { getApiMeta, guardAdmitsSecret } from '$lib/api/contract';
import type { ApiContext } from '$lib/api/context';
import { apiError, forbidden, unauthorized } from '../errors';
import type { AnyMiddleware } from './types';

/**
 * Admin endpoints protect themselves with a first-party session whose user is a
 * `site_admin`. Some of them additionally accept the shared `SSC_SECRET` so
 * that unattended automation can trigger them.
 */

/** True when the request carries the shared service secret. */
export const hasValidSecret = (request: Request): boolean => {
  const authHeader = request.headers.get('Authorization');
  const normalized = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  return normalized === SSC_SECRET;
};

const assertSiteAdmin = (context: ApiContext): void => {
  if (!context.session?.user) {
    unauthorized(m.unauthorized());
  }
  if (context.session.user.userType !== 'site_admin') {
    forbidden(m.access_denied());
  }
};

/** Require a `site_admin` session. */
export const requireSiteAdmin: AnyMiddleware = async ({ context, next }) => {
  assertSiteAdmin(context);
  return next({ context });
};

/** Identity of the caller behind an admin action. */
export interface AdminIdentity {
  source: 'ssc' | 'site_admin';
  userId: string | null;
  userName: string;
}

/** Context extended with the resolved admin identity. */
export interface AdminContext extends ApiContext {
  admin: AdminIdentity;
}

/**
 * Require either a `site_admin` session **or** the shared service secret, and
 * expose which of the two authorized the call.
 *
 * The router-level `enforceAuthGuard` runs first, so a procedure that declares
 * a guard which does not admit the secret never reaches this middleware — the
 * `SSC_SECRET` branch would be dead code and every automation caller would get
 * a 401. That mismatch is silent in both directions, so it is asserted here and
 * raised as a server error rather than left to be discovered in production.
 */
export const requireSiteAdminOrSecret: AnyMiddleware<AdminContext> = async ({
  context,
  procedure,
  next
}) => {
  const { guard } = getApiMeta(procedure);
  if (!guardAdmitsSecret(guard)) {
    apiError(
      'INTERNAL_SERVER_ERROR',
      'A procedure uses requireSiteAdminOrSecret but its contract declares ' +
        `guard "${guard}", which does not admit SSC_SECRET. Declare 'site_admin_or_secret'.`
    );
  }

  if (hasValidSecret(context.event.request)) {
    return next({
      context: {
        ...context,
        admin: { source: 'ssc', userId: null, userName: 'Remote service' }
      }
    });
  }

  assertSiteAdmin(context);

  const user = context.session!.user;
  return next({
    context: {
      ...context,
      admin: {
        source: 'site_admin',
        userId: user.id,
        userName: user.displayName || user.name || user.id
      }
    }
  });
};
