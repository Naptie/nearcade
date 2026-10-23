import { ORPCError } from '@orpc/client';
import { isHttpError } from '@sveltejs/kit';
import { API_ERROR_CODE_BY_STATUS } from '$lib/api/errors';
import type { AnyMiddleware } from './types';

const messageOf = (body: unknown): string | undefined => {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return undefined;
};

/**
 * Preserve the status of a SvelteKit `error()` raised by a shared helper.
 *
 * Plenty of helpers in `src/lib/**` still signal failure with SvelteKit's
 * `error(502, '…')`. oRPC converts any error that is not an `ORPCError` into
 * a generic 500, which would silently change the status codes of the migrated
 * endpoints. This middleware re-throws them with their original status, so the
 * HTTP contract of every endpoint is preserved.
 */
export const preserveHttpErrorStatus: AnyMiddleware = async ({ context, next }) => {
  try {
    return await next({ context });
  } catch (cause) {
    if (isHttpError(cause)) {
      throw new ORPCError(API_ERROR_CODE_BY_STATUS[cause.status] ?? 'INTERNAL_SERVER_ERROR', {
        status: cause.status,
        message: messageOf(cause.body) ?? 'Request failed'
      });
    }
    throw cause;
  }
};
