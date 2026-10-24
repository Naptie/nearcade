import { ORPCError } from '@orpc/client';

/**
 * Whether a caught value is an API error.
 *
 * The typed oRPC client throws an `ORPCError` instead of returning a `Response`,
 * so the legacy `if (!response.ok)` branches become a `try`/`catch` and read
 * the failure from the caught value. Anything else (a network failure, a
 * `TypeError` from `fetch`) is not an API error.
 */
export const isApiError = (error: unknown): error is ORPCError<string, unknown> =>
  error instanceof ORPCError;

/**
 * The message of a failed API call.
 *
 * It replaces the legacy `const data = await response.json(); data.message`
 * read: the server message the endpoint answered with, or the caller's own
 * fallback when the failure was not an API error.
 */
export const apiErrorMessage = (error: unknown, fallback: string): string =>
  isApiError(error) && error.message ? error.message : fallback;
