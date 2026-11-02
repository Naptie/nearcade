import redis, { ensureConnected } from '$lib/db/redis.server';
import { getClientIp } from '$lib/utils/ip.server';
import { apiError } from '$lib/api/errors';
import type { AnyMiddleware } from './types.server';

/**
 * Tiered, fixed-window rate limiting for quota-bearing procedures.
 *
 * The tiers answer the only distinction this limiter draws: an anonymous
 * caller is limited by client IP, a signed-in caller — a session cookie or an
 * `nk_` API key, both resolved into `context.user` by the hooks — is limited
 * by user id at a higher ceiling. Whether a caller is *admitted* is the
 * guard's question (`enforceAuthGuard`); how *often* is this one's, so the
 * geo surface stays open to the anonymous visitors it is an essential service
 * for while a bot presenting its API key simply gets more headroom.
 *
 * The table below is the single source of truth: one row per rate-limited
 * contract-path prefix, matched against the procedure's own route path (not
 * the URL, which differs between the REST and RPC surfaces). A procedure is
 * limited exactly when its path matches a row — adding a procedure under a
 * covered prefix opts it in automatically, and tuning a ceiling is a one-place
 * edit.
 *
 * Counters live in Redis (`INCR` + `EXPIRE`, same idiom as the SMS cooldown)
 * and the limiter fails open: an unavailable store must never take the API
 * down with it.
 */

const WINDOW_SECONDS = 60;

const RATE_LIMIT_TABLE = [
  {
    /** Contract-path prefix the rule covers. */
    prefix: '/geo',
    /** Anonymous ceiling, requests per window. */
    anonymous: 30,
    /** Authenticated (session or `nk_` key) ceiling, requests per window. */
    authenticated: 120
  }
] as const;

const counterKey = (prefix: string, identity: string, window: number): string =>
  `nearcade:rate-limit:${prefix}:${identity}:${window}`;

export const enforceRateLimit: AnyMiddleware = async ({ context, procedure, next }) => {
  const path = (procedure as { '~orpc'?: { route?: { path?: string } } })?.['~orpc']?.route?.path;
  const rule = path
    ? RATE_LIMIT_TABLE.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`))
    : undefined;
  if (!rule) return next({ context });

  const user = context.user;
  const limit = user ? rule.authenticated : rule.anonymous;
  const identity = user ? `user:${user.id}` : `ip:${getClientIp(context.event)}`;
  const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const resetAt = (window + 1) * WINDOW_SECONDS;

  try {
    await ensureConnected();
    const key = counterKey(rule.prefix, identity, window);
    const count = await redis.incr(key);
    if (count === 1) {
      // Outlive the window so a counter is never re-counted into a later one.
      await redis.expire(key, WINDOW_SECONDS * 2);
    }

    context.resHeaders?.set('X-RateLimit-Limit', String(limit));
    context.resHeaders?.set('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
    context.resHeaders?.set('X-RateLimit-Reset', String(resetAt));

    if (count > limit) {
      const retryAfter = Math.max(1, resetAt - Math.floor(Date.now() / 1000));
      context.resHeaders?.set('Retry-After', String(retryAfter));
      apiError('TOO_MANY_REQUESTS');
    }
  } catch (cause) {
    console.warn('[rate-limit] limiter unavailable; allowing request:', cause);
  }

  return next({ context });
};
