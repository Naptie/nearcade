import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { initRegionCache, getAdminRegionChildren } from '$lib/regions/utils.server';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ locals }) => {
  const session = locals.session;

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  // Only ship the top-level countries; deeper levels are fetched lazily by the
  // client via /api/admin/regions?parentId=... as the admin expands each node.
  await initRegionCache(mongo);
  const regions = getAdminRegionChildren(null);

  return {
    regions: toPlainArray(regions)
  };
};
