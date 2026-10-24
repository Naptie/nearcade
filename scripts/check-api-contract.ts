/// <reference types="node" />

/**
 * CI guard for the oRPC API layer.
 *
 * Fails the build when any of the invariants of the migration are broken:
 *
 *  1. Every procedure in the contract router declares a route.
 *  2. No procedure under the `admin`, `invites` or `machines` subtree is
 *     published (the public/private split must never leak an internal
 *     endpoint into the OpenAPI document).
 *  3. Every procedure declares the OAuth scope the resolver hands out for its
 *     own path — so the scope an OAuth client is asked for can never differ
 *     from the scope the contract declares.
 *  4. No two procedures claim the same method + path.
 *  5. No legacy `+server.ts` handler is left behind for a path the contract
 *     router already serves.
 *  6. Every API operation a call site names exists in the contract.
 *
 * And the invariants that keep the OAuth scope system honest:
 *
 *  7. A procedure that requires no identity carries no scope. A scope on such a
 *     procedure could only ever subtract access from a token holder, so a
 *     credential would be worse than no credential — the inversion this system
 *     was rebuilt to remove.
 *  8. Every scope in the advertised catalog is claimed by at least one
 *     procedure. A scope no endpoint asks for is a consent the user gives for
 *     nothing.
 *  9. Every procedure's scope is in the advertised catalog. A scope the
 *     provider does not advertise can never be granted, so the procedure would
 *     be unreachable for every third-party client.
 * 10. The published document's security requirement matches the procedure's
 *     guard and scope: anonymous is offered exactly where the guard admits it,
 *     and the OAuth scheme names exactly the scope the procedure demands.
 *
 * And the invariants that keep a guard and the handler it guards in step:
 *
 * 11. Every credential a handler accepts is admitted by the procedure's guard.
 *     The guard runs before the handler, so a guard that rejects a credential
 *     the handler would have accepted is a silent outage: the caller is turned
 *     away before the code that knows how to serve it ever runs.
 * 12. Every contract path is matched by the route index for the request shape
 *     the router serves. A path the router serves but the index does not match
 *     would be answered "closed" by the index while the router serves it — so
 *     an OAuth token would be refused where an anonymous caller succeeds.
 *
 * Every invariant here reads only tracked files, so the check runs identically
 * in CI and on a clean checkout.
 *
 * The one check that *cannot* live here is parity with the pre-refactor API:
 * it compares the published document against a baseline that describes the old
 * implementation, and that baseline is a migration artifact rather than a
 * build input. It stays in the migration workspace, beside the baseline, and
 * is run there while the migration is in flight.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveContractScope, matchContractRoute } from '../src/lib/api/routes';
import { API_MOUNT } from '../src/lib/api/paths';
import {
  getApiMeta,
  guardCredentialKinds,
  type ApiGuard,
  type CredentialKind
} from '../src/lib/api/contract';
import { contractRouter } from '../src/lib/api/contracts';
import { OAUTH_SCOPES, OIDC_SCOPES } from '../src/lib/auth/oauth/scopes';
import { generateOpenApiDocument } from '../src/lib/api/openapi';

const root = process.cwd();
const apiRoutesRoot = path.join(root, 'src', 'routes', 'api');

type ProcedureInfo = {
  path: string[];
  method: string;
  routePath: string;
  operationId: string;
  tier: string;
  scope: string | null;
  guard: string;
  credentials: CredentialKind[];
  deprecated: boolean;
};

const collect = (value: unknown, pathSoFar: string[] = []): ProcedureInfo[] => {
  if (!value || typeof value !== 'object') return [];

  const candidate = value as {
    '~orpc'?: { route?: { method?: string; path?: string; operationId?: string } };
  };
  const route = candidate['~orpc']?.route;

  if (route?.path && route?.method) {
    const meta = getApiMeta(value);
    return [
      {
        path: pathSoFar,
        method: route.method.toUpperCase(),
        routePath: route.path,
        operationId: route.operationId ?? '',
        tier: meta.tier,
        scope: meta.scope,
        guard: meta.guard,
        credentials: meta.credentials,
        deprecated: meta.deprecated
      }
    ];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collect(child, [...pathSoFar, key])
  );
};

const procedures = collect(contractRouter);
const failures: string[] = [];
const warnings: string[] = [];

// ── 1. every procedure declares a route ─────────────────────────────────────

for (const procedure of procedures) {
  if (!procedure.routePath) {
    failures.push(`Procedure "${procedure.path.join('.')}" does not declare a route.`);
  }
}

// ── 2. the private surfaces are never published ────────────────────────────
//
// The admin API and the invite system are internal: they are served, but they
// must never appear in the published document, and third-party OAuth clients
// must never reach them.
//
// The machine activation is internal too: it hands out a machine's secret to
// whoever presents the serial number printed on the device, which is not a
// surface a third-party client is meant to build on.
//
// The geo surface is the map's own plumbing — resolving a place, translating
// a coordinate, serving a basemap style, searching for a point of interest.
// A commercial map provider offers every one of those as a documented
// product, so none of them belongs in nearcade's published contract.

const PRIVATE_SUBTREES = ['admin', 'invites', 'machines', 'geo'];

/**
 * Private procedures outside a wholly private subtree.
 *
 * `regions.resolve` is the one operation that resolves a coordinate, and it
 * is a map-provider capability (reverse geocoding), so it is served for the
 * first-party client but never published. The rest of the `regions` subtree —
 * the selector options and the hierarchy — is nearcade's own data and stays
 * published.
 */
