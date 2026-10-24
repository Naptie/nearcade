import { oc } from '@orpc/contract';
import type { Route } from '@orpc/contract';
import type { OAuthScope } from '$lib/auth/oauth/scopes';
import { apiErrorMap } from './errors';

/**
 * The OAuth policy a procedure declares.
 *
 * - `'open'` — no scope gate. Anyone may call the procedure, with or without
 *              a token. This is the only value a procedure whose guard is
 *              `'none'` may carry: a scope there could only ever subtract
 *              access from a token holder, never grant any.
 * - `OAuthScope` — a third-party OAuth client must hold this scope to call the
 *              procedure. A first-party session cookie is unaffected.
 * - `null`     — no OAuth client may call the procedure at all. It stays open
 *              to whatever else the guard admits.
 */
export type ApiScope = OAuthScope | 'open' | null;

/**
 * Publication tier of a nearcade API procedure.
 *
 * - `public`  — published in the OpenAPI document served at `/openapi.json`.
 * - `private` — reachable over HTTP at the very same URL, but deliberately
 *               absent from the published document. Third-party OAuth clients
 *               are blocked from these endpoints (see `src/lib/auth/oauth/scopes.ts`).
 *
 * The tier lives in the contract, not in a directory name, so a procedure
 * cannot be published by accident: it has to be built from `definePublic`.
 */
export type ApiTier = 'public' | 'private';

/**
 * Authorization requirement of a procedure.
 *
 * oRPC validates the request input *before* the handler runs. The legacy
 * handlers checked the session first, so an unauthenticated request answered
 * 401 (or 403) instead of 400. The guard is enforced by a router-level
 * middleware — middlewares run before the input validation — which restores
 * that order. The router-level placement is load-bearing: a procedure-level
 * middleware does not run at all when the input is invalid, so moving the
 * guard there would turn every unauthenticated request with a malformed body
 * back into a 400.
 *
 * - `none`            — the endpoint is open (the default).
 * - `session`         — a signed-in user is required (401 otherwise).
 * - `site_admin`      — a `site_admin` user is required: 401 without a session,
 *                       403 when the user is not an administrator.
 * - `secret`          — the shared service secret is required (401 otherwise).
 *
 * Some endpoints accept more than one kind of credential. A guard naming a
 * single kind would over-restrict them, so these variants admit any one of the
 * credentials they list and leave the per-kind detail to the handler:
 *
 * - `site_admin_or_secret`  — a `site_admin` session **or** `SSC_SECRET`, so an
 *                            unattended automation can trigger the endpoint.
 * - `site_admin_or_secret_or_machine`
 *                           — a `site_admin` session, `SSC_SECRET` **or** a
 *                            machine credential. The machine secret is verified
 *                            against the activated machine it names; whether that
 *                            machine is bound to the shop the endpoint acts for
 *                            needs the request body, so the handler checks it.
 * - `session_or_agent_key`  — a signed-in user **or** a bearer agent API key.
 *                            The handler resolves the key itself (it may be a
 *                            composite `agent/user` token that no session
 *                            resolver can read), so the guard only has to admit
 *                            the request; every authorization decision stays in
 *                            the handler where the key is actually validated.
 * - `machine`               — a physical machine's API secret, presented as a
 *                            bearer credential. The guard verifies the secret
 *                            belongs to an activated machine; the handler
 *                            verifies the machine is bound to the shop it is
 *                            acting for, because that check needs the request
 *                            body and the guard runs before the input is
 *                            validated.
 *
 * A guard that admits a credential the handler cannot resolve is a silent
 * denial of service, and a guard that is stricter than the handler is a silent
 * outage. Both were real bugs during the migration, so `enforceAuthGuard`
 * handles these variants exhaustively (a `never` check fails the build when a
 * new guard is added without a branch) and `requireSiteAdminOrSecret` asserts
 * that the contract it guards really declares `site_admin_or_secret`.
 */
export type ApiGuard =
  | 'none'
  | 'session'
  | 'site_admin'
  | 'secret'
  | 'site_admin_or_secret'
  | 'site_admin_or_secret_or_machine'
  | 'session_or_agent_key'
  | 'machine';

/**
 * The guards a **published** procedure may declare.
 *
 * The shared service secret never appears in the published document: a
 * procedure that admits it is a procedure only the deployment's own automation
 * may call, which is what the private tier is for. Excluding those guards from
 * the published route type makes the rule a compile error rather than a review
 * comment — a published route that admits the secret does not build.
 */
export type PublicApiGuard = Exclude<
  ApiGuard,
  'secret' | 'site_admin_or_secret' | 'site_admin_or_secret_or_machine'
>;

