import { implement } from '@orpc/server';
import { env } from '$env/dynamic/private';
import { redirectContract } from '../contracts/redirect';
import type { ApiContext } from '../context';
import { apiError } from '../errors';

const impl = implement(redirectContract).$context<ApiContext>();

export const redirectImplementation = {
  toAllowedOrigin: impl.toAllowedOrigin.handler(async ({ input, context }) => {
    const uriParam = input.uri?.trim();
    if (!uriParam) {
      apiError('BAD_REQUEST', 'Missing uri parameter');
    }

    const allowedOrigins = env.ALLOWED_ORIGINS?.split(',').map((u) => u.trim()) || [];
    if (
      !allowedOrigins.some((allowed) => uriParam.toLowerCase().startsWith(allowed.toLowerCase()))
    ) {
      apiError('BAD_REQUEST', 'Invalid redirect URI');
    }

    const searchParams = new URLSearchParams(context.event.url.searchParams);
    searchParams.delete('uri');
    const uri = new URL(uriParam + '?' + searchParams.toString());

    // The legacy handler answered with a 302 redirect, so the response is
    // described by the detailed output structure: a status, the `Location`
    // header and no body.
    return { status: 302, headers: { location: uri.toString() } };
  })
};
