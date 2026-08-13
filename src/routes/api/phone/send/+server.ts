import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import redis, { ensureConnected } from '$lib/db/redis.server';
import mongo from '$lib/db/index.server';
import type { User } from '$lib/auth/types';
import { sendPhoneOtp } from '$lib/sms/index.server';
import { m } from '$lib/paraglide/messages';
import {
  getConfiguredCaptchaProviders,
  verifyCaptcha,
  type CaptchaProvider
} from '$lib/captcha.server';
import { getClientIp } from '$lib/utils/ip.server';

const COOLDOWN_SECONDS = 60;
const DAILY_LIMIT = 5;

function dailyKey(qualifier: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `nearcade:sms:daily:${qualifier}:${date}`;
}

function cooldownKey(userId: string): string {
  return `nearcade:sms:cooldown:${userId}`;
}

function telegramSessionKey(sessionId: string): string {
  return `nearcade:sms:telegram:${sessionId}`;
}

function telegramSessionUserKey(userId: string): string {
  return `nearcade:sms:telegram:user:${userId}`;
}

export const POST: RequestHandler = async (event) => {
  const { request, locals } = event;
  const session = locals.session;
  if (!session) {
    error(401, m.unauthorized());
  }

  const userId = session.user.id;
  const ip = getClientIp(event);

  await ensureConnected();

  // An in-flight Telegram verification session means the user already passed
  // the captcha for this flow — re-requesting a session (e.g. after the
  // cooldown) does not need a fresh captcha token.
  const pendingTelegramSessionId = await redis.get(telegramSessionUserKey(userId));

  let body: {
    phoneNumber?: string;
    dialCode?: string;
    locale?: string;
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
  const dialCode = body.dialCode?.trim();
  const locale = body.locale === 'zh' || body.locale === 'ja' ? body.locale : 'en';
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

  if (!phoneNumber || !dialCode) {
    error(400, 'phoneNumber and dialCode are required');
  }

  if (configuredCaptchaProviders.length > 0 && !pendingTelegramSessionId) {
    if (!captchaProvider || !configuredCaptchaProviders.includes(captchaProvider)) {
      error(400, JSON.stringify({ error: 'captcha_provider_invalid' }));
    }

    if (!captchaToken) {
      error(400, JSON.stringify({ error: 'captcha_missing' }));
    }

    const captchaOk = await verifyCaptcha(captchaProvider, captchaToken, ip);

    if (!captchaOk) {
      error(400, JSON.stringify({ error: 'captcha_failed' }));
    }
  }

  // Check that the phone number is not shared by too many accounts (max 3)
  const db = mongo.db();
  const usersWithPhone = await db
    .collection<User>('users')
    .countDocuments({ phone: phoneNumber, phoneDialCode: dialCode });
  if (usersWithPhone >= 3) {
    error(409, JSON.stringify({ error: 'phone_taken' }));
  } else {
    const existingUser = await db
      .collection<User>('users')
      .findOne(
        { phone: phoneNumber, phoneDialCode: dialCode, id: userId },
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

  const result = await sendPhoneOtp(phoneNumber, dialCode, locale);
  if (!result.success) {
    error(502, result.error);
  }

  if (result.method === 'telegram') {
    // Persist the pending verification context so the status endpoint can
    // bind exactly the number confirmed via Telegram — the verified result
    // from unified-sms is authoritative, so no client-supplied values are
    // needed (or trusted) at bind time.
    if (pendingTelegramSessionId) {
      // A previous session for this flow is superseded by the new one.
      await redis.del(telegramSessionKey(pendingTelegramSessionId));
    }
    await redis.set(
      telegramSessionKey(result.sessionId),
      JSON.stringify({ userId, phoneNumber, dialCode }),
      { EX: result.ttl + 60 }
    );
    await redis.set(telegramSessionUserKey(userId), result.sessionId, {
      EX: result.ttl + 60
    });
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

  return json(result);
};
