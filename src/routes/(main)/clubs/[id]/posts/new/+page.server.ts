import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import mongo from '$lib/db/index.server';
import { type Club } from '$lib/types';
import { checkClubPermission, canWriteClubPosts, toPlainObject } from '$lib/utils';
import { loginRedirect } from '$lib/utils/scoped';
import { m } from '$lib/paraglide/messages';

export const load = (async ({ params, url, locals }) => {
  const session = locals.session;
  if (!session?.user) {
    throw loginRedirect(url);
  }

  const { id } = params;

  const db = mongo.db();
  const clubsCollection = db.collection<Club>('clubs');

  const club = await clubsCollection.findOne({
    $or: [{ id: id }, { slug: id }]
  });

  if (!club) {
    error(404, m.club_not_found());
  }

  const permissions = await checkClubPermission(session.user, club, mongo);

  if (!(await canWriteClubPosts(permissions, club, session.user, mongo))) {
    error(403, m.permission_denied());
  }

  return {
    club: toPlainObject(club),
    canManage: permissions.canManage,
    user: session.user
  };
}) satisfies PageServerLoad;
