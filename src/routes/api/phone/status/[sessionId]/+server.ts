import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import redis, { ensureConnected } from '$lib/db/redis.server';
import mongo from '$lib/db/index.server';
import type { User } from '$lib/auth/types';
import { getTelegramVerificationStatus } from '$lib/sms/index.server';
import { m } from '$lib/paraglide/messages';

interface TelegramSessionContext {
  userId: string;
  phoneNumber: string;
  dialCode: string;
}

function telegramSessionKey(sessionId: string): string {
  return `nearcade:sms:telegram:${sessionId}`;
}

function telegramSessionUserKey(userId: string): string {
  return `nearcade:sms:telegram:user:${userId}`;
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const session = locals.session;
  if (!session) {
    error(401, m.unauthorized());
  }

  const userId = session.user.id;
  const { sessionId } = params;
  const localeParam = url.searchParams.get('locale');
  const locale = localeParam === 'zh' || localeParam === 'ja' ? localeParam : 'en';

  if (!sessionId) {
    error(400, 'sessionId is required');
  }

  // The verification context (number + dial code) was recorded by the send
  // endpoint when the session was created; unified-sms's `verified` result
  // is authoritative, so we trust it and never re-derive the number from
  // the response.
  await ensureConnected();
  const contextRaw = await redis.get(telegramSessionKey(sessionId));
  if (!contextRaw) {
    error(404, JSON.stringify({ error: 'telegram_session_not_found' }));
  }

  let context: TelegramSessionContext;
  try {
    context = JSON.parse(contextRaw) as TelegramSessionContext;
  } catch {
    error(500, 'Invalid stored session context');
  }

  if (context.userId !== userId) {
    error(403, JSON.stringify({ error: 'telegram_session_forbidden' }));
  }

  const result = await getTelegramVerificationStatus(sessionId, locale);
  if (!result.success) {
    error(404, result.error);
  }

  if (result.status === 'verified') {
    const db = mongo.db();
    await db.collection<User>('users').updateOne(
      { id: userId },
      {
        $set: {
          phone: context.phoneNumber,
          phoneDialCode: context.dialCode,
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

  return json(result);
};
