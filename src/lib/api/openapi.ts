import { OpenAPIGenerator } from '@orpc/openapi';
import type { ConditionalSchemaConverter, OpenAPIGeneratorGenerateOptions } from '@orpc/openapi';
// The `/zod4` subpath is mandatory: `@orpc/zod`'s default export targets Zod 3
// and would reject every schema in this repository (which is on Zod 4).
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { globalRegistry } from 'zod/v4/core';
import pkg from '../../../package.json' with { type: 'json' };
import { getApiMeta } from './contract';
import { contractRouter } from './contracts';
import { API_MOUNT } from './paths';
import { bilingual } from '$lib/schemas/common';
import { OAUTH_SCOPES, type OAuthScope } from '$lib/auth/oauth/scopes';

/**
 * What each OAuth scope allows, as the published document says it.
 *
 * The map is typed by the catalog, so a scope that joins the catalog without a
 * description here is a **compile error** rather than a scope the document
 * silently forgets. The catalog stays the one list; this is only what the
 * document says about each entry.
 *
 * The descriptions live here rather than in the i18n messages on purpose: the
 * document is one document, and a description taken from the request's locale
 * would make the published contract depend on who asked for it.
 */
const OAUTH_SCOPE_DESCRIPTIONS: Record<OAuthScope, string> = {
  openid: 'OpenID Connect — user identifier',
  profile: 'User profile (name, picture)',
  email: 'User email address',
  offline_access: 'Refresh token for long-lived access',
  'read:account': 'Read your own account',
  'read:notifications': 'Read your notifications',
  'write:account': 'Update your own account (avatar, preferences, read state)',
  'write:notifications': 'Mark notifications read, manage your FCM device token',
  'write:posts': 'Create, edit, delete or vote on posts',
  'write:comments': 'Create, edit, delete or vote on comments',
  'write:images': 'Upload or delete image assets',
  'write:clubs': 'Modify a club',
  'write:universities': 'Modify a university',
  'write:shops': 'Create or modify arcade data, photos and changelog',
  'write:attendance': 'Register or end your own attendance at an arcade',
  'write:reports': 'Report the live attendance counts of an arcade',
  'write:moderation': 'Submit, retract or vote on arcade deletion requests'
};

/**
 * The OpenAPI version nearcade publishes.
 *
 * oRPC generates OpenAPI 3.1.1 natively, and that is what is published: the
 * document keeps every construct the generator produces — the GeoJSON
 * `coordinates` tuple is described with `prefixItems` and its longitude and
 * latitude bounds, instead of the empty `items` schema a downgrade to 3.0.0
 * would leave behind.
 *
 * Every consumer of the document supports 3.1: Apifox imports 3.0, 3.1 and
 * Swagger 2.0, and the interactive reference is rendered by Scalar, which
 * treats 3.1 as a first-class version.
 *
 * The version is the generator's to say, not this file's: the document takes
 * what oRPC emitted and the check below asserts that it is still the version
 * this codebase is written against. A generator that moves on would fail the
 * build here instead of silently mislabelling the document.
 */
export const OPENAPI_VERSION = '3.1.1';

/**
 * The schema converters that describe the API.
 *
 * Shared by the published document and the API reference so both describe the
 * API in exactly the same way.
 */
export const OPENAPI_SCHEMA_CONVERTERS: ConditionalSchemaConverter[] = [
  new ZodToJsonSchemaConverter({
    /**
     * Apply the `override` a schema carries in its Zod registry.
     *
     * A schema may describe the JSON shape it wants to be *documented* as
     * with `.meta({ override })` — `zod-openapi` honoured that, the oRPC Zod
     * 4 converter does not. Without this, `?page=` would be documented as
     * "string or number" instead of the integer it is coerced to.
     */
    interceptors: [
      (options) => {
        const meta = globalRegistry.get(options.schema as never) as
          { override?: (context: unknown) => void } | undefined;
        const override = meta?.override;

        if (typeof override !== 'function') {
          return options.next(options);
        }

        const [required, jsonSchema] = options.next(options);
        const mutable = jsonSchema as Record<string, unknown>;

        override({
          zodSchema: options.schema,
          jsonSchema: mutable,
          path: [],
          io: options.options.strategy === 'input' ? 'input' : 'output'
        });

        return [required, mutable];
      }
    ]
  })
];