const PRIVATE_OPERATIONS = ['regions.resolve'];

for (const procedure of procedures) {
  const operation = procedure.path.join('.');

  if (PRIVATE_SUBTREES.includes(procedure.path[0]) && procedure.tier !== 'private') {
    failures.push(
      `Private procedure "${operation}" is published. ` +
        `${procedure.path[0]} endpoints must stay private.`
    );
  }

  if (PRIVATE_OPERATIONS.includes(operation) && procedure.tier !== 'private') {
    failures.push(
      `Private procedure "${operation}" is published. ` + `${operation} must stay private.`
    );
  }
}

// ── 3. the declared scope is the scope the resolver hands out ──────────────

for (const procedure of procedures) {
  // `/shops/{id}` -> `/api/shops/sample`, the shape a request actually has.
  const requestPath = API_MOUNT + procedure.routePath.replace(/\{[^}]+\}/g, 'sample');
  const resolved = resolveContractScope(requestPath, procedure.method);
  const resolvedScope =
    resolved.kind === 'closed' ? null : resolved.kind === 'open' ? 'open' : resolved.scope;

  if (resolvedScope !== procedure.scope) {
    failures.push(
      `Scope mismatch for ${procedure.method} ${procedure.routePath}: ` +
        `declared "${procedure.scope ?? 'null'}", the resolver says "${resolvedScope ?? 'null'}".`
    );
  }
}

// ── 4. no duplicate method + path ──────────────────────────────────────────

const seen = new Map<string, string>();
for (const procedure of procedures) {
  const key = `${procedure.method} ${procedure.routePath}`;
  const owner = seen.get(key);
  if (owner) {
    failures.push(`Duplicate route ${key}: "${owner}" and "${procedure.path.join('.')}".`);
  } else {
    seen.set(key, procedure.path.join('.'));
  }
}

// ── 5. no legacy handler is left behind for a migrated path ─────────────────

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(entryPath);
      return entry.name === '+server.ts' ? [entryPath] : [];
    })
  );
  return files.flat();
};

const legacyHandlers = await walk(apiRoutesRoot);
const contractPaths = new Set(procedures.map((procedure) => procedure.routePath));

