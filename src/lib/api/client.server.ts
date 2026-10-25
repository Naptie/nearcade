import { createRouterClient } from '@orpc/server';
import { ORPCError } from '@orpc/client';
import { error as httpError, isRedirect } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { appRouter } from './router.server';
import { createApiContext } from './context';
import type { ApiClient } from './client';

/**
 * Server-side client.
 *
 * It calls the procedures **in-process**: there is no HTTP round trip and no
 * serialization, which is what makes it safe to use from a `load` function.
 * The request event is taken from SvelteKit's `getRequestEvent()`, so the
 * session, the request and the cookies are exactly the ones of the request
 * being served.
 *
 * Call it per request — the client is a thin proxy and holds no state.
 */

/**
 * Whether a thrown value is an oRPC error.
 *
 * `instanceof` is the direct check, but oRPC documents that it can fail when
 * the error was created in another module graph. The name check is the
 * fallback, so the translation below still happens when it does.
 */
const isApiError = (cause: unknown): cause is { status: number; message: string } =>
  cause instanceof ORPCError ||
  (typeof cause === 'object' &&
    cause !== null &&
    (cause as { constructor?: { name?: string } }).constructor?.name === 'ORPCError');

/**
 * Translate an API error into the error SvelteKit understands.
 *
 * The two layers speak different error types: the API layer raises
 * `ORPCError`, the framework speaks `HttpError`. A server load that calls a
 * procedure directly lets the error escape, and SvelteKit does not recognise
 * it — the page answers a generic 500 instead of the status the endpoint
 * would have answered over HTTP. Translating here keeps the in-process call
 * and the HTTP call saying the same thing.
 */
const asHttpError = (cause: unknown): never => {
  // A redirect is control flow, not a failure.
  if (isRedirect(cause)) throw cause;
  if (isApiError(cause)) {
    const status = cause.status;
    throw httpError(status >= 400 && status <= 599 ? status : 500, cause.message);
  }
  throw cause;
};

/** Wrap every procedure of the client so its errors leave as HTTP errors. */
const translateErrors = <T>(node: T): T =>
  new Proxy(node as object, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value === 'function') {
        return async (...args: unknown[]) => {
          try {
            return await (value as (...a: unknown[]) => unknown).apply(target, args);
          } catch (cause) {
            return asHttpError(cause);
          }
        };
      }
      if (value && typeof value === 'object') return translateErrors(value);
      return value;
    }
  }) as T;

export const createServerApiClient = (): ApiClient =>
  translateErrors(
    createRouterClient(appRouter, {
      context: createApiContext(getRequestEvent())
    })
  );