/**
 * The document options of the published specification.
 *
 * The tier filter is the single place that decides what is published, so a
 * procedure cannot leak into the public document by accident.
 */
export const OPENAPI_DOCUMENT_OPTIONS: OpenAPIGeneratorGenerateOptions = {
  filter: ({ contract }: { contract: unknown }) => getApiMeta(contract).tier === 'public',
  // The runtime error body is `{ error, message }` (see `encodeErrorBody`),
  // so the specification has to describe exactly that.
  customErrorResponseBodySchema: {
    type: 'object',
    properties: {
      error: { type: 'string', description: 'Machine-readable error code.' },
      message: { type: 'string', description: 'Human-readable explanation.' }
    },
    required: ['error', 'message'],
    additionalProperties: false
  },
  info: {
    title: 'nearcade API',
    version: pkg.version,
    description: 'OpenAPI documentation for the nearcade API.'
  },
  // Overwritten by the `/openapi.json` route with `${base}${API_MOUNT}`. This
  // module is deliberately free of `$app/*` imports — `scripts/check-api-contract.ts`
  // loads it through tsx, outside the Vite pipeline, where `$app/paths` does
  // not resolve — so the value that depends on `base` is supplied by the one
  // caller that can read it.
  servers: [{ url: API_MOUNT, description: 'API base URL' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: bilingual(
          '一个 `nk_` 开头的 API 令牌：机台的 API 密钥，或用户在「设置 → API 令牌」中自行生成的令牌。以 `Authorization: Bearer <令牌>` 发送。',
          "An `nk_` API token: a machine's API secret, or a token the user minted in their own API-token settings. Sent as `Authorization: Bearer <token>`."
        )
      },
      // The first-party session cookie. The server issues it as
      // `__Secure-better-auth.session_token` when it is served over HTTPS (or
      // in production), and accepts that form as well as the plain one — so the
      // name published here is the one a client may always send.
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'better-auth.session_token',
        description: bilingual(
          '第一方会话 Cookie。HTTPS（或生产环境）下服务端签发的名称带 `__Secure-` 前缀，但两种写法都接受。',
          'The first-party session cookie of a signed-in user. Over HTTPS (or in production) the server issues it with a `__Secure-` prefix, and accepts that form as well as the plain one.'
        )
      },
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: `${API_MOUNT}/auth/oauth2/authorize`,
            tokenUrl: `${API_MOUNT}/auth/oauth2/token`,
            // The key set is the catalog itself, so the document cannot
            // advertise a scope the provider does not offer — or miss one.
            scopes: Object.fromEntries(
              OAUTH_SCOPES.map((scope) => [scope, OAUTH_SCOPE_DESCRIPTIONS[scope]])
            )
          }
        }
      }
    }
  }
};

/**
 * Build the OpenAPI document for the published (public tier) procedures.
 *
 * @param baseUrl — the absolute path the REST surface is mounted on, including
 *                 `paths.base`. It becomes `servers[0].url`, so a deployment
 *                 served under a path prefix advertises the prefix instead of
 *                 pointing generated clients at the bare origin.
 */
export const generateOpenApiDocument = async (
  baseUrl = OPENAPI_DOCUMENT_OPTIONS.servers![0].url
) => {
  const generator = new OpenAPIGenerator({ schemaConverters: OPENAPI_SCHEMA_CONVERTERS });

  const document = (await generator.generate(
    contractRouter as never,
    OPENAPI_DOCUMENT_OPTIONS
  )) as Record<string, unknown>;

  // The version is the generator's to say. The check below states the
  // expectation the codebase is written against, so a generator that moves on
  // fails here instead of the document being mislabelled.
  if (document.openapi !== OPENAPI_VERSION) {
    throw new Error(
      `oRPC now emits OpenAPI ${String(document.openapi)}; the published document is written against ${OPENAPI_VERSION}.`
    );
  }

  document.servers = [{ url: baseUrl, description: 'API base URL' }];

  return document;
};