/** Metadata carried by every nearcade API procedure. */
export type ApiMeta = {
  tier: ApiTier;
  /**
   * The OAuth policy a third-party client must satisfy to call this procedure.
   * See {@link ApiScope}.
   */
  scope: ApiScope;
  /** Authorization requirement, enforced before the input is validated. */
  guard: ApiGuard;
  /**
   * The credentials the operation resolves.
   *
   * A guard says what it *admits*; this says what the operation *uses*. The two
   * must agree: a guard that refuses a credential the operation needs turns the
   * caller away before the code that could serve it runs, and a guard that
   * admits a credential the operation never resolves is a door that leads
   * nowhere.
   */
  credentials: CredentialKind[];
  /**
   * Whether the procedure is kept only for the clients that already use it.
   * A deprecated procedure still works; it is simply not one a new client
   * should adopt.
   */
  deprecated: boolean;
};

/**
 * The kinds of credential an operation can resolve.
 *
 * - `secret`    — the shared service secret (`SSC_SECRET`).
 * - `machine`   — a machine's API secret, bound to the shop it acts for.
 * - `agent_key` — an API token: a machine's secret or one the user minted.
 */
export type CredentialKind = 'secret' | 'machine' | 'agent_key';

/** The OpenAPI operation object oRPC hands to a `spec` callback. */
type OperationObject = Exclude<NonNullable<Route['spec']>, (...args: never[]) => unknown>;

/**
 * A route declaration plus the OAuth scope the endpoint requires.
 *
 * `scope: null` marks a published endpoint that third-party OAuth clients
 * cannot reach — it stays open to first-party sessions and anonymous callers,
 * exactly like the endpoints the legacy pathname table blocked.
 *
 * `deprecated: true` marks an endpoint that is kept working for the clients
 * that still use it but that no new client should adopt. The published
 * document says so, which is what a code generator reads.
 */
export type PublicRoute = Route & {
  scope: ApiScope;
  guard?: PublicApiGuard;
  credentials?: CredentialKind[];
  deprecated?: boolean;
};

/**
 * A private route: served, never published.
 */
export type PrivateRoute = Route & {
  guard?: ApiGuard;
  credentials?: CredentialKind[];
};

/** One OpenAPI security requirement: a map of scheme name to its scopes. */
type SecurityRequirement = NonNullable<OperationObject['security']>;

/**
 * The OpenAPI security requirement for a procedure.
 *
 * Derived from **both** the guard and the scope, because they answer
 * different questions and the document has to state both:
 *
 * - the guard decides *who* may call the endpoint — a session, an
 *   administrator, the shared service secret, a machine;
 * - the scope decides *how much of that identity* a third-party client may
 *   use.
 *
 * A requirement list is an OR: every entry is a way in. So an endpoint that is
 * open to everyone lists the empty requirement `{}` (anonymous) next to the
 * OAuth scheme with an empty scope list (any token), and an endpoint that
 * needs a session lists the session cookie next to the OAuth scheme.
 */
const securityRequirement = (guard: PublicApiGuard, scope: ApiScope): SecurityRequirement => {
  // A machine credential travels in the same `Authorization` header as an OAuth
  // bearer token, so OpenAPI cannot tell the two apart. The operation
  // description carries the detail.
  if (guard === 'machine') {
    return [{ bearerAuth: [] }];
  }

  if (guard === 'none') {
    // Open to everyone. `scope` is `'open'` here by the invariant, so the
    // empty requirement (anonymous) and the OAuth scheme with no scope
    // (any token) are both ways in.
    return scope === null ? [{}] : [{}, { oauth2: [] }];
  }

  // A signed-in user **or** an agent API key. The key travels in the same
  // `Authorization` header as an OAuth bearer token, and it is the same `nk_`
  // token family as a machine's secret, so it shares the `bearerAuth` scheme.
  // Listing it matters: without it the document hides a door the runtime has.
  if (guard === 'session_or_agent_key') {
    return scope === null
      ? [{ sessionCookie: [] }, { bearerAuth: [] }]
      : [{ sessionCookie: [] }, { bearerAuth: [] }, { oauth2: [scope] }];
  }

  // Every remaining guard requires an identity of some kind.
  if (scope === null) {
    // Closed to OAuth clients: only the session (or admin, or agent key) gets in.
    return [{ sessionCookie: [] }];
  }
  if (scope === 'open') {
    return [{ sessionCookie: [] }, { oauth2: [] }];
  }
  return [{ sessionCookie: [] }, { oauth2: [scope] }];
};

/**
 * Declare a public procedure.
 *
 * The scope is pulled out of the route object so it never leaks into the
 * generated OpenAPI operation, and stored in the procedure metadata where the
 * scope middleware reads it. The generated operation documents the security
 * requirement the guard and the scope together imply.
 */
