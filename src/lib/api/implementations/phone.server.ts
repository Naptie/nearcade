import { implement } from '@orpc/server';
import { phoneContract } from '../contracts/phone';
import type { ApiContext } from '../context';
import { apiError, badGateway } from '../errors';
import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import type { User } from '$lib/auth/types';
import {
  getConfiguredCaptchaProviders,
  verifyCaptcha,
  type CaptchaProvider
} from '$lib/captcha.server';
import { m } from '$lib/paraglide/messages';
import { getTelegramVerificationStatus, sendPhoneOtp, verifyPhoneOtp } from '$lib/sms/index.server';
import { getClientIp } from '$lib/utils/ip.server';

const COOLDOWN_SECONDS = 60;
const DAILY_LIMIT = 5;

interface TelegramSessionContext {
  userId: string;
  phoneNumber: string;
  dialCode: string;
}

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

const impl = implement(phoneContract).$context<ApiContext>();

export const phoneImplementation = {
  remove: impl.remove.handler(async ({ context }) => {
    const session = context.session;
    if (!session) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const userId = session.user.id;

    const db = mongo.db();
    await db.collection<User>('users').updateOne(
      { id: userId },
      {
        $unset: { phone: '', phoneDialCode: '' },
        $set: { updatedAt: new Date() }
      }
    );

    return { success: true as const };
  }),

  send: impl.send.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const userId = session.user.id;
    const ip = getClientIp(context.event);

    await ensureConnected();

    // An in-flight Telegram verification session means the user already passed
    // the captcha for this flow — re-requesting a session (e.g. after the
    // cooldown) does not need a fresh captcha token.
    const pendingTelegramSessionId = await redis.get(telegramSessionUserKey(userId));

    const phoneNumber = input.phoneNumber?.trim();
    const dialCode = input.dialCode?.trim();
    const locale = input.locale === 'zh' || input.locale === 'ja' ? input.locale : 'en';
    const configuredCaptchaProviders = getConfiguredCaptchaProviders();

    let captchaProvider = input.captchaProvider?.trim() as CaptchaProvider | undefined;
    const captchaToken =
      input.captchaToken?.trim() ?? input.turnstileToken?.trim() ?? input.hcaptchaToken?.trim();

    if (!captchaProvider) {
      if (input.turnstileToken) {
        captchaProvider = 'turnstile';
      } else if (input.hcaptchaToken) {
        captchaProvider = 'hcaptcha';
      } else if (configuredCaptchaProviders.length === 1) {
        captchaProvider = configuredCaptchaProviders[0];
      }
    }

    if (!phoneNumber || !dialCode) {
      apiError('BAD_REQUEST', 'phoneNumber and dialCode are required');
    }

    if (configuredCaptchaProviders.length > 0 && !pendingTelegramSessionId) {
      if (!captchaProvider || !configuredCaptchaProviders.includes(captchaProvider)) {
        apiError('BAD_REQUEST', JSON.stringify({ error: 'captcha_provider_invalid' }));
      }

      if (!captchaToken) {
        apiError('BAD_REQUEST', JSON.stringify({ error: 'captcha_missing' }));
      }

      const captchaOk = await verifyCaptcha(captchaProvider, captchaToken, ip);

      if (!captchaOk) {
        apiError('BAD_REQUEST', JSON.stringify({ error: 'captcha_failed' }));
      }
    }

    // Check that the phone number is not shared by too many accounts (max 3)
    const db = mongo.db();
    const usersWithPhone = await db
      .collection<User>('users')
      .countDocuments({ phone: phoneNumber, phoneDialCode: dialCode });
    if (usersWithPhone >= 3) {
      apiError('CONFLICT', JSON.stringify({ error: 'phone_taken' }));
    } else {
      const existingUser = await db
        .collection<User>('users')
        .findOne(
          { phone: phoneNumber, phoneDialCode: dialCode, id: userId },
          { projection: { id: 1 } }
        );
      if (existingUser) {
        apiError('CONFLICT', JSON.stringify({ error: 'phone_already_yours' }));
      }
    }

    // Cooldown check (per user)
    const cooldown = await redis.get(cooldownKey(userId));
    if (cooldown) {
      const ttl = await redis.ttl(cooldownKey(userId));
      apiError('TOO_MANY_REQUESTS', JSON.stringify({ error: 'cooldown', retryAfter: ttl }));
    }

    // Daily limit check (per user)
    const userDailyKeyStr = dailyKey(`user:${userId}`);
    const userDailyCount = await redis.get(userDailyKeyStr);
    if (userDailyCount && parseInt(userDailyCount, 10) >= DAILY_LIMIT) {
      apiError('TOO_MANY_REQUESTS', JSON.stringify({ error: 'daily_limit_exceeded' }));
    }

    // Daily limit check (per IP)
    const ipDailyKeyStr = dailyKey(`ip:${ip}`);
    const ipDailyCount = await redis.get(ipDailyKeyStr);
    if (ipDailyCount && parseInt(ipDailyCount, 10) >= DAILY_LIMIT) {
      apiError('TOO_MANY_REQUESTS', JSON.stringify({ error: 'daily_limit_exceeded' }));
    }

    const result = await sendPhoneOtp(phoneNumber, dialCode, locale);
    if (!result.success) {
      badGateway(result.error);
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

    return result;
  }),

  status: impl.status.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const userId = session.user.id;
    const { sessionId } = input;
    const locale = input.locale === 'zh' || input.locale === 'ja' ? input.locale : 'en';

    // The verification context (number + dial code) was recorded by the send
    // endpoint when the session was created; unified-sms's `verified` result
    // is authoritative, so we trust it and never re-derive the number from
    // the response.
    await ensureConnected();
    const contextRaw = await redis.get(telegramSessionKey(sessionId));
    if (!contextRaw) {
      apiError('NOT_FOUND', JSON.stringify({ error: 'telegram_session_not_found' }));
    }

    let telegramContext: TelegramSessionContext;
    try {
      telegramContext = JSON.parse(contextRaw) as TelegramSessionContext;
    } catch {
      apiError('INTERNAL_SERVER_ERROR', 'Invalid stored session context');
    }

    if (telegramContext.userId !== userId) {
      apiError('FORBIDDEN', JSON.stringify({ error: 'telegram_session_forbidden' }));
    }

    const result = await getTelegramVerificationStatus(sessionId, locale);
    if (!result.success) {
      apiError('NOT_FOUND', result.error);
    }

    if (result.status === 'verified') {
      const db = mongo.db();
      await db.collection<User>('users').updateOne(
        { id: userId },
        {
          $set: {
            phone: telegramContext.phoneNumber,
            phoneDialCode: telegramContext.dialCode,
            updatedAt: new Date()
          }
        }
      );
      await redis.del(telegramSessionKey(sessionId));
      await redis.del(telegramSessionUserKey(userId));
    } else if (result.status === 'expired') {
      await redis.del(telegramSessionKey(sessionId));
      await redis.del(telegramSessionUserKey(userId));
    }

    return result;
  }),

  verify: impl.verify.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const userId = session.user.id;

    const phoneNumber = input.phoneNumber?.trim();
    const dialCode = input.dialCode?.trim();
    const code = input.code?.trim();
    const locale = input.locale === 'zh' || input.locale === 'ja' ? input.locale : 'en';

    if (!phoneNumber || !dialCode || !code) {
      apiError('BAD_REQUEST', 'phoneNumber, dialCode, and code are required');
    }

    const result = await verifyPhoneOtp(phoneNumber, dialCode, code, locale);
    if (!result.success) {
      badGateway(result.error);
    }

    if (!result.verified) {
      return { success: false, verified: false };
    }

    const db = mongo.db();
    await db.collection<User>('users').updateOne(
      { id: userId },
      {
        $set: {
          phone: phoneNumber,
          phoneDialCode: dialCode,
          updatedAt: new Date()
        }
      }
    );

    return { success: true, verified: true };
  })
};
