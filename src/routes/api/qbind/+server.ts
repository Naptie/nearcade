import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { m } from '$lib/paraglide/messages';
import { getQbindKey, upsertVerifiedSocialLink } from '$lib/auth/social-verify.server';

export const GET: RequestHandler = async ({ url, locals }) => {
  const userId = locals.session?.user?.id;

  if (!userId) {
    error(401, m.unauthorized());
  }

  const token = url.searchParams.get('token');
  if (!token) {
    error(400, m.missing_required_fields());
  }

  try {
    await ensureConnected();
    const value = await redis.get(getQbindKey(token));
    if (!value) {
      error(404, m.qbind_token_not_found());
    }

    const qq = parseInt(value, 10);
    if (isNaN(qq) || qq <= 0) {
      error(500, m.qbind_invalid_qq());
    }

    // Consume the token so it cannot be re-used
    await redis.del(getQbindKey(token));

    await upsertVerifiedSocialLink(userId, 'qq', String(qq));

    return json({ success: true, qq });
  } catch (err) {
    if (isHttpError(err)) throw err;
    console.error('Error verifying QQ via qbind:', err);
    error(500, m.qbind_verification_error());
  }
};