export const definePublic = (route: PublicRoute) => {
  const { scope, guard = 'none', credentials = [], deprecated = false, ...rest } = route;
  const inheritedSpec = rest.spec;

  const spec = (current: OperationObject): OperationObject => {
    const base = typeof inheritedSpec === 'function' ? inheritedSpec(current) : inheritedSpec;
    const operation: OperationObject = { ...current, ...base };

    const withSecurity: OperationObject = {
      ...operation,
      security: securityRequirement(guard, scope)
    };

    if (deprecated) {
      withSecurity.deprecated = true;
    }

    // OpenAPI has no vocabulary for "reachable without a token, but refused
    // to tokens that present one", and it has no way to say which guard a
    // procedure declares, so both are recorded as vendor extensions.
    return Object.assign(withSecurity, {
      'x-nearcade-guard': guard,
      'x-nearcade-oauth': scope === null ? 'closed' : scope
    });
  };

  return oc
    .$meta<{
      tier: 'public';
      scope: ApiScope;
      guard: ApiGuard;
      credentials: CredentialKind[];
      deprecated: boolean;
    }>({
      tier: 'public',
      scope,
      guard,
      credentials,
      deprecated
    })
    .errors(apiErrorMap)
    .route({ ...rest, spec });
};

/** Declare a private procedure — served, but never published. */
export const definePrivate = (route: PrivateRoute) => {
  const { guard = 'none', credentials = [], ...rest } = route;
  return oc
    .$meta<{
      tier: 'private';
      scope: ApiScope;
      guard: ApiGuard;
      credentials: CredentialKind[];
      deprecated: boolean;
    }>({
      tier: 'private',
      scope: null,
      guard,
      credentials,
      deprecated: false
    })
    .errors(apiErrorMap)
    .route(rest);
};

/**
 * Read the API metadata off a contract or procedure.
 *
 * oRPC exposes the merged metadata on the `~orpc` bag of every contract and
 * procedure, which is what lets a single router-level middleware enforce the
 * per-procedure OAuth scope without every implementation repeating it.
 */
export const getApiMeta = (procedure: unknown): ApiMeta => {
  const meta = (procedure as { '~orpc'?: { meta?: Partial<ApiMeta> } })?.['~orpc']?.meta;
  return {
    tier: meta?.tier === 'private' ? 'private' : 'public',
    scope: meta?.scope ?? null,
    guard: meta?.guard ?? 'none',
    credentials: meta?.credentials ?? [],
    deprecated: meta?.deprecated === true
  };
};

/**
 * Whether a guard admits the shared service secret.
 *
 * The one place that answers it, so `enforceAuthGuard` and the middlewares that
 * offer a secret cannot drift apart on what a `guard` permits.
 */
export const guardAdmitsSecret = (guard: ApiGuard): boolean =>
  guard === 'secret' ||
  guard === 'site_admin_or_secret' ||
  guard === 'site_admin_or_secret_or_machine';

/**
 * Whether a guard hands the bearer credential to the handler to resolve.
 *
 * True only for `session_or_agent_key`: the agent token may be a composite
 * `agent/user` pair that no session resolver can read, so the guard admits it
 * and the handler verifies it.
 */
export const guardAdmitsAgentKey = (guard: ApiGuard): boolean => guard === 'session_or_agent_key';

/**
 * Whether a guard admits a kind of credential.
 *
 * The one place that answers it, so the contract check and the guard itself
 * cannot drift apart on what a `guard` permits.
 */
export const guardAdmitsCredential = (guard: ApiGuard, kind: CredentialKind): boolean => {
  if (kind === 'secret') return guardAdmitsSecret(guard);
  if (kind === 'machine') return guardAdmitsMachine(guard);
  return guardAdmitsAgentKey(guard);
};

/**
 * The credential kinds a guard admits.
 *
 * The machine secret and the agent key are both `nk_` tokens, but they are
 * resolved by different resolvers, so a guard admits one without the other:
 * a kiosk's secret is not a user's token and vice versa.
 */
export const guardCredentialKinds = (guard: ApiGuard): CredentialKind[] => {
  const kinds: CredentialKind[] = [];
  if (guardAdmitsSecret(guard)) kinds.push('secret');
  if (guardAdmitsMachine(guard)) kinds.push('machine');
  if (guardAdmitsAgentKey(guard)) kinds.push('agent_key');
  return kinds;
};

/**
 * Whether a guard admits a physical machine's credential.
 *
 * The machine secret travels in the request rather than in a session, so the
 * guard verifies what it can (that the credential belongs to an activated
 * machine) and the handler verifies the binding to a shop.
 */
export const guardAdmitsMachine = (guard: ApiGuard): boolean =>
  guard === 'machine' || guard === 'site_admin_or_secret_or_machine';
