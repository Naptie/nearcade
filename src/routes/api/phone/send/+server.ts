import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import redis, { ensureConnected } from '$lib/db/redis.server';
import mongo from '$lib/db/index.server';
import type { User } from '$lib/auth/types';
import { sendPhoneOtp } from '$lib/sms/index.server';
import { m } from '$lib/paraglide/messages';
import { env } from '$env/dynamic/private';

const COOLDOWN_SECONDS = 60;
const DAILY_LIMIT = 5;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';

type CaptchaProvider = 'turnstile' | 'hcaptcha';

function dailyKey(qualifier: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `nearcade:sms:daily:${qualifier}:${date}`;
}

function cooldownKey(userId: string): string {
  return `nearcade:sms:cooldown:${userId}`;
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Skip verification if not configured
  const resp = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, response: token, remoteip: ip })
  });
  if (!resp.ok) return false;
  const data = (await resp.json()) as { success: boolean };
  return data.success === true;
}

async function verifyHcaptcha(token: string, ip: string): Promise<boolean> {
  const secret = env.HCAPTCHA_SECRET_KEY;
  if (!secret) return true;

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: ip,
    ...(env.HCAPTCHA_SITE_KEY ? { sitekey: env.HCAPTCHA_SITE_KEY } : {})
  });

  const resp = await fetch(HCAPTCHA_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!resp.ok) return false;
  const data = (await resp.json()) as { success: boolean };
  return data.success === true;
}

function getConfiguredCaptchaProviders(): CaptchaProvider[] {
  const providers: CaptchaProvider[] = [];

  if (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) {
    providers.push('turnstile');
  }

  if (env.HCAPTCHA_SITE_KEY && env.HCAPTCHA_SECRET_KEY) {
    providers.push('hcaptcha');
  }

  return providers;
}

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
  const session = locals.session;
  if (!session) {
    error(401, m.unauthorized());
  }

  const userId = session.user.id;
  const ip = getClientAddress();

  let body: {
    phoneNumber?: string;
    countryCode?: string;
    captchaProvider?: string;
    captchaToken?: string;
    turnstileToken?: string;
    hcaptchaToken?: string;
  };
  try {
    body = await request.json();
  } catch {
    error(400, 'Invalid request body');
  }

  const phoneNumber = body.phoneNumber?.trim();
  const countryCode = body.countryCode?.trim();
  const configuredCaptchaProviders = getConfiguredCaptchaProviders();

  let captchaProvider = body.captchaProvider?.trim() as CaptchaProvider | undefined;
  const captchaToken =
    body.captchaToken?.trim() ?? body.turnstileToken?.trim() ?? body.hcaptchaToken?.trim();

  if (!captchaProvider) {
    if (body.turnstileToken) {
      captchaProvider = 'turnstile';
    } else if (body.hcaptchaToken) {
      captchaProvider = 'hcaptcha';
    } else if (configuredCaptchaProviders.length === 1) {
      captchaProvider = configuredCaptchaProviders[0];
    }
  }

  if (!phoneNumber || !countryCode) {
    error(400, 'phoneNumber and countryCode are required');
  }

  if (configuredCaptchaProviders.length > 0) {
    if (!captchaProvider || !configuredCaptchaProviders.includes(captchaProvider)) {
      error(400, JSON.stringify({ error: 'captcha_provider_invalid' }));
    }

    if (!captchaToken) {
      error(400, JSON.stringify({ error: 'captcha_missing' }));
    }

    const captchaOk =
      captchaProvider === 'turnstile'
        ? await verifyTurnstile(captchaToken, ip)
        : await verifyHcaptcha(captchaToken, ip);

    if (!captchaOk) {
      error(400, JSON.stringify({ error: 'captcha_failed' }));
    }
  }

  await ensureConnected();

  // Check that the phone number is not shared by too many accounts (max 3)
  const db = mongo.db();
  const usersWithPhone = await db
    .collection<User>('users')
    .countDocuments({ phone: phoneNumber, phoneCountryCode: countryCode });
  if (usersWithPhone >= 3) {
    error(409, JSON.stringify({ error: 'phone_taken' }));
  } else {
    const existingUser = await db
      .collection<User>('users')
      .findOne(
        { phone: phoneNumber, phoneCountryCode: countryCode, id: userId },
        { projection: { id: 1 } }
      );
    if (existingUser) {
      error(409, JSON.stringify({ error: 'phone_already_yours' }));
    }
  }

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
