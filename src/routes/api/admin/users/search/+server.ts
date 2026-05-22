import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toPlainArray } from '$lib/utils';

export const GET: RequestHandler = async ({ locals, url }) => {
  const session = locals.session;

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  const q = url.searchParams.get('q')?.trim() ?? '';
  const limit = 10;

  const db = mongo.db();

  const searchQuery = q
    ? {
        $or: [
          { id: q },
          { name: { $regex: q, $options: 'i' } },
          { displayName: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } },
          { phone: { $regex: q, $options: 'i' } }
        ]
      }
    : {};

  const users = await db
    .collection('users')
    .find(searchQuery)
    .limit(limit)
    .project({ id: 1, name: 1, displayName: 1, email: 1, image: 1 })
    .toArray();

  return json({ users: toPlainArray(users) });
};
