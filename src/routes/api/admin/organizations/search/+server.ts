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

  const type = url.searchParams.get('type')?.trim() ?? '';
  const q = url.searchParams.get('q')?.trim() ?? '';

  if (!['university', 'club'].includes(type)) {
    error(400, m.invalid_organization_type());
  }

  if (!q) {
    return json({ organizations: [] });
  }

  try {
    const db = mongo.db();
    const collectionName = type === 'university' ? 'universities' : 'clubs';

    const organizations = (await db
      .collection(collectionName)
      .find({
        $or: [
          { id: q },
          { slug: q },
          { id: { $regex: q, $options: 'i' } },
          { slug: { $regex: q, $options: 'i' } },
          { name: { $regex: q, $options: 'i' } }
        ]
      })
      .limit(20)
      .project({ _id: 0, id: 1, name: 1, slug: 1 })
      .toArray()) as Array<{ id: string; name: string; slug?: string }>;

    return json({ organizations: toPlainArray(organizations) });
  } catch (err) {
    console.error('Error searching organizations:', err);
    error(500, m.failed_to_search_organizations());
  }
};
