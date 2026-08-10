import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { nanoid } from 'nanoid';
import { m } from '$lib/paraglide/messages';
import { registerQbindToken } from '$lib/auth/qbind.server';

export const POST: RequestHandler = async ({ locals }) => {
  const userId = locals.session?.user?.id;

  if (!userId) {
    error(401, m.unauthorized());
  }

  const token = nanoid(32);
  await registerQbindToken(token, userId);

  return json({ token });
};