for (const handler of legacyHandlers) {
  const relative = path.relative(apiRoutesRoot, path.dirname(handler));

  // A legacy SvelteKit route parameter is either a single segment (`[id]`) or
  // a rest parameter (`[...ids]`). The contract writes the rest parameter as a
  // splat (`{+ids}`), so both spellings are tried — otherwise a legacy
  // handler for a splat route could never be matched, and the check would
  // pass without ever looking.
  const candidates = new Set<string>();
  for (const splat of [false, true]) {
    const segments = relative.split(path.sep).map((segment) => {
      const rest = /^\[\.\.\.(.+)\]$/.exec(segment);
      if (rest) return splat ? `{+${rest[1]}}` : `{${rest[1]}}`;
      const single = /^\[(.+)\]$/.exec(segment);
      if (single) return `{${single[1]}}`;
      return segment;
    });
    candidates.add('/' + segments.filter(Boolean).join('/'));
  }

  for (const candidate of candidates) {
    if (contractPaths.has(candidate)) {
      failures.push(
        `Legacy handler "${path.relative(root, handler)}" is still present but ` +
          `"${candidate}" is served by the oRPC router. Remove the legacy handler.`
      );
      break;
    }
  }
}

// ── 6. every operation id a call site names exists ─────────────────────────
//
// The URL builders take the `operationId` of a procedure and look its path up
// in the contract. The path can therefore never drift, but a mistyped id
// would only fail when the URL is first built — so every id the application
// names is checked here against the contract.

const srcRoot = path.join(root, 'src');
const operationIds = new Set(procedures.map((procedure) => procedure.operationId).filter(Boolean));

const sourceFiles: string[] = [];
const collectSources = async (dir: string): Promise<void> => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSources(entryPath);
    } else if (/\.(ts|svelte)$/.test(entry.name)) {
      sourceFiles.push(entryPath);
    }
  }
};
await collectSources(srcRoot);

const CALL_SITE = /\b(?:apiUrl|procedurePath)\(\s*'([^']+)'/g;
let namedOperations = 0;

for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(CALL_SITE)) {
    namedOperations++;
    if (!operationIds.has(match[1])) {
      failures.push(
        `${path.relative(root, file)} names the API operation "${match[1]}", ` +
          `which the contract does not declare.`
      );
    }
  }
}

// ── 7. no identity, no scope ────────────────────────────────────────────────
//
// A procedure whose guard admits an anonymous caller is open to everyone. A
// scope on it could only ever *remove* access from a token holder, never grant
// any — so presenting a credential would be worse than presenting none. The
// scope of such a procedure must be `'open'`: no scope demanded.

for (const procedure of procedures) {
  // A private procedure is never published and is closed to OAuth clients by
  // construction, so the rule below does not apply to it.
  if (procedure.tier !== 'public') continue;
  if (procedure.guard !== 'none') continue;
  if (procedure.scope !== 'open') {
    failures.push(
      `${procedure.method} ${procedure.routePath} requires no identity but declares ` +
        `the scope "${procedure.scope ?? 'null'}". An open procedure must declare ` +
        `the scope 'open', otherwise a token holder has less access than an anonymous caller.`
    );
  }
}

// ── 8. every advertised scope is claimed by a procedure ─────────────────────
//
// A scope no procedure asks for is a consent the user gives for nothing: it
// shows up on the consent screen and in the catalog, and buys no access.
//
// The OIDC scopes are exempt: they are identity scopes, and no endpoint in the
// contract demands one.

const claimedScopes = new Set(
  procedures.map((procedure) => procedure.scope).filter((scope): scope is string => !!scope)
);

const oidcScopes = new Set<string>(OIDC_SCOPES);

for (const scope of OAUTH_SCOPES) {
  if (oidcScopes.has(scope)) continue;
  if (!claimedScopes.has(scope)) {
    failures.push(
      `The advertised scope "${scope}" is not claimed by any procedure. ` +
        `Either give a procedure that scope or drop it from the catalog.`
    );
  }
}

