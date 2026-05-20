import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { sendPhoneOtp } from '$lib/sms/index.server';
import { m } from '$lib/paraglide/messages';

const COOLDOWN_SECONDS = 60;
const DAILY_LIMIT = 5;

function dailyKey(qualifier: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `nearcade:sms:daily:${qualifier}:${date}`;
}

function cooldownKey(userId: string): string {
  return `nearcade:sms:cooldown:${userId}`;
}

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
  const session = locals.session;
  if (!session) {
    error(401, m.unauthorized());
  }

  const userId = session.user.id;
  const ip = getClientAddress();

  let body: { phoneNumber?: string; countryCode?: string };
  try {
    body = await request.json();
  } catch {
    error(400, 'Invalid request body');
  }

  const phoneNumber = body.phoneNumber?.trim();
  const countryCode = body.countryCode?.trim();

  if (!phoneNumber || !countryCode) {
    error(400, 'phoneNumber and countryCode are required');
  }

  await ensureConnected();

  // Cooldown check (per user)
  const cooldown = await redis.get(cooldownKey(userId));
  if (cooldown) {
    const ttl = await redis.ttl(cooldownKey(userId));
    error(429, JSON.stringify({ error: 'cooldown', retryAfter: ttl }));
  }

  // Daily limit check (per user)
  const userDailyKeyStr = dailyKey(`user:${userId}`);
  const userDailyCount = await redis.get(userDailyKeyStr);
  if (userDailyCount && parseInt(userDailyCount, 10) >= DAILY_LIMIT) {
    error(429, JSON.stringify({ error: 'daily_limit_exceeded' }));
  }

  // Daily limit check (per IP)
  const ipDailyKeyStr = dailyKey(`ip:${ip}`);
  const ipDailyCount = await redis.get(ipDailyKeyStr);
  if (ipDailyCount && parseInt(ipDailyCount, 10) >= DAILY_LIMIT) {
    error(429, JSON.stringify({ error: 'daily_limit_exceeded' }));
  }

  const result = await sendPhoneOtp(phoneNumber, countryCode);
  if (!result.success) {
    error(502, result.error);
  }

  // Set cooldown and increment daily counters
  await redis.set(cooldownKey(userId), '1', { EX: COOLDOWN_SECONDS });

  const secondsUntilMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCDate(midnight.getUTCDate() + 1);
    midnight.setUTCHours(0, 0, 0, 0);
    return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
  };

  const ttlUntilMidnight = secondsUntilMidnight();

  if (userDailyCount) {
    await redis.incr(userDailyKeyStr);
  } else {
    await redis.set(userDailyKeyStr, '1', { EX: ttlUntilMidnight });
  }

  if (ipDailyCount) {
    await redis.incr(ipDailyKeyStr);
  } else {
    await redis.set(ipDailyKeyStr, '1', { EX: ttlUntilMidnight });
  }

  return json({ success: true });
};
