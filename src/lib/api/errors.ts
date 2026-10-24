import { ORPCError } from '@orpc/client';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { z } from 'zod';
import { m } from '$lib/paraglide/messages';
import { formatZodError } from '$lib/utils/validation';

/**
 * Error codes used across the nearcade API.
 *
 * The HTTP status attached to each code is the status the legacy SvelteKit
 * handlers used, so migrating a handler never changes its status code.
 */
export const API_ERRORS = {
  BAD_REQUEST: { status: 400, message: 'Bad request' },
  UNAUTHORIZED: { status: 401, message: 'Unauthorized' },
  FORBIDDEN: { status: 403, message: 'Access denied' },
  NOT_FOUND: { status: 404, message: 'Not found' },
  GONE: { status: 410, message: 'Gone' },
  CONFLICT: { status: 409, message: 'Conflict' },
  TOO_MANY_REQUESTS: { status: 429, message: 'Too many requests' },
  INTERNAL_SERVER_ERROR: { status: 500, message: 'Internal server error' },
  BAD_GATEWAY: { status: 502, message: 'Upstream service failed' }
} as const;

export type ApiErrorCode = keyof typeof API_ERRORS;

/** Error map shape accepted by `.errors()` on a contract. */
export const apiErrorMap = {
  BAD_REQUEST: { status: API_ERRORS.BAD_REQUEST.status },
  UNAUTHORIZED: { status: API_ERRORS.UNAUTHORIZED.status },
  FORBIDDEN: { status: API_ERRORS.FORBIDDEN.status },
  NOT_FOUND: { status: API_ERRORS.NOT_FOUND.status },
  GONE: { status: API_ERRORS.GONE.status },
  CONFLICT: { status: API_ERRORS.CONFLICT.status },
  TOO_MANY_REQUESTS: { status: API_ERRORS.TOO_MANY_REQUESTS.status },
  INTERNAL_SERVER_ERROR: { status: API_ERRORS.INTERNAL_SERVER_ERROR.status },
  BAD_GATEWAY: { status: API_ERRORS.BAD_GATEWAY.status }
} as const;

/**
 * HTTP status to API error code — the inverse of {@link API_ERRORS}.
 *
 * Derived rather than written out by hand, so the two can never drift: every
 * code the API can answer with maps its own status by construction, and adding
 * a code to {@link API_ERRORS} is all it takes to map the status too.
 *
 * It is deliberately *not* built from a standard HTTP table. This module ends
 * up in the browser bundle — `urls.ts` → `routes.ts` → the contract →
 * `contract.ts` → here — so `node:http`'s `STATUS_CODES` is not available, and
 * a reason phrase ("Unauthorized") is not this API's vocabulary anyway: the
 * wire vocabulary is the oRPC error code (`UNAUTHORIZED`).
 *
 * A status with no code is not an API failure: callers fall back to
 * `INTERNAL_SERVER_ERROR` while the response keeps the original status.
 * `410` and `502` are present because the API raises both on purpose — an
 * expired invite link and a failed upstream SMS provider — so they get real
 * codes instead of arriving as an `INTERNAL_SERVER_ERROR`.
 */
export const API_ERROR_CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = Object.fromEntries(
  (Object.keys(API_ERRORS) as ApiErrorCode[]).map(
    (code) => [API_ERRORS[code].status, code] as const
  )
);

/**
 * Throw an API error with an explicit status code.
 *
 * The HTTP status is always taken from the code's definition so a handler can
 * never accidentally answer with a different status than it used to.
 *
 * Declared as a function with an explicit `never` return type so TypeScript
 * treats the call as the end of the enclosing block.
 */
export function apiError<Code extends ApiErrorCode>(
  code: Code,
  message?: string,
  data?: unknown
): never {
  throw new ORPCError(code, {
    status: API_ERRORS[code].status,
    message: message ?? API_ERRORS[code].message,
    data: data as never
  });
}

/** 401 — no usable credential was presented. */
export function unauthorized(message?: string): never {
  apiError('UNAUTHORIZED', message ?? m.unauthorized());
}
/** 403 — the credential is valid but not allowed to perform the action. */
export function forbidden(message?: string): never {
  apiError('FORBIDDEN', message ?? m.access_denied());
}
/** 410 — the addressed resource existed and is permanently gone. */
export function gone(message?: string): never {
  apiError('GONE', message);
}
/** 502 — an upstream service the endpoint depends on failed. */
export function badGateway(message?: string): never {
  apiError('BAD_GATEWAY', message);
}