// A scope whose only claimant is deprecated is a scope no new client can
// reach: the deprecated procedure still works, but nothing is left to adopt.

const liveClaimedScopes = new Set(
  procedures
    .filter((procedure) => !procedure.deprecated)
    .map((procedure) => procedure.scope)
    .filter((scope): scope is string => !!scope)
);

for (const scope of OAUTH_SCOPES) {
  if (oidcScopes.has(scope)) continue;
  if (claimedScopes.has(scope) && !liveClaimedScopes.has(scope)) {
    failures.push(
      `The advertised scope "${scope}" is only claimed by deprecated procedures. ` +
        `A new client would have no endpoint to use it on.`
    );
  }
}

// ── 9. every declared scope is advertised ───────────────────────────────────
//
// A scope the provider does not advertise can never be granted, so the
// procedure would be unreachable for every third-party client.

const advertisedScopes = new Set<string>(OAUTH_SCOPES);

for (const procedure of procedures) {
  const scope = procedure.scope;
  if (!scope || scope === 'open') continue;
  if (!advertisedScopes.has(scope)) {
    failures.push(
      `${procedure.method} ${procedure.routePath} declares the scope "${scope}", ` +
        `which the OAuth provider does not advertise. Add it to OAUTH_SCOPES.`
    );
  }
}

// ── 10. the published security matches the guard and the scope ──────────────
//
// The document is what a third-party integrator reads. It must not offer a way
// in that the runtime refuses, and it must not hide a way in that the runtime
// allows.
//
// - a procedure whose guard admits an anonymous caller must publish the empty
//   requirement, so anonymous is a documented way in;
// - a procedure that demands a scope must publish exactly that scope in the
//   OAuth scheme;
// - a procedure closed to OAuth clients must not publish the OAuth scheme at
//   all.

type SecurityRequirement = Record<string, string[]>;

const document = (await generateOpenApiDocument()) as {
  paths?: Record<string, Record<string, { security?: SecurityRequirement[] } | undefined>>;
  components?: {
    securitySchemes?: Record<string, unknown>;
  };
};

// ── 10a. the document names no credential that does not exist ────────────────
//
// A security requirement names a scheme. A scheme that is not declared is a
// door the reader can see and nobody can open — and the document is generated
// from the contract, so the two drifting apart means the contract and the
// document have stopped describing the same API.

const declaredSchemes = new Set(Object.keys(document.components?.securitySchemes ?? {}));

for (const procedure of procedures) {
  if (procedure.tier !== 'public') continue;

  const openApiPath = procedure.routePath.replace(/\{\+([^}]+)\}/g, '{$1}');
  const operation = document.paths?.[openApiPath]?.[procedure.method.toLowerCase()];
  const security = operation?.security ?? [];

  for (const requirement of security) {
    for (const scheme of Object.keys(requirement)) {
      if (declaredSchemes.has(scheme)) continue;
      failures.push(
        `${procedure.method} ${procedure.routePath} requires the security scheme ` +
          `"${scheme}", which the document does not declare.`
      );
    }
  }
}

// ── 10b. the shared service secret is never advertised ──────────────────────
//
// The shared secret belongs to the deployment, not to the API's consumers.
// A document that lists it as a way in tells a reader that there is a shared
// credential to ask for.

if (declaredSchemes.has('serviceKey')) {
  failures.push(
    'The published document declares the "serviceKey" scheme. The shared service ' +
      'secret is not a credential a third-party client can hold, so it must not be advertised.'
  );
}

// ── 10c. the advertised scope catalog is the catalog ────────────────────────
//
// The document tells an integrator which scopes it may ask for. If the two
// lists disagree, a client asks for a scope the provider does not offer, or
// misses one it does.

const documentScopes = Object.keys(
  (
    document.components?.securitySchemes?.oauth2 as {
      flows?: { authorizationCode?: { scopes?: Record<string, string> } };
    }
  )?.flows?.authorizationCode?.scopes ?? {}
);
const catalogScopes: string[] = [...OAUTH_SCOPES];

