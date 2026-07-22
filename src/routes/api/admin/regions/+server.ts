import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import {
  initRegionCache,
  getAdminRegionChildren,
  searchAdminRegions
} from '$lib/regions/utils.server';
import { m } from '$lib/paraglide/messages';

function requireSiteAdmin(session: App.Locals['session']) {
  if (!session?.user) {
    error(401, m.unauthorized());
  }
  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }
}

/**
 * GET /api/admin/regions
 *
 * Supports the lazily-loaded admin region tree:
 * - `?q=<query>`        → search regions by ID or localized name (flat hits with
 *                         ancestor chains), used by the admin search box.
 * - `?parentId=<id>`    → immediate children of a region, loaded on expand.
 * - (no params)         → top-level countries.
 *
 * Every returned node carries a `hasChildren` flag so the UI knows whether to
 * render an expand control without fetching the children up front.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  requireSiteAdmin(locals.session);

  // The cache is initialised at server startup; awaiting here is a cheap,
  // idempotent safety net in case this endpoint is hit first.
  await initRegionCache(mongo);

  try {
    const query = url.searchParams.get('q');
    if (query !== null) {
      return json({ regions: searchAdminRegions(query) });
    }

    const parentId = url.searchParams.get('parentId') || null;
    return json({ regions: getAdminRegionChildren(parentId) });
  } catch (err) {
    console.error('Error loading admin regions:', err);
    error(500, m.internal_server_error());
  }
};