/**
 * Shape every error response body.
 *
 * The legacy handlers answered with SvelteKit's HTML error page; the OpenAPI
 * sidecars already declared a `{ error?, message? }` envelope. This encoder
 * makes the API actually return the documented envelope.
 */
export const encodeErrorBody = (error: ORPCError<string, unknown>) => ({
  error: error.code,
  message: error.message
});

/**
 * The answer to a request no procedure serves.
 *
 * Both surfaces need it — the REST handler and the typed RPC handler — and it
 * has to look the same on both, so it is written once here. It is the same
 * envelope as every other failure, so it delegates rather than restating it.
 */
export const notFoundResponse = (): Response => errorResponse(404);

/**
 * The same envelope, as a `Response` — for the failures the router never sees.
 *
 * A credential failure raised in a `handle` hook (`src/hooks.server.ts`) is
 * thrown before the oRPC router runs, so `encodeErrorBody` cannot shape it and
 * SvelteKit falls back to its HTML error page. The hook answers with this
 * instead, so an API caller gets the documented `{ error, message }` envelope
 * whether the failure came from a procedure or from authentication.
 */
export const errorResponse = (status: number, message?: string): Response => {
  const code = API_ERROR_CODE_BY_STATUS[status] ?? 'INTERNAL_SERVER_ERROR';
  return new Response(
    JSON.stringify({ error: code, message: message ?? API_ERRORS[code].message }),
    {
      status,
      headers: { 'content-type': 'application/json' }
    }
  );
};

/**
 * Re-throw a failure from a `catch` block.
 *
 * An `ORPCError` carries the status the endpoint is supposed to answer with, so
 * it must never be swallowed and replaced by a generic 500. A SvelteKit
 * `HttpError` keeps its status too — the shared `preserveHttpErrorStatus`
 * middleware converts it. A redirect is control flow, not a failure. Anything
 * else is an unexpected failure and becomes a 500.
 *
 * Declared as a function with an explicit `never` return type so TypeScript
 * treats the call as the end of the enclosing block.
 */
export function rethrowApiError(cause: unknown, message?: string): never {
  if (cause instanceof ORPCError) throw cause;
  if (isRedirect(cause)) throw cause;
  if (isHttpError(cause)) throw cause;

  const text = message ?? m.internal_server_error();
  console.error(`[api] ${text}`, cause);
  apiError('INTERNAL_SERVER_ERROR', text);
}

/**
 * Parse a value with a schema, answering 400 when it does not fit.
 *
 * The API counterpart of `parseOrError` in `$lib/utils/validation.server`: that
 * one raises a SvelteKit `HttpError` for the page and endpoint loaders, this one
 * raises an `ORPCError` so a procedure answers in the API's own error
 * vocabulary. Implementations use this family, never the `HttpError` one.
 */
export const parseOrApiError = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown
): z.output<Schema> => {
  const result = schema.safeParse(value);
  if (!result.success) {
    apiError('BAD_REQUEST', formatZodError(result.error));
  }
  return result.data;
};

/** {@link parseOrApiError} for schemas with async refinements. */
export const parseOrApiErrorAsync = async <Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown
): Promise<z.output<Schema>> => {
  const result = await schema.safeParseAsync(value);
  if (!result.success) {
    apiError('BAD_REQUEST', formatZodError(result.error));
  }
  return result.data;
};

/**
 * Hand a response body back to the oRPC layer.
 *
 * The legacy handlers answered with `schema.parse(body)`: the schema validated
 * the body and converted its ISO timestamps into `Date`s. The oRPC output schema
 * does exactly that — it validates the *input* shape of the schema and converts
 * it into the output shape — so the handler hands back the body typed as the
 * schema's input shape. The validation itself is unchanged; it now happens in
 * the output step, where it is enforced for every procedure.
 *
 * The narrowing is a single explicit cast because a MongoDB document and a
 * parsed response are the same data at different stages of the same pipeline.
 */
export const toWire = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown
): z.input<Schema> => value as z.input<Schema>;