for (const scope of documentScopes) {
  if (catalogScopes.includes(scope)) continue;
  failures.push(
    `The published document advertises the scope "${scope}", which is not in the catalog.`
  );
}
for (const scope of catalogScopes) {
  if (documentScopes.includes(scope)) continue;
  failures.push(
    `The catalog offers the scope "${scope}", but the published document does not advertise it.`
  );
}

for (const procedure of procedures) {
  if (procedure.tier !== 'public') continue;

  // The document's paths are relative to the server URL, which already
  // carries the `/api` mount. The generator normalises a splat parameter
  // (`{+ids}`) to a plain one (`{ids}`).
  const openApiPath = procedure.routePath.replace(/\{\+([^}]+)\}/g, '{$1}');
  const operation = document.paths?.[openApiPath]?.[procedure.method.toLowerCase()];
  if (!operation) {
    failures.push(
      `${procedure.method} ${procedure.routePath} is published but is missing from the OpenAPI document.`
    );
    continue;
  }

  const security = operation.security ?? [];
  const allowsAnonymous = security.some((requirement) => Object.keys(requirement).length === 0);
  const oauthRequirement = security.find((requirement) => 'oauth2' in requirement);
  const oauthScopes = oauthRequirement?.oauth2;

  if (procedure.guard === 'none' && !allowsAnonymous) {
    failures.push(
      `${procedure.method} ${procedure.routePath} admits anonymous callers but the OpenAPI ` +
        `document does not offer the anonymous way in.`
    );
  }

  if (procedure.guard !== 'none' && allowsAnonymous) {
    failures.push(
      `${procedure.method} ${procedure.routePath} requires an identity but the OpenAPI ` +
        `document offers the anonymous way in.`
    );
  }

  if (procedure.scope === null) {
    if (oauthRequirement) {
      failures.push(
        `${procedure.method} ${procedure.routePath} is closed to OAuth clients but the ` +
          `OpenAPI document still offers the OAuth scheme.`
      );
    }
  } else if (procedure.scope !== 'open') {
    if (!oauthScopes || oauthScopes.length !== 1 || oauthScopes[0] !== procedure.scope) {
      failures.push(
        `${procedure.method} ${procedure.routePath} demands the scope "${procedure.scope}" ` +
          `but the OpenAPI document publishes ${JSON.stringify(oauthScopes ?? [])}.`
      );
    }
  }
}

// ── 11. every credential a handler accepts is admitted by the guard ─────────
//
// The guard runs before the handler, so a guard that refuses a credential the
// handler would have accepted is a silent outage: the caller is turned away
// before the code that knows how to serve it ever runs.
//
// The credentials come from the **contract**, which declares them
// (`credentials: [...]` on the route). That is the declaration of record: it
// survives a rename of the resolver, and it sees a credential that is resolved
// by a middleware or a shared helper rather than by the handler body — the
// shared secret is resolved by a middleware, and the agent key by a helper
// two procedures share, so a scan of the handler bodies alone finds neither
// reliably.
//
// The implementation is still scanned, but only for the resolver itself: a
// signal that stops matching everywhere means the check has gone blind, and
// that is exactly the moment it has to keep working.

const CREDENTIAL_SIGNALS: { kind: CredentialKind; pattern: RegExp; label: string }[] = [
  { kind: 'secret', pattern: /SSC_SECRET/, label: 'the shared service secret' },
  {
    kind: 'machine',
    pattern: /validateMachineAuth|findMachineByApiSecret/,
    label: 'a machine credential'
  },
  { kind: 'agent_key', pattern: /verifyApiKey/, label: 'an agent API key' }
];

/** The credential kinds a guard admits. */
const guardKinds = (guard: string): CredentialKind[] => guardCredentialKinds(guard as ApiGuard);

const implementationRoot = path.join(root, 'src', 'lib', 'api', 'implementations');

