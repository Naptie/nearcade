import redis, { ensureConnected } from '$lib/db/redis.server';

const KEY_PREFIX = 'nearcade:oauth-profile:';
const TTL_SECONDS = 60;

export async function cacheOAuthProfile(
  providerId: string,
  accountId: string,
  data: { email: string; image?: string }
) {
  await ensureConnected();
  await redis.setEx(`${KEY_PREFIX}${providerId}:${accountId}`, TTL_SECONDS, JSON.stringify(data));
}

export async function getCachedOAuthProfile(providerId: string, accountId: string) {
  await ensureConnected();
  const raw = await redis.get(`${KEY_PREFIX}${providerId}:${accountId}`);
  if (!raw) return null;
  return JSON.parse(raw) as { email: string; image?: string };
}
