import { implement } from '@orpc/server';
import { env } from '$env/dynamic/private';
import { redirectContract } from '../contracts/redirect';
import type { ApiContext } from '../context';
import { apiError } from '../errors';

const impl = implement(redirectContract).$context<ApiContext>();

/**
 * The origins a redirect may point at.
 *
 * The comparison is on the parsed origin, never on a prefix of the raw string:
 * a prefix match would let `https://nearcade.cn.evil.com` through an allow
 * list that contains `https://nearcade.cn`.
 */
const allowedOrigins = (): Set<string> =>
  new Set(
    (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => {
        try {
          return new URL(origin).origin;
        } catch {
          // An entry that is not a URL cannot match anything; dropping it
          // keeps a misconfigured allow list from widening the check.
          return '';
        }
      })
      .filter(Boolean)
  );

export const redirectImplementation = {
  toAllowedOrigin: impl.toAllowedOrigin.handler(async ({ input, context }) => {
    const uriParam = input.uri?.trim();
    if (!uriParam) {
      apiError('BAD_REQUEST', 'Missing uri parameter');
    }

    let target: URL;
    try {
      target = new URL(uriParam);
    } catch {
      apiError('BAD_REQUEST', 'Invalid redirect URI');
    }

    if (!allowedOrigins().has(target.origin)) {
      apiError('BAD_REQUEST', 'Invalid redirect URI');
    }

    // The query of the *request* is carried over to the target, so the
    // parameters survive the redirect. A target that already carries a query
    // keeps it; the two are merged rather than concatenated.
    const forwarded = new URLSearchParams(context.event.url.searchParams);
    forwarded.delete('uri');

    for (const [key, value] of forwarded) {
      if (!target.searchParams.has(key)) {
        target.searchParams.append(key, value);
      }
    }

    // A 302 carries no body, so the response is described by the detailed
    // output structure: a status, the `Location` header and no body.
    return { status: 302, headers: { location: target.toString() } };
  })
};