/**
 * Every implementation source, so a credential resolver is seen wherever it
 * lives — in a handler, in a middleware or in a helper two procedures share.
 */
const readImplementationSources = async (): Promise<string[]> => {
  const sources: string[] = [];

  const readModule = async (entryPath: string): Promise<void> => {
    sources.push(await readFile(entryPath, 'utf8'));
  };

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (entry.name.endsWith('.ts') && entry.name !== 'shared.ts' && entry.name !== 'index.ts') {
        await readModule(entryPath);
      }
    }
  };

  const entries = await readdir(implementationRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await walk(path.join(implementationRoot, entry.name));
    } else if (entry.name.endsWith('.ts')) {
      await readModule(path.join(implementationRoot, entry.name));
    }
  }

  return sources;
};

const implementationSources = await readImplementationSources();

for (const procedure of procedures) {
  // The contract declares the credentials the operation resolves; the guard
  // admits what it lets in. The two have to agree exactly.
  const admitted = guardKinds(procedure.guard);

  for (const kind of procedure.credentials) {
    if (admitted.includes(kind)) continue;
    failures.push(
      `${procedure.method} ${procedure.routePath} declares the credential "${kind}" but its ` +
        `guard "${procedure.guard}" refuses it — the guard runs first, so the caller is ` +
        `turned away before the handler can serve it.`
    );
  }

  for (const kind of admitted) {
    if (procedure.credentials.includes(kind)) continue;
    failures.push(
      `${procedure.method} ${procedure.routePath} has a guard that admits "${kind}" but the ` +
        `contract does not declare it — declare it on the route.`
    );
  }
}

// A signal that matches nothing anywhere means the check has gone blind: the
// resolver it looks for was renamed or moved, and every check it would have
// made is now a silent pass.
for (const signal of CREDENTIAL_SIGNALS) {
  const anywhere = implementationSources.some((source) => signal.pattern.test(source));
  if (anywhere) continue;

  const declaredSomewhere = procedures.some((procedure) =>
    procedure.credentials.includes(signal.kind)
  );
  if (!declaredSomewhere) continue;

  failures.push(
    `No handler resolves ${signal.label} any more, so the check that watches it has ` +
      `gone blind. The resolver was probably renamed — update the signal.`
  );
}

// ── 12. every contract path is matched by the route index ───────────────────
//
// The router and the route index have to agree on which requests a procedure
// answers. The index is what decides whether a request is open to an OAuth
// client, so a path the router serves but the index does not match would be
// answered "closed" by the index — an OAuth token refused where an anonymous
// caller succeeds.
//
// The sample path gives every parameter its value, and a splat parameter
// (`{+ids}`) more than one segment, because that is the shape the router
// serves it in.

const samplePathFor = (routePath: string): string =>
  `${API_MOUNT}${routePath
    .replace(/\{(\+[^/{}]*)\}/g, 'sample/deeper')
    .replace(/\{[^/{}]+\}/g, 'sample')}`;

for (const procedure of procedures) {
  const sample = samplePathFor(procedure.routePath);
  const matched = matchContractRoute(sample, procedure.method);
  if (matched === procedure.operationId) continue;

  failures.push(
    `${procedure.method} ${procedure.routePath} is served by the router, but the route ` +
      `index answers "${matched ?? 'no procedure'}" for ${sample}. The index decides ` +
      `whether an OAuth client may call it, so the two have to agree.`
  );
}

// ── report ─────────────────────────────────────────────────────────────────

const publishedCount = procedures.filter((procedure) => procedure.tier === 'public').length;

console.log(
  `Checked ${procedures.length} procedures (${publishedCount} published, ` +
    `${procedures.length - publishedCount} private) against ${legacyHandlers.length} legacy handlers, ` +
    `and ${namedOperations} named API operations.`
);

for (const warning of warnings) {
  console.warn(`warning: ${warning}`);
}

if (failures.length > 0) {
  console.error(`\nAPI contract check failed with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log('API contract check passed.');
