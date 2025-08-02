import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  const session = await locals.auth();

  if (!session?.user) {
    throw error(401, 'Authentication required');
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
    throw error(403, 'Access denied. Admin or moderator privileges required.');
  }

  return {
    user: session.user
  };
};
