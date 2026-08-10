import { env } from '$env/dynamic/private';
import { createClient } from 'redis';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { getQbindKey, upsertVerifiedSocialLink } from '$lib/auth/social-verify.server';

// How long a pending token (and its result) stays valid in Redis.
export const QBIND_TOKEN_TTL = 600;

export const getQbindOwnerKey = (token: string) => `${getQbindKey(token)}:owner`;
export const getQbindResultKey = (token: string) => `${getQbindKey(token)}:result`;

/**
 * Registers a freshly issued qbind token against its owner so the backend can
 * complete the binding later without the user being present. The owner mapping
 * expires after `QBIND_TOKEN_TTL` seconds.
 */
export const registerQbindToken = async (token: string, userId: string) => {
  await ensureConnected();
  await redis.setEx(getQbindOwnerKey(token), QBIND_TOKEN_TTL, userId);
};

/**
 * Stores the outcome of a completed binding so the frontend can poll the
 * result instead of triggering the binding itself.
 */
export const storeQbindResult = async (token: string, qq: number) => {
  await redis.setEx(getQbindResultKey(token), QBIND_TOKEN_TTL, JSON.stringify({ qq }));
};

/**
 * Returns the stored binding result for a token, or null when the binding has
 * not been completed (or the result already expired).
 */
export const getQbindResult = async (token: string): Promise<number | null> => {
  await ensureConnected();
  const raw = await redis.get(getQbindResultKey(token));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const qq = (parsed as { qq?: unknown })?.qq;
    return typeof qq === 'number' && Number.isInteger(qq) && qq > 0 ? qq : null;
  } catch {
    return null;
  }
};

export type QbindConsumeResult =
  { status: 'success'; qq: number } | { status: 'not_found' } | { status: 'invalid' };

/**
 * Atomically claims and completes a qbind binding for a token.
 *
 * - The value key (written by the qbind bot) is claimed with GETDEL so only
 *   one consumer (the listener or a polling request) wins.
 * - The owner mapping is claimed with GETDEL; without it the binding cannot
 *   be attributed to a user and is treated as not found.
 * - On success the verified QQ social link is written and the result is
 *   stored for the frontend to poll.
 *
 * Called by the Redis keyspace listener (primary path) and by the polling
 * endpoint (fallback path when keyspace notifications are unavailable).
 */
export async function claimAndCompleteQbindToken(token: string): Promise<QbindConsumeResult> {
  await ensureConnected();

  const already = await getQbindResult(token);
  if (already) return { status: 'success', qq: already };

  const valueKey = getQbindKey(token);
  const raw = await redis.getDel(valueKey);
  if (!raw) return { status: 'not_found' };

  const ownerKey = getQbindOwnerKey(token);
  const userId = await redis.getDel(ownerKey);
  if (!userId) return { status: 'not_found' };

  const qq = parseInt(raw, 10);
  if (isNaN(qq) || qq <= 0) return { status: 'invalid' };

  await upsertVerifiedSocialLink(userId, 'qq', String(qq));
  await storeQbindResult(token, qq);
  return { status: 'success', qq };
}

export const getPrefix = () => `qbind:${env.QBIND_KEY_PREFIX?.trim() || 'nearcade'}:`;

/**
 * Listens for qbind value keys being written to Redis via keyspace
 * notifications and completes the binding in the backend, so the user does
 * not need to return to the site for the binding to happen.
 *
 * The Redis server must have keyspace notifications enabled (we attempt to
 * enable them via CONFIG SET on startup, which may be denied on managed
 * instances). If events are unavailable, the polling endpoint still
 * completes bindings as a fallback.
 */
export function startRedisListener(): void {
  const globalWithListener = globalThis as typeof globalThis & {
    _redisListenerStarted?: boolean;
  };
  if (globalWithListener._redisListenerStarted) return;
  globalWithListener._redisListenerStarted = true;

  const url = env.REDIS_URI;
  if (!url) {
    console.warn('[qbind] REDIS_URI not set; binding listener disabled');
    return;
  }

  const subscriber = createClient({
    url,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 100, 10000)
    }
  });

  let subscribed = false;

  subscriber.on('error', (err) => {
    console.error('[qbind] Listener client error:', err);
  });

  subscriber.on('reconnecting', () => {
    subscribed = false;
  });

  subscriber.on('ready', async () => {
    if (subscribed) return;

    try {
      await subscriber.configSet('notify-keyspace-events', 'K$');
    } catch (err) {
      console.warn(
        '[qbind] Could not enable Redis keyspace notifications; the polling endpoint will fall back to completing bindings directly:',
        err
      );
    }

    try {
      await subscriber.pSubscribe('__keyspace@*__:qbind:*', (message, channel) => {
        // React only to writes of the qbind value key itself (SET/SETEX);
        // ignore del/expiry events and our own owner/result keys.
        if (message !== 'set' && message !== 'setex') return;
        const key = channel.split('__:')[1] ?? '';
        if (!key.startsWith(getPrefix())) return;
        const token = key.slice(getPrefix().length);
        if (!token || token.includes(':')) return;
        claimAndCompleteQbindToken(token).catch((err) => {
          console.error(`[qbind] Failed to complete binding for token ${token}:`, err);
        });
      });
      subscribed = true;
      console.log('[qbind] Listening for qbind keyspace events');
    } catch (err) {
      console.error('[qbind] Failed to subscribe to keyspace events:', err);
    }
  });

  subscriber.connect().catch((err) => {
    console.error('[qbind] Listener connect failed:', err);
  });
}
