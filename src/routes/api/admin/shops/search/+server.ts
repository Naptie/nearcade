import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toPlainArray } from '$lib/utils';
import type { Shop } from '$lib/types';

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
          ...(isNaN(Number(q)) ? [] : [{ id: Number(q) }]),
          { name: { $regex: q, $options: 'i' } }
        ]
      }
    : {};

  const shops = await db
    .collection<Shop>('shops')
    .find(searchQuery)
    .limit(limit)
    .project({ _id: 0, id: 1, name: 1 })
    .toArray();

  return json({ shops: toPlainArray(shops) });
};
