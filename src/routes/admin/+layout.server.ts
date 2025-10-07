import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { m } from '$lib/paraglide/messages';

export const load: LayoutServerLoad = async ({ locals }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  const userType = session.user.userType;
  const hasAccess = [
    'site_admin',
    'school_admin',
    'school_moderator',
    'club_admin',
    'club_moderator'
  ].includes(userType || '');

  if (!hasAccess) {
    error(403, m.access_denied_admin_or_moderator_privileges_required());
  }

  return {
    user: session.user,
    session
  };
};
