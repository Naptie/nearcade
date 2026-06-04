import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { User } from '$lib/auth/types';
import { m } from '$lib/paraglide/messages';

export const DELETE: RequestHandler = async ({ locals }) => {
  const session = locals.session;
  if (!session) {
    error(401, m.unauthorized());
  }

  const userId = session.user.id;

  const db = mongo.db();
  await db.collection<User>('users').updateOne(
    { id: userId },
    {
      $unset: { phone: '', phoneCountryCode: '' },
      $set: { updatedAt: new Date() }
    }
  );

  return json({ success: true });
};
