import { SSC_SECRET } from '$env/static/private';
import { getApiMeta, type ApiGuard } from '$lib/api/contract';
import { forbidden, unauthorized } from '$lib/api/errors';
import { findMachineByApiSecret } from '$lib/utils/machine.server';
import { hasValidSecret } from './admin';
import type { AnyMiddleware } from './types';

/** A bearer credential the handler may resolve on its own (agent API keys). */
const presentsBearerCredential = (request: Request): boolean => {
  const authorization = request.headers.get('Authorization');
  return typeof authorization === 'string' && authorization.startsWith('Bearer ');
};

/**
 * Enforce the authorization requirement a procedure declares.
 *
 * The legacy handlers checked the session *before* they validated the request,
 * so an unauthenticated call answered 401 (or 403) rather than 400. oRPC
 * validates the input before the handler runs, which would have inverted that
 * order. This middleware runs before the validation (oRPC places the input
 * validation after the middleware chain), so the original order — and with it
 * the original status codes — is preserved.
 *
 * That ordering is a property of where the middleware is attached, and it was
 * verified rather than assumed: a **router-level** middleware runs before the
 * input is validated, while a **procedure-level** middleware does not run at
 * all when the input is invalid. This middleware is therefore attached to the
 * router in `src/lib/api/router.ts`, and it has to stay there — moving it onto
 * a procedure would silently turn every unauthenticated request with a
 * malformed body from a 401 into a 400.
 *
 * Every {@link ApiGuard} is handled here, and the `never` at the end of the
 * chain makes an unhandled guard a *compile* error rather than a request that
 * silently reaches a handler the contract said was closed.
 */
export const enforceAuthGuard: AnyMiddleware = async ({ context, procedure, next }) => {
  const { guard }: { guard: ApiGuard } = getApiMeta(procedure);

  switch (guard) {
    case 'none':
      break;

    case 'session':
      if (!context.session?.user) {
        unauthorized();
      }
      break;

    case 'site_admin':
      if (!context.session?.user) {
        unauthorized();
      }
      if (context.session.user.userType !== 'site_admin') {
        forbidden();
      }
      break;

    case 'secret':
      // The legacy handlers compared the raw header, without a `Bearer ` prefix.
      if (context.event.request.headers.get('Authorization') !== SSC_SECRET) {
        unauthorized();
      }
      break;

    case 'site_admin_or_secret':
      // Unattended automation presents `SSC_SECRET` and has no session at all,
      // so the session branch alone would reject exactly the caller this guard
      // exists to admit. `requireSiteAdminOrSecret` records which one authorized
      // the call.
      if (!hasValidSecret(context.event.request)) {
        if (!context.session?.user) {
          unauthorized();
        }
        if (context.session.user.userType !== 'site_admin') {
          forbidden();
        }
      }
      break;

    case 'site_admin_or_secret_or_machine':
      // Three credentials open this door: the shared secret, a machine's API
      // secret and a `site_admin` session. Each of them has to survive the
      // guard, because the guard runs before the handler and a credential the
      // guard rejects can never reach the code that would have accepted it.
      if (hasValidSecret(context.event.request)) {
        break;
      }
      if (await findMachineByApiSecret(context.event.request)) {
        break;
      }
      if (!context.session?.user) {
        unauthorized();
      }
      if (context.session.user.userType !== 'site_admin') {
        forbidden();
      }
      break;

    case 'session_or_agent_key':
      // An agent API key is not a session and may be a composite
      // `agent/user` token that no session resolver can read, so its
      // verification belongs to the handler, which has the token parts. The
      // guard's only job is to refuse a request that carries no credential at
      // all; an invalid key is rejected there with a 401 of its own.
      if (!context.session?.user && !presentsBearerCredential(context.event.request)) {
        unauthorized();
      }
      break;

    case 'machine':
      // A physical machine proves itself with its API secret. The guard
      // verifies that the secret names an activated machine; whether that
      // machine is bound to the shop it is acting for needs the request body,
      // which the guard runs before, so the handler checks it.
      if (!(await findMachineByApiSecret(context.event.request))) {
        unauthorized();
      }
      break;

    default: {
      const unreachable: never = guard;
      throw new Error(`Unhandled API guard "${String(unreachable)}".`);
    }
  }

  return next({ context });
};
