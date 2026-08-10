import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';
import { claimAndCompleteQbindToken } from '$lib/auth/qbind.server';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;

export const GET: RequestHandler = async ({ url, locals }) => {
  const userId = locals.session?.user?.id;

  if (!userId) {
    error(401, m.unauthorized());
  }

  const token = url.searchParams.get('token');
  if (!token) {
    error(400, m.missing_required_fields());
  }

  // Nanoid tokens only contain [A-Za-z0-9_-]; anything else (e.g. ":" or ".")
  // would let the caller reference keys outside the qbind namespace.
  if (!TOKEN_PATTERN.test(token)) {
    error(400, m.missing_required_fields());
  }

  try {
    const result = await claimAndCompleteQbindToken(token);
    if (result.status === 'success') {
      return json({ success: true, qq: result.qq });
    }
    if (result.status === 'invalid') {
      error(500, m.qbind_invalid_qq());
    }
    error(404, m.qbind_token_not_found());
  } catch (err) {
    if (isHttpError(err)) throw err;
    console.error('Error verifying QQ via qbind:', err);
    error(500, m.qbind_verification_error());
  }
};
