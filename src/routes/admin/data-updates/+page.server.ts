import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAdminDataUpdateTriggerUrl, listDataUpdateTasks } from '$lib/admin/data-updates.server';
import { m } from '$lib/paraglide/messages';
import { toPlainArray } from '$lib/utils';

export const load: PageServerLoad = async ({ locals, request }) => {
  const session = locals.session;

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  return {
    tasks: toPlainArray(await listDataUpdateTasks()),
    triggerUrl: getAdminDataUpdateTriggerUrl(request)
  };
};
