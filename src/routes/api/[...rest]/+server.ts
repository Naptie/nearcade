import { base } from '$app/paths';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins';
import { ResponseHeadersPlugin } from '@orpc/server/plugins';
import type { RequestHandler } from './$types';
import { appRouter } from '$lib/api/router.server';
import { createApiContext } from '$lib/api/context';
import { API_PREFIX } from '$lib/api/mount';
import { encodeErrorBody, notFoundResponse } from '$lib/api/errors';
import { OPENAPI_DOCUMENT_OPTIONS, OPENAPI_SCHEMA_CONVERTERS } from '$lib/api/openapi';
import { API_REFERENCE_SCRIPT } from '$lib/api/reference';
import { API_DOCS_PATH } from '$lib/api/paths';

/**
 * The interactive API reference, served at `/api/docs`.
 *
 * oRPC renders the reference itself, so this repository contains no
 * hand-written markup for it. The reference is served as a document of its
 * own, which keeps the site's Tailwind build and Scalar's out of each other's
 * way.
 *
 * The page loads the published OpenAPI document — the very same file third
 * party clients download — rather than a second copy of the specification, so
 * the reference and the published contract can never disagree.
 */
const referencePlugin = new OpenAPIReferencePlugin({
  docsPath: API_DOCS_PATH,
  // The plugin appends `specPath` to the handler prefix, so the default
  // '/spec.json' would publish a *second* document at `/api/spec.json`.
  //
  // `new URL()` resolves `..` segments, so the prefix plus '/../openapi.json'
  // normalises to '/openapi.json' — the canonical path the document is served
  // from. The plugin's own spec branch therefore never matches (SvelteKit
  // routes `/openapi.json` to its own route first), and `/api/spec.json`
  // stops existing: there is exactly one published document.
  specPath: '/../openapi.json',
  docsTitle: 'nearcade API Reference',
  docsProvider: 'scalar',
  // The reference script is published into `static/` by
  // `scripts/generate-api-reference.ts`, so it is served by the CDN like any
  // other static asset instead of through a runtime route.
  docsScriptUrl: `${base}${API_REFERENCE_SCRIPT}`,
  docsHead: '<meta name="robots" content="noindex, nofollow" />',
  docsConfig: {
    // oRPC merges this configuration over the one it builds itself, so an
    // explicit `undefined` drops the copy of the specification it would
    // inline. The reference then loads the published document instead, which
    // keeps the two from ever disagreeing.
    content: undefined,
    url: `${base}/openapi.json`,
    // The default theme loads its fonts from a third-party CDN; the reference
    // is served from our own origin, so it does not need them.
    withDefaultFonts: false
  },
  schemaConverters: OPENAPI_SCHEMA_CONVERTERS,
  specGenerateOptions: OPENAPI_DOCUMENT_OPTIONS
});

/**
 * REST surface of the nearcade API.
 *
 * Every procedure that declares a route is served here at its documented path.
 */
const handler = new OpenAPIHandler(appRouter, {
  plugins: [new ResponseHeadersPlugin(), referencePlugin],
  customErrorResponseBodyEncoder: encodeErrorBody
});

const handle: RequestHandler = async (event) => {
  const { response } = await handler.handle(event.request, {
    prefix: API_PREFIX,
    context: createApiContext(event)
  });

  return response ?? notFoundResponse();
};

// No `OPTIONS`: `hooks.server.ts` answers every preflight under `/api/` before
// the request reaches a route, so an exported handler here would never run. The
// CORS policy lives in one place.
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
