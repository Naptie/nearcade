import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRegionHierarchyByIds } from '$lib/regions/utils.server';

/**
 * GET /api/regions/<id1>/<id2>/.../<idN>?locale=<locale>
 *
 * Given a path of region IDs (root → leaf), returns each region's data
 * along with the selector options at each level. This allows the client
 * to build all cascading selects in a single round-trip.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const ids = params.ids.split('/').filter(Boolean);
  const locale = url.searchParams.get('locale') || 'en';

  if (ids.length === 0) {
    return json({ error: 'At least one region ID is required' }, { status: 400 });
  }

  try {
    const result = getRegionHierarchyByIds(ids, locale);

    if (!result) {
      return json({ error: 'Invalid region ID path' }, { status: 404 });
    }

    return json(result, {
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
      }
    });
  } catch (err) {
    console.error('Error resolving region hierarchy:', err);
    return json({ error: 'Failed to resolve region hierarchy' }, { status: 500 });
  }
};
