import { RPCHandler } from '@orpc/server/fetch';
import { ResponseHeadersPlugin } from '@orpc/server/plugins';
import type { RequestHandler } from './$types';
import { appRouter } from '$lib/api/router';
import { createApiContext } from '$lib/api/context';
import { RPC_PREFIX } from '$lib/api/mount';
import { notFoundResponse } from '$lib/api/errors';

/**
 * Typed RPC surface of the nearcade API.
 *
 * This is the surface the first-party client talks to: every procedure —
 * public or private — is callable here with full type information.
 *
 * Error bodies deliberately differ from the REST surface. `/api` speaks the
 * documented HTTP envelope (`{ error, message }`, see `encodeErrorBody`), while
 * this surface speaks oRPC's RPC protocol error structure, because that is what
 * `RPCLink` parses on the client. Forcing the HTTP envelope here would not make
 * the two surfaces agree — it would break the typed client's error handling,
 * which reads the protocol shape. Third-party clients are pointed at `/api`;
 * the typed client is pointed here.
 */
const handler = new RPCHandler(appRouter, {
  plugins: [new ResponseHeadersPlugin()]
});

const handle: RequestHandler = async (event) => {
  const { response } = await handler.handle(event.request, {
    prefix: RPC_PREFIX,
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
