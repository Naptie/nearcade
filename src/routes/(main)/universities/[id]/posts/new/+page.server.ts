import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import mongo from '$lib/db/index.server';
import { type University } from '$lib/types';
import { checkUniversityPermission, canWriteUnivPosts, toPlainObject } from '$lib/utils';
import { loginRedirect } from '$lib/utils/scoped';
import { m } from '$lib/paraglide/messages';

export const load = (async ({ params, url, locals }) => {
  const session = locals.session;
  if (!session?.user) {
    throw loginRedirect(url);
  }

  const { id } = params;

  const db = mongo.db();
  const universitiesCollection = db.collection<University>('universities');

  const university = await universitiesCollection.findOne({
    $or: [{ id: id }, { slug: id }]
  });

  if (!university) {
    error(404, m.university_not_found());
  }

  const permissions = await checkUniversityPermission(session.user, university, mongo);

  if (!canWriteUnivPosts(permissions, university)) {
    error(403, m.permission_denied());
  }

  return {
    university: toPlainObject(university),
    canManage: permissions.canManage,
    user: session.user
  };
}) satisfies PageServerLoad;
