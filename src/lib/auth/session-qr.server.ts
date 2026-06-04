/**
 * Better Auth custom plugin that verifies a short-lived QR session token
 * (stored in Redis) and creates a new cookie session for the associated user.
 *
 * The token is generated server-side on demand (see the sessions settings page)
 * and expires after 2 minutes. It is single-use: the Redis key is deleted as
 * soon as it is consumed.
 */

import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import redis, { ensureConnected } from '$lib/db/redis.server';

const QR_SESSION_TTL_SECONDS = 120; // 2 minutes
export const QR_SESSION_TTL = QR_SESSION_TTL_SECONDS;

export function redisKey(token: string) {
  return `session_qr:${token}`;
}

export interface QrSessionPayload {
  userId: string;
}

/**
 * Store a QR token → userId mapping in Redis with a 2-minute TTL.
 */
export async function storeQrToken(token: string, userId: string): Promise<void> {
  await ensureConnected();
  const payload: QrSessionPayload = { userId };
  await redis.set(redisKey(token), JSON.stringify(payload), {
    EX: QR_SESSION_TTL_SECONDS
  });
}

/**
 * Better Auth plugin that exposes POST /session-qr/verify.
 * No authentication is required – the device scanning the QR is not yet
 * logged in.
 */
export const sessionQrPlugin = {
  id: 'session-qr',
  endpoints: {
    verifyQrSession: createAuthEndpoint(
      '/session-qr/verify',
      {
        method: 'POST',
        body: z.object({
          token: z.string().min(1)
        })
      },
      async (ctx) => {
        const { token } = ctx.body;

        await ensureConnected();
        const raw = await redis.get(redisKey(token));
        if (!raw) {
          throw ctx.error('BAD_REQUEST', { message: 'Invalid or expired QR token' });
        }

        let payload: QrSessionPayload;
        try {
          payload = JSON.parse(raw) as QrSessionPayload;
        } catch {
          throw ctx.error('BAD_REQUEST', { message: 'Malformed QR token payload' });
        }

        // One-time use: delete immediately after reading.
        await redis.del(redisKey(token));

        const found = await ctx.context.internalAdapter.findUserById(payload.userId);
        if (!found) {
          throw ctx.error('BAD_REQUEST', { message: 'User not found' });
        }

        const session = await ctx.context.internalAdapter.createSession(payload.userId);
        if (!session) {
          throw ctx.error('INTERNAL_SERVER_ERROR', { message: 'Failed to create session' });
        }

        await setSessionCookie(ctx, {
          session,
          user: found
        });

        return ctx.json({ success: true });
      }
    )
  }
} as const;